import type { Params } from './params.js';
import type { OneShot } from './messages.js';
import { type Rand, clamp, lerp, mod, rng } from './rng.js';
import {
  type DressingDef,
  type LayerName,
  type MoveDef,
  type MoveKey,
  DRESSINGS,
  LAYERS,
  LAYER_NAMES,
  MOVES,
  MOVE_KEYS,
  NOTE_NAMES,
  PLAIN,
  TABLES as T,
} from './tables.js';

/*
 * The composer decides what happens and when. It is pure: it knows nothing of Web Audio and never
 * reads a clock. The host says "decide everything before time X, with these parameters" and gets
 * back a list of events. The same seed and the same history of parameters give the same events.
 * All times are in seconds on whatever clock the host uses; notes are MIDI numbers.
 */

export interface ChordEvent {
  type: 'chord';
  time: number;
  /** 0 for the first chord, counting up. */
  index: number;
  root: number;
  minor: boolean;
  /** Dressing id: 'major', 'minor', 'add9', 'sus2', 'sus4', 'major7', 'dominant7', 'sixth', 'minor-add9', 'minor7'. */
  dressing: string;
  /** For example "E♭ minor add9". */
  name: string;
  /** The move that led here; null for the first chord. */
  move: MoveKey | null;
  moveLabel: string;
  moveDescription: string;
  /** A note added that does not belong, if any. */
  clash: '' | 'semitone' | 'tritone';
  /** The pitch classes sounding, including the clash. */
  pcs: number[];
  /** One note for each voice. */
  notes: number[];
  /** Seconds after `time` at which each voice starts to move, and the time constant of its glide. */
  voiceDelays: number[];
  glide: number;
  /** The drone's note, when it starts to move and how slowly. */
  drone: number;
  droneDelay: number;
  droneGlide: number;
  /** Seconds until the next chord is due. */
  duration: number;
  /** The tonic pitch class of the key the harmony currently calls home. */
  home: number;
  sting: boolean;
}

export interface BellEvent {
  type: 'bell';
  time: number;
  midi: number;
  pan: number;
  level: number;
}

export interface ArpeggioEvent {
  type: 'arpeggio';
  time: number;
  notes: Array<{ time: number; midi: number; level: number; pan: number }>;
  /** Seconds between notes, notes to a beat, and the echo's delay. */
  step: number;
  perBeat: number;
  echo: number;
  /** True when a host asked for it rather than the composer choosing the moment. */
  forced: boolean;
}

export interface BeatEvent {
  type: 'beat';
  time: number;
  index: number;
  bpm: number;
  /** The heartbeat's level, 0 when it is silent. */
  level: number;
  /** The two kicks: a sine falling from `top` cycles a second. */
  thumps: Array<{ time: number; level: number; top: number }>;
  /** Light pulse notes on the subdivisions of this beat. */
  ticks: Array<{ time: number; midi: number; level: number }>;
}

export interface DriftEvent {
  type: 'drift';
  time: number;
  voice: number;
  /** Target level of each waveform layer. */
  blend: Record<LayerName, number>;
  /** What leads the blend, for display: "pad", "glass", "reed+air". */
  label: string;
  /** Detune of the saw pair in cents, position, filter edge, resonance and sweep depth for the voice. */
  spread: number;
  pan: number;
  filter: number;
  q: number;
  sweep: number;
  /** Multiplier on the reverb amount, and the depth of the slow sweep on the shared tone filter. */
  wetScale: number;
  toneSweep: number;
  /** Time constant of the glide to all of these. */
  glide: number;
}

export interface ClusterEvent {
  type: 'cluster';
  time: number;
  duration: number;
  notes: number[];
  /** Semitones the whole cluster climbs before it is cut off. */
  rise: number;
  level: number;
}

export interface HitEvent {
  type: 'hit';
  time: number;
  level: number;
}

export interface SwellEvent {
  type: 'swell';
  time: number;
  duration: number;
  amount: number;
}

export interface SilenceEvent {
  type: 'silence';
  time: number;
  duration: number;
  fade: number;
}

export type MusicEvent = ChordEvent | BellEvent | ArpeggioEvent | BeatEvent | DriftEvent | ClusterEvent | HitEvent | SwellEvent | SilenceEvent;
export type MusicEventType = MusicEvent['type'];

export interface ComposerOptions {
  seed?: string;
  /** How many persistent voices the pad has, 4 to 8. Default 5. */
  voices?: number;
  /** The time of the first chord. Default 0. */
  startTime?: number;
}

export interface OneShotOptions {
  seconds?: number;
  amount?: number;
}

const MOVE_TABLE: Record<MoveKey, MoveDef> = MOVES;
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const nearest = (pool: number[], to: number): number => pool.reduce((a, b) => (Math.abs(b - to) < Math.abs(a - to) ? b : a));
const span = (range: readonly number[], r: number): number => range[0] + r * (range[1] - range[0]);

function weighted<K>(items: Array<[K, number]>, r: number): K {
  let total = 0;
  for (const [, w] of items) total += w;
  let x = r * total;
  for (const [k, w] of items) {
    x -= w;
    if (x <= 0 && w > 0) return k;
  }
  return items[0][0];
}

/** Lowest and highest chord length, in seconds, at a given pace. */
export function chordSeconds(pace: number): [number, number] {
  const { slow, mid, fast } = T.chordSeconds;
  const p = clamp(pace);
  const [a, b, t] = p < 0.5 ? [slow, mid, p / 0.5] : [mid, fast, (p - 0.5) / 0.5];
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
}

export class Composer {
  readonly voices: number;
  seed: string;

  private rChord!: Rand;
  private rDrift!: Rand;
  private rArp!: Rand;
  private rHeart!: Rand;
  private rBells!: Rand;
  private rCluster!: Rand;

  private now: number;
  private chord: { root: number; minor: boolean } | null = null;
  private lastMove: MoveKey | null = null;
  private home = 0;
  private notes: number[] = [];
  private pcs: number[] = [];
  private drone: number | null = null;
  private centre = 0;
  private chordIndex = 0;
  private chordAt = 0;
  private chordNext: number;
  private driftNext: number;
  private beatNext: number;
  private beatIndex = 0;
  private bellNext: number[];
  private bellExtra: Array<{ time: number; loop: number }> = [];
  private clusterNext: number;
  private arpDue: number;
  private arpCount = 0;
  private arpForced = false;
  private silentUntil = -Infinity;
  private pending: Array<{ kind: OneShot; time: number; opts: OneShotOptions }> = [];
  private labels: string[];

  constructor(options: ComposerOptions = {}) {
    this.seed = options.seed || 'facility';
    this.voices = Math.max(4, Math.min(8, Math.round(options.voices ?? 5)));
    const t0 = options.startTime ?? 0;
    this.now = t0;
    this.chordNext = t0;
    this.driftNext = t0 + 3;
    this.beatNext = t0 + T.firstBeat;
    this.bellNext = T.bellLoops.map((l) => t0 + l.first);
    this.clusterNext = t0 + 20;
    this.arpDue = t0;
    this.labels = Array.from({ length: this.voices }, () => 'pad');
    this.reseed(this.seed);
  }

  /**
   * Change the seed while playing. The chord sounding, the drone and the beat carry on; what comes
   * next follows the new seed.
   */
  reseed(seed: string): void {
    this.seed = seed || 'facility';
    this.rChord = rng(this.seed);
    this.rDrift = rng(this.seed + '/drift');
    this.rArp = rng(this.seed + '/arp');
    this.rHeart = rng(this.seed + '/heart');
    this.rBells = rng(this.seed + '/bells');
    this.rCluster = rng(this.seed + '/cluster');
  }

  /** Ask for a one-shot at a time (not before the last `advance`). It appears in the next `advance`. */
  trigger(kind: OneShot, time: number, opts: OneShotOptions = {}): void {
    this.pending.push({ kind, time: Math.max(time, this.now), opts });
    this.pending.sort((a, b) => a.time - b.time);
  }

  /** What is sounding, for display. */
  get current(): { root: number; minor: boolean; notes: number[]; pcs: number[]; drone: number | null; home: number; blends: string[] } | null {
    return this.chord ? { ...this.chord, notes: [...this.notes], pcs: [...this.pcs], drone: this.drone, home: this.home, blends: [...this.labels] } : null;
  }

  /** Decide every event that starts before `until`, using `params` for each decision. Events come back in time order. */
  advance(until: number, params: Params): MusicEvent[] {
    const out: MusicEvent[] = [];
    if (!(until > this.now)) return out;
    // a chord chosen under a slower pace must not outstay the pace asked for now
    if (this.chord) this.chordNext = Math.max(this.now, Math.min(this.chordNext, this.chordAt + chordSeconds(params.pace)[1]));
    for (let guard = 0; guard < 20000; guard++) {
      let t = this.pending.length ? this.pending[0].time : Infinity;
      let what = this.pending.length ? 'pending' : '';
      const consider = (time: number, name: string): void => {
        if (time < t) {
          t = time;
          what = name;
        }
      };
      consider(this.chordNext, 'chord');
      consider(this.beatNext, 'beat');
      consider(this.driftNext, 'drift');
      consider(this.clusterNext, 'cluster');
      this.bellNext.forEach((time, i) => consider(time, 'bell' + i));
      if (this.bellExtra.length) consider(this.bellExtra[0].time, 'extra');
      if (!(t < until)) break;
      if (what === 'pending') this.oneShot(this.pending.shift()!, params, out);
      else if (what === 'chord') this.nextChord(t, params, out, false);
      else if (what === 'beat') this.beat(t, params, out);
      else if (what === 'drift') this.driftStep(t, params, out);
      else if (what === 'cluster') this.clusterStep(t, params, out);
      else if (what === 'extra') this.strike(t, this.bellExtra.shift()!.loop, params, out);
      else this.bellStep(t, Number(what.slice(4)), params, out);
    }
    this.now = until;
    return out.sort((a, b) => a.time - b.time);
  }

  // ---- harmony -------------------------------------------------------------------------------

  private inHome(root: number, minor: boolean): boolean {
    const third = minor ? 3 : 4;
    return [0, third, 7].every((s) => MAJOR_SCALE.includes(mod(root + s - this.home, 12)));
  }

  private pickMove(p: Params, sting: boolean): MoveKey {
    const chord = this.chord!;
    if (sting) return T.stingMoves[Math.floor(this.rChord() * T.stingMoves.length)];
    const lean = (p.mode - 0.5) * 2;
    const items: Array<[MoveKey, number]> = MOVE_KEYS.map((key) => {
      const def = MOVE_TABLE[key];
      const [shift, toMinor] = chord.minor ? def.minor : def.major;
      let w = lerp(def.weight[0], def.weight[1], p.unease);
      if (def.keepsMode) w *= Math.abs(lean);
      w *= Math.exp(T.modeGain * lean * (toMinor ? -1 : 1));
      if (!this.inHome(mod(chord.root + shift, 12), toMinor)) w *= 1 - p.anchor * (1 - T.anchorLeak);
      if (this.lastMove && MOVE_TABLE[this.lastMove].inverse === key) w *= T.undoWeight;
      return [key, Math.max(0, w)];
    });
    return weighted(items, this.rChord());
  }

  private dress(minor: boolean, p: Params): DressingDef {
    const kind = minor ? 'minor' : 'major';
    if (this.rChord() >= p.colour) return PLAIN[kind];
    const items = DRESSINGS[kind].map((d): [DressingDef, number] => [d, lerp(d.weight[0], d.weight[1], p.brightness)]);
    return weighted(items, this.rChord());
  }

  private nextChord(t: number, p: Params, out: MusicEvent[], sting: boolean): void {
    const r = this.rChord;
    const first = !this.chord;
    let key: MoveKey | null = null;
    if (!this.chord) {
      const root = Math.floor(r() * 12);
      this.chord = { root, minor: r() < clamp(1.2 - p.mode) };
      this.home = this.chord.minor ? mod(root + 3, 12) : root;
    } else {
      key = this.pickMove(p, sting);
      const [shift, toMinor] = this.chord.minor ? MOVE_TABLE[key].minor : MOVE_TABLE[key].major;
      this.chord = { root: mod(this.chord.root + shift, 12), minor: toMinor };
      this.lastMove = key;
      // once the harmony has left its key, the place it has arrived is the new home
      if (!this.inHome(this.chord.root, this.chord.minor)) this.home = this.chord.minor ? mod(this.chord.root + 3, 12) : this.chord.root;
    }
    const chord = this.chord;

    const wanted = T.voiceCentre - Math.round(p.depth * T.depthDrop) + Math.round((p.register - 0.5) * T.registerSpan);
    this.centre = first ? wanted : this.centre + clamp(wanted - this.centre, -T.centreStep, T.centreStep);

    const dressing = this.dress(chord.minor, p);
    const pcs = [...new Set(dressing.steps.map((s) => mod(chord.root + s, 12)))];
    let clash: ChordEvent['clash'] = '';
    if (sting || r() < p.unease * T.clashChance * p.clash) {
      const step = r() < T.clashSemitoneShare ? 1 : 6;
      const pc = mod(chord.root + step, 12);
      if (!pcs.includes(pc) && pcs.length < this.voices) {
        pcs.push(pc);
        clash = step === 1 ? 'semitone' : 'tritone';
      }
    }

    const pool: number[] = [];
    for (let m = this.centre + T.voiceRange[0]; m <= this.centre + T.voiceRange[1]; m++) if (pcs.includes(mod(m, 12))) pool.push(m);
    const prev = first ? Array.from({ length: this.voices }, (_, i) => this.centre - 9 + i * 5) : this.notes;
    const notes = prev.map((m) => nearest(pool, m));
    // every chord note must sound: move the cheapest doubled voice onto any note left out
    for (const pc of pcs) {
      if (notes.some((m) => mod(m, 12) === pc)) continue;
      const candidates = pool.filter((m) => mod(m, 12) === pc);
      let best = -1;
      let cost = Infinity;
      let target = 0;
      notes.forEach((m, i) => {
        if (notes.filter((x) => mod(x, 12) === mod(m, 12)).length < 2) return;
        const to = nearest(candidates, prev[i]);
        if (Math.abs(to - prev[i]) < cost) {
          cost = Math.abs(to - prev[i]);
          best = i;
          target = to;
        }
      });
      if (best >= 0) notes[best] = target;
    }
    // no voice ever leaps more than an octave, even when the whole range has moved
    if (!first) {
      notes.forEach((m, i) => {
        let n = m;
        while (n - prev[i] > 12) n -= 12;
        while (prev[i] - n > 12) n += 12;
        notes[i] = n;
      });
    }

    const [lo, hi] = chordSeconds(p.pace);
    const duration = lo + r() * (hi - lo);
    const squeeze = Math.min(1, duration / T.fullStaggerSeconds);
    const voiceDelays = notes.map((_, i) => (first || sting ? 0 : (i * T.voiceStagger + r() * T.voiceStaggerJitter) * squeeze));
    const glide = first ? 0.05 : sting ? 0.08 : Math.max(0.25, T.voiceGlide * squeeze);

    // the drone holds a note the old and new chords share whenever it can
    const dronePcs = [chord.root, mod(chord.root + 7, 12)];
    let drone = this.drone;
    if (drone === null || !dronePcs.includes(mod(drone, 12))) {
      let m = T.droneBase - Math.round(p.depth * T.droneDepthDrop);
      while (!dronePcs.includes(mod(m, 12))) m++;
      drone = m;
    }

    this.notes = notes;
    this.pcs = pcs;
    this.drone = drone;
    this.chordAt = t;
    this.chordNext = t + duration;
    const def = key ? MOVE_TABLE[key] : null;
    out.push({
      type: 'chord',
      time: t,
      index: this.chordIndex++,
      root: chord.root,
      minor: chord.minor,
      dressing: dressing.id,
      name: NOTE_NAMES[chord.root] + dressing.suffix,
      move: key,
      moveLabel: def ? def.label : 'start',
      moveDescription: def ? def.description : 'starting chord',
      clash,
      pcs: [...pcs],
      notes: [...notes],
      voiceDelays,
      glide,
      drone,
      droneDelay: first ? 0 : sting ? 0.5 : 3 * squeeze,
      droneGlide: first ? 0.05 : Math.max(0.5, 3 * squeeze),
      duration,
      home: this.home,
      sting,
    });
  }

  // ---- bells ---------------------------------------------------------------------------------

  private bellStep(t: number, loop: number, p: Params, out: MusicEvent[]): void {
    const r = this.rBells;
    const def = T.bellLoops[loop];
    this.bellNext[loop] = t + def.period;
    if (p.bells <= 0 || !this.chord) return;
    if (r() < lerp(T.bellChance[0], T.bellChance[1], p.bells)) this.strike(t, loop, p, out);
    if (p.bells > T.bellSecondAbove && r() < (p.bells - T.bellSecondAbove) / (1 - T.bellSecondAbove)) {
      this.bellExtra.push({ time: t + def.period / 2, loop });
      this.bellExtra.sort((a, b) => a.time - b.time);
    }
  }

  private strike(t: number, loop: number, p: Params, out: MusicEvent[]): void {
    const r = this.rBells;
    const pc = this.pcs[Math.floor(r() * this.pcs.length)] ?? 0;
    const pan = clamp(((r() * 1.6 - 0.8) * p.width) / 0.7, -1, 1);
    if (t < this.silentUntil) return;
    let m = T.bellLoops[loop].low + Math.round((p.register - 0.5) * T.bellRegisterSpan);
    while (mod(m, 12) !== pc) m++;
    out.push({ type: 'bell', time: t + 0.05, midi: m, pan, level: 0.05 });
  }

  // ---- pulse: heartbeat, tick, arpeggio --------------------------------------------------------

  private beat(t: number, p: Params, out: MusicEvent[]): void {
    const r = this.rHeart;
    const length = 60 / p.pulse;
    const quiet = t < this.silentUntil;
    const thumps: BeatEvent['thumps'] = [];
    const ticks: BeatEvent['ticks'] = [];
    if (p.heartbeat > 0 && !quiet) {
      thumps.push({ time: t, level: 0.9 * p.heartbeat, top: 95 });
      thumps.push({ time: t + Math.min(0.34, length * 0.3), level: 0.62 * p.heartbeat, top: 78 });
    }
    if (p.tick > 0.02 && this.chord && !quiet) {
      const pattern = T.tickPatterns[p.flurry > T.tickFourAbove ? 4 : 2];
      let low = T.tickBase + Math.round((p.register - 0.5) * T.bellRegisterSpan);
      while (mod(low, 12) !== this.chord.root) low++;
      pattern.forEach((step, k) => ticks.push({ time: t + (k * length) / pattern.length, midi: low + step, level: 0.035 * p.tick * (k ? 0.6 : 1) }));
    }
    out.push({ type: 'beat', time: t, index: this.beatIndex++, bpm: p.pulse, level: quiet ? 0 : p.heartbeat, thumps, ticks });
    if (this.arpForced || t >= this.arpDue) this.run(t, p, out);
    // a real pulse is never perfectly even; a tick steadies it
    this.beatNext = t + length * (1 + (r() - 0.5) * T.beatWander * (1 - p.tick));
  }

  private run(t: number, p: Params, out: MusicEvent[]): void {
    const r = this.rArp;
    const forced = this.arpForced;
    this.arpForced = false;
    const length = 60 / p.pulse;
    const excess = Math.max(0, p.flurry - T.flurryNeutral) / (1 - T.flurryNeutral);
    let seconds = 0;
    if ((p.arpeggio > 0 || forced) && this.pcs.length && t >= this.silentUntil) {
      const rates = T.arpeggioRates.find((row) => p.flurry <= row.upTo) ?? T.arpeggioRates[T.arpeggioRates.length - 1];
      let perBeat: number = rates.perBeat[r() < 0.5 ? 0 : 1];
      while (perBeat > 2 && length / perBeat < T.arpeggioFastest) perBeat--;
      const step = length / perBeat;
      const beats = Math.round((T.arpeggioBeats[0] + Math.floor(r() * (T.arpeggioBeats[1] - T.arpeggioBeats[0] + 1))) * (1 + (T.flurryStretch - 1) * excess));
      const count = perBeat * beats;
      const shape = Math.floor(r() * 3);
      // the chord's notes over two octaves, low to high
      const base = T.arpeggioBase - Math.round(p.depth * T.arpeggioDepthDrop) + Math.round((p.register - 0.5) * T.arpeggioRegisterSpan);
      const ladder: number[] = [];
      for (let m = base; m < base + 25; m++) if (this.pcs.includes(mod(m, 12))) ladder.push(m);
      const offset = Math.floor(r() * 3);
      const notes: ArpeggioEvent['notes'] = [];
      for (let n = 0; n < count; n++) {
        let idx: number;
        if (shape === 0) idx = (offset + n) % ladder.length;
        else if (shape === 1) {
          const round = ladder.length * 2 - 2;
          const k = (offset + n) % round;
          idx = k < ladder.length ? k : round - k;
        } else idx = (offset + n * 2 + (n % 2 ? 1 : 0)) % ladder.length;
        const swell = Math.sin((Math.PI * (n + 0.5)) / count);
        notes.push({ time: t + n * step + (r() - 0.5) * 0.012 + 0.006, midi: ladder[idx], level: 0.06 * swell + 0.008, pan: Math.sin(n * 0.9) * 0.5 * (p.width / 0.7) });
      }
      seconds = count * step;
      out.push({ type: 'arpeggio', time: t, notes, step, perBeat, echo: Math.min(1.4, step * 3), forced });
    }
    // wait for the next one: long and irregular, shorter as flurry rises
    let wait: number;
    if (this.arpCount++ === 0) wait = span(T.secondArpeggioWait, r());
    else if (p.arpeggio > 0) wait = span(T.arpeggioWait, r()) / (0.25 + p.arpeggio * 0.9) / (1 + (T.flurryStretch - 1) * excess);
    else wait = 20;
    this.arpDue = t + Math.max(wait, seconds + length);
  }

  // ---- the synth's own wandering -----------------------------------------------------------------

  private driftStep(t: number, p: Params, out: MusicEvent[]): void {
    const r = this.rDrift;
    const d = p.drift;
    const tempo = lerp(T.driftPaceScale[0], T.driftPaceScale[1], p.pace);
    const voice = Math.floor(r() * this.voices);
    const glide = (6 + r() * 5) * tempo;
    // a new blend of the waveforms: at no drift it is the saw and triangle pad; with drift any layer may lead
    const lead = LAYER_NAMES[Math.floor(r() * LAYER_NAMES.length)];
    const second = LAYER_NAMES[Math.floor(r() * LAYER_NAMES.length)];
    const blend = {} as Record<LayerName, number>;
    for (const name of LAYER_NAMES) {
      const peak = LAYERS[name].peak;
      const target = name === lead ? peak : name === second ? peak * 0.5 : peak * 0.08;
      blend[name] = LAYERS[name].pad * (1 - d) + target * d;
    }
    const label = d < 0.05 ? 'pad' : lead + (second !== lead ? '+' + second : '');
    this.labels[voice] = label;
    const open = Math.pow(2, (p.brightness - 0.5) * 2);
    const spread = 5 + d * r() * 22;
    const pan = clamp((((r() * 2 - 1) * (0.3 + 0.6 * d)) * p.width) / 0.7, -1, 1);
    const filter = 500 * Math.pow(2, (r() * 2.4 - 0.7) * (0.3 + d)) * open;
    const q = 0.8 + r() * 5 * d;
    const wetScale = (0.45 + r() * 0.4 * d) / 0.55;
    out.push({ type: 'drift', time: t, voice, blend, label, spread, pan, filter, q, sweep: 300 + 1800 * d, wetScale, toneSweep: 150 + 500 * d, glide });
    this.driftNext = t + (6 + r() * 7) * tempo;
  }

  private clusterStep(t: number, p: Params, out: MusicEvent[]): void {
    const r = this.rCluster;
    const roll = r();
    const duration = span(T.clusterSeconds, r());
    const low = Math.round(span(T.clusterLow, r()));
    const gap = span(T.clusterGap, r());
    this.clusterNext = t + Math.max(duration + 4, gap * (1.3 - p.cluster));
    if (p.cluster <= 0.05 || roll >= p.cluster || t < this.silentUntil) return;
    const steps = p.cluster > T.clusterWideAbove ? T.clusterWideSteps : T.clusterSteps;
    out.push({ type: 'cluster', time: t, duration, notes: steps.map((s) => low + s), rise: 1 + p.cluster * 4, level: 0.012 + 0.03 * p.cluster });
  }

  // ---- one-shots a host can fire -------------------------------------------------------------------

  private oneShot(shot: { kind: OneShot; time: number; opts: OneShotOptions }, p: Params, out: MusicEvent[]): void {
    const t = shot.time;
    const amount = clamp(shot.opts.amount ?? 0.7);
    if (shot.kind === 'sting') {
      if (!this.chord) return;
      this.silentUntil = -Infinity;
      this.nextChord(t, p, out, true);
      out.push({ type: 'hit', time: t, level: 0.4 + 0.6 * amount });
      // two bells a semitone apart, high up
      let m = 79 + Math.round((p.register - 0.5) * T.bellRegisterSpan);
      while (mod(m, 12) !== this.chord!.root) m++;
      out.push({ type: 'bell', time: t + 0.02, midi: m, pan: -0.4 * (p.width / 0.7), level: 0.05 + 0.05 * amount });
      out.push({ type: 'bell', time: t + 0.09, midi: m + 1, pan: 0.4 * (p.width / 0.7), level: 0.04 + 0.05 * amount });
    } else if (shot.kind === 'arpeggio') {
      // it starts on the next beat, so it is in time
      this.arpForced = true;
    } else if (shot.kind === 'swell') {
      out.push({ type: 'swell', time: t, duration: clamp(shot.opts.seconds ?? 8, 1, 60), amount });
    } else if (shot.kind === 'silence') {
      const duration = clamp(shot.opts.seconds ?? 6, 0.5, 120);
      this.silentUntil = t + duration;
      this.arpForced = false;
      out.push({ type: 'silence', time: t, duration, fade: Math.min(1.2, duration / 3) });
    }
  }
}

export function createComposer(options?: ComposerOptions): Composer {
  return new Composer(options);
}
