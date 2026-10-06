import { type Axes, type ParamName, AXIS_NAMES, cleanParams } from './params.js';
import type { MoodWeights } from './moods.js';
import type { District } from './steering.js';

/** One-shot musical events a host can fire. */
export const ONE_SHOTS = ['sting', 'arpeggio', 'swell', 'silence'] as const;
export type OneShot = (typeof ONE_SHOTS)[number];

/**
 * Everything a host can ask of the engine, as plain data: safe to post across a worker, to queue,
 * or to keep in a saved file. `glide` is in seconds.
 */
export type Message =
  | { type: 'mood'; mood: string | MoodWeights; glide?: number }
  | { type: 'steer'; axes: Partial<Axes>; glide?: number }
  | { type: 'set'; params: Partial<Record<ParamName, number | null>>; glide?: number }
  | { type: 'prompt'; text: string; glide?: number }
  | { type: 'seed'; seed: string }
  | { type: 'enter'; district: District; glide?: number }
  /** `seconds` is the length of a swell or a silence; `amount` (0..1) is how hard a sting or swell is. */
  | { type: 'event'; event: OneShot; seconds?: number; amount?: number }
  | { type: 'reset'; glide?: number };

export type MessageType = Message['type'];

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);
const withGlide = <M extends Message>(m: M, glide: unknown): M => (num(glide) === undefined ? m : { ...m, glide: num(glide) });

function cleanAxes(input: unknown): Partial<Axes> {
  const out: Partial<Axes> = {};
  if (input && typeof input === 'object') {
    for (const a of AXIS_NAMES) {
      const v = (input as Record<string, unknown>)[a];
      if (typeof v === 'number' && Number.isFinite(v)) out[a] = Math.min(1, Math.max(0, v));
    }
  }
  return out;
}

function cleanMood(input: unknown): string | MoodWeights | undefined {
  if (typeof input === 'string') return input;
  if (!input || typeof input !== 'object') return undefined;
  const out: MoodWeights = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = v;
  return out;
}

function cleanDistrict(input: unknown): District | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const d = input as Record<string, unknown>;
  const out: District = {};
  if (typeof d.name === 'string') out.name = d.name;
  if (typeof d.seed === 'string') out.seed = d.seed;
  if (typeof d.prompt === 'string') out.prompt = d.prompt;
  const mood = cleanMood(d.mood);
  if (mood !== undefined) out.mood = mood;
  if (d.axes && typeof d.axes === 'object') out.axes = cleanAxes(d.axes);
  if (d.overrides && typeof d.overrides === 'object') out.overrides = cleanParams(d.overrides) as District['overrides'];
  return out;
}

/**
 * Check a message that came from outside (a worker, a saved file, JSON text). Returns a clean copy
 * with unknown fields dropped and numbers clamped, or null if it is not a message. Never throws.
 */
export function parseMessage(input: unknown): Message | null {
  let m: unknown = input;
  if (typeof m === 'string') {
    try {
      m = JSON.parse(m);
    } catch {
      return null;
    }
  }
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  switch (o.type) {
    case 'mood': {
      const mood = cleanMood(o.mood);
      return mood === undefined ? null : withGlide({ type: 'mood', mood }, o.glide);
    }
    case 'steer':
      return withGlide({ type: 'steer', axes: cleanAxes(o.axes) }, o.glide);
    case 'set':
      return withGlide({ type: 'set', params: cleanParams(o.params, true) }, o.glide);
    case 'prompt':
      return typeof o.text === 'string' ? withGlide({ type: 'prompt', text: o.text }, o.glide) : null;
    case 'seed':
      return typeof o.seed === 'string' || typeof o.seed === 'number' ? { type: 'seed', seed: String(o.seed) } : null;
    case 'enter': {
      const district = cleanDistrict(o.district);
      return district ? withGlide({ type: 'enter', district }, o.glide) : null;
    }
    case 'event': {
      if (!(ONE_SHOTS as readonly unknown[]).includes(o.event)) return null;
      const out: Extract<Message, { type: 'event' }> = { type: 'event', event: o.event as OneShot };
      if (num(o.seconds) !== undefined) out.seconds = num(o.seconds);
      if (num(o.amount) !== undefined) out.amount = Math.min(1, num(o.amount)!);
      return out;
    }
    case 'reset':
      return withGlide({ type: 'reset' }, o.glide);
    default:
      return null;
  }
}
