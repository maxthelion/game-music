import { clamp } from './rng.js';

/**
 * The low-level parameters of the music. Everything the composer and the renderer do is read from
 * these numbers; axes, moods and prompts are only ways of choosing them.
 */
export interface ParamSpec {
  /** Lowest and highest allowed value. */
  min: number;
  max: number;
  /** Value at the home point of the axes (the original drone study). */
  base: number;
  unit?: string;
  /** One sentence for the documentation and the demo. */
  doc: string;
}

export const PARAMS = {
  level: { min: 0, max: 1, base: 0.8, doc: 'Overall loudness of the engine before the host\'s own gain.' },
  unease: { min: 0, max: 1, base: 0.6, doc: 'Low: related chords. High: chord changes with no key in common (slide, pole, tritone).' },
  mode: { min: 0, max: 1, base: 0.5, doc: '0 prefers minor triads, 1 prefers major; at 0.5 major and minor alternate as each move dictates.' },
  anchor: { min: 0, max: 1, base: 0, doc: 'How strongly the harmony stays inside its home key instead of roaming.' },
  clash: { min: 0, max: 1, base: 1, doc: 'Scales the chance (set by unease) of an added note that does not belong: a semitone or a tritone.' },
  colour: { min: 0, max: 1, base: 0.8, doc: 'How often a chord is dressed (add9, sus2, sus4, sixth, sevenths). At 0 every chord is a plain triad.' },
  brightness: { min: 0, max: 1, base: 0.5, doc: 'Opens the filters and tilts dressings towards the bright ones (add9, major 7, sixth, sus2).' },
  register: { min: 0, max: 1, base: 0.5, doc: 'Where the voices, bells and arpeggios sit: 0 is about seven semitones lower, 1 seven higher.' },
  depth: { min: 0, max: 1, base: 0.4, doc: 'How far down you are: lower pitch, darker tone, more air noise.' },
  drift: { min: 0, max: 1, base: 0.7, doc: 'How far the synth itself wanders: waveform blends, detune, position, filter sweeps.' },
  pace: { min: 0, max: 1, base: 0.5, doc: 'Chord length and the speed of drift: 0 is 24 to 40 seconds a chord, 0.5 is 14 to 26, 1 is 4 to 8.' },
  bells: { min: 0, max: 1, base: 0.5, doc: 'How often the three slow loops strike a high note. At 0 never.' },
  arpeggio: { min: 0, max: 1, base: 0.5, doc: 'How often a plucked run drifts in. At 0 never.' },
  flurry: { min: 0, max: 1, base: 0.35, doc: 'How fast and how long each arpeggio is, and how soon the next follows.' },
  heartbeat: { min: 0, max: 1, base: 0.5, doc: 'Level of the double kick. At 0 it is off (the beat still counts silently).' },
  pulse: { min: 30, max: 180, base: 54, unit: 'bpm', doc: 'Beats a minute for the heartbeat, the tick and the arpeggios. A change lands on the next beat.' },
  tick: { min: 0, max: 1, base: 0, doc: 'Level of a light pulse note on the subdivisions of the beat. At 0 it is off.' },
  cluster: { min: 0, max: 1, base: 0, doc: 'How often and how loudly a high cluster of close notes rises and is cut off.' },
  width: { min: 0, max: 1, base: 0.7, doc: 'Stereo spread of the voices and bells; 0 is everything in the middle.' },
  space: { min: 0, max: 1, base: 0.55, doc: 'Amount of the engine\'s own reverb (multiplied by the engine\'s `reverb` option).' },
} as const satisfies Record<string, ParamSpec>;

export type ParamName = keyof typeof PARAMS;
export type Params = Record<ParamName, number>;
export const PARAM_NAMES = Object.keys(PARAMS) as ParamName[];
export const isParamName = (k: string): k is ParamName => Object.prototype.hasOwnProperty.call(PARAMS, k);

export const AXIS_NAMES = ['energy', 'valence', 'tension'] as const;
export type AxisName = (typeof AXIS_NAMES)[number];
export type Axes = Record<AxisName, number>;
export const isAxisName = (k: string): k is AxisName => (AXIS_NAMES as readonly string[]).includes(k);

export const AXIS_DOCS: Record<AxisName, string> = {
  energy: 'laid back 0 .. frantic 1',
  valence: 'eerie, dark 0 .. cheerful, bright 1',
  tension: 'calm 0 .. threatened 1',
};

/**
 * The point on the axes where every parameter has its base value. It is not the middle: the base
 * values are the original drone study, which is slow, dark and a little uneasy.
 */
export const HOME_AXES: Readonly<Axes> = { energy: 0.3, valence: 0.2, tension: 0.35 };

/**
 * What each axis does: for each parameter it touches, the amount added when the axis is at 0 and
 * the amount added when it is at 1. At the home value nothing is added; in between it is a straight
 * line on each side. The effects of the three axes are summed and the result is clamped.
 */
export const AXIS_MAP: Record<AxisName, Partial<Record<ParamName, readonly [number, number]>>> = {
  energy: {
    pace: [-0.35, 0.5],
    pulse: [-12, 66],
    arpeggio: [-0.4, 0.5],
    flurry: [-0.25, 0.65],
    tick: [0, 0.8],
    drift: [-0.2, 0.3],
    heartbeat: [-0.3, 0.1],
    bells: [0, 0.15],
  },
  valence: {
    mode: [-0.3, 0.45],
    anchor: [0, 0.9],
    clash: [0, -1],
    unease: [0.15, -0.5],
    brightness: [-0.15, 0.45],
    register: [-0.1, 0.4],
    colour: [0, 0.1],
    bells: [-0.1, 0.35],
    arpeggio: [-0.1, 0.25],
    depth: [0.15, -0.25],
  },
  tension: {
    unease: [-0.25, 0.4],
    heartbeat: [-0.4, 0.5],
    pulse: [-6, 40],
    width: [0.15, -0.45],
    brightness: [0.05, -0.25],
    cluster: [0, 0.9],
    space: [0, -0.1],
    clash: [-0.3, 0],
  },
};

export function baseParams(): Params {
  const out = {} as Params;
  for (const k of PARAM_NAMES) out[k] = PARAMS[k].base;
  return out;
}

export function clampParam(name: ParamName, value: number): number {
  const spec = PARAMS[name];
  return Number.isFinite(value) ? clamp(value, spec.min, spec.max) : spec.base;
}

export function clampAxes(axes: Partial<Axes>, fallback: Axes = HOME_AXES): Axes {
  const out = { ...fallback };
  for (const a of AXIS_NAMES) {
    const v = axes[a];
    if (typeof v === 'number' && Number.isFinite(v)) out[a] = clamp(v);
  }
  return out;
}

/** How far an axis is from home, as -1 (at 0) .. 0 (home) .. 1 (at 1). */
function reach(axis: AxisName, value: number): number {
  const home = HOME_AXES[axis];
  return value < home ? -(home - value) / home : (value - home) / (1 - home);
}

/** The low-level parameters that a point on the three axes stands for. */
export function paramsFromAxes(axes: Partial<Axes>): Params {
  const full = clampAxes(axes);
  const out = baseParams();
  for (const axis of AXIS_NAMES) {
    const r = reach(axis, full[axis]);
    const map = AXIS_MAP[axis];
    for (const key of Object.keys(map) as ParamName[]) {
      const [lo, hi] = map[key]!;
      out[key] += r < 0 ? lo * -r : hi * r;
    }
  }
  for (const k of PARAM_NAMES) out[k] = clampParam(k, out[k]);
  return out;
}

/** Only the recognised, finite entries of an untrusted object, clamped. `null` entries are kept as null. */
export function cleanParams(input: unknown, keepNull = false): Partial<Record<ParamName, number | null>> {
  const out: Partial<Record<ParamName, number | null>> = {};
  if (!input || typeof input !== 'object') return out;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!isParamName(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = clampParam(k, v);
    else if (v === null && keepNull) out[k] = null;
  }
  return out;
}
