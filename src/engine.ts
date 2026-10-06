import { type ArpeggioEvent, type BeatEvent, type BellEvent, type ChordEvent, type ClusterEvent, type DriftEvent, type MusicEvent, Composer } from './composer.js';
import { type Message, type OneShot, parseMessage } from './messages.js';
import type { MoodWeights } from './moods.js';
import { type Axes, type ParamName, type Params, PARAM_NAMES } from './params.js';
import type { PromptResult } from './prompt.js';
import { Renderer } from './renderer.js';
import { type District, Steering } from './steering.js';
import type { MoveKey } from './tables.js';

export interface EngineOptions {
  /** The host's audio context. Without one the engine makes its own on `start()`. */
  context?: BaseAudioContext;
  /** Where the engine's output goes: the host's music bus. Default: the context's destination. */
  destination?: AudioNode;
  /** Same seed, same music. */
  seed?: string;
  /**
   * The engine's own long reverb: true or 1 for all of it, a number 0..1 for less, false or 0 for
   * none (no convolver is built). A host with its own room reverb wants this off or low.
   */
  reverb?: number | boolean;
  /** A gentle compressor on the engine's output. Default true. */
  compressor?: boolean;
  /** Number of pad voices, 4 to 8. Default 5. */
  voices?: number;
  /** Seconds of music scheduled ahead of the audio clock. Default 0.35. */
  lookahead?: number;
  /** False if the host will call `tick()` itself (from its frame loop, say) instead of the engine's own timer. */
  timer?: boolean;
  /** A district to start in. */
  district?: District;
}

export interface GlideOptions {
  /** Seconds over which the change comes in. */
  glide?: number;
}

export interface SendResult {
  ok: boolean;
  /** The message as understood: clean, serialisable, what a host would store or post. */
  message?: Message;
  /** For a prompt (or a district with one): what the parser made of it. */
  understood?: PromptResult['understood'];
  ignored?: string[];
  /** Mood names that are not registered. */
  unknown?: string[];
  error?: string;
}

export interface EngineState {
  running: boolean;
  /** 'none' when there is no Web Audio here; otherwise the context's own state. */
  audio: 'none' | 'running' | 'suspended' | 'closed' | 'interrupted';
  seed: string;
  /** The district last entered, by name. */
  district: string | null;
  /** Seconds on the engine's clock. */
  time: number;
  chord: { name: string; root: number; minor: boolean; dressing: string; notes: number[]; drone: number; clash: ChordEvent['clash']; index: number } | null;
  /** What moved to reach this chord. */
  move: { key: MoveKey | null; label: string; description: string } | null;
  /** What leads each voice's blend of waveforms. */
  blends: string[];
  bpm: number;
  axes: Axes;
  moods: MoodWeights;
  /** Parameters pinned by the mood or prompt, and by `set`. */
  pinned: Partial<Params>;
  overrides: Partial<Params>;
  /** The parameters right now, part-way through any glide, and where they are heading. */
  params: Params;
  target: Params;
}

export interface EngineEvents {
  chord: ChordEvent;
  arpeggio: ArpeggioEvent;
  beat: BeatEvent;
  bell: BellEvent;
  drift: DriftEvent;
  cluster: ClusterEvent;
  /** Every message the engine accepts, however it was sent. */
  message: Message;
  /** Started or stopped. */
  state: EngineState;
}
export type EngineEventName = keyof EngineEvents;

export interface MusicEngine {
  /** Begin playing. Call it from a user gesture if the engine owns the audio context. False if it could not. */
  start(): boolean;
  /** Fade out and release the audio nodes. `start()` begins again from the top of the seed. */
  stop(): void;
  /** Stop at once, release everything, forget every listener. The engine is finished. */
  dispose(): void;
  /** Pin low-level parameters; `null` releases one back to the mood and axes. */
  set(params: Partial<Record<ParamName, number | null>>, options?: GlideOptions): SendResult;
  /** Move along the axes; any axis left out stays where it is. */
  steer(axes: Partial<Axes>, options?: GlideOptions): SendResult;
  /** Take a named mood, or a blend by weight. */
  mood(mood: string | MoodWeights, options?: GlideOptions): SendResult;
  /** Describe the music in plain words. */
  prompt(text: string, options?: GlideOptions): SendResult;
  /** Cross over to a district's music. */
  enter(district: District, options?: GlideOptions): SendResult;
  /** Fire a one-shot: 'sting', 'arpeggio', 'swell' or 'silence'. */
  fire(event: OneShot, options?: { seconds?: number; amount?: number }): SendResult;
  /** Everything above as one serialisable message; also accepts JSON text. Never throws. */
  send(message: Message | string | unknown): SendResult;
  on<K extends EngineEventName>(name: K, fn: (event: EngineEvents[K]) => void): () => void;
  /** Do the scheduling now. Only needed with `timer: false`, or to catch up after the page was hidden. */
  tick(): void;
  readonly state: EngineState;
  readonly seed: string;
  /** The audio context in use, once there is one. */
  readonly context: BaseAudioContext | null;
  /** Live audio nodes, for watching a node budget. */
  readonly nodeCount: number;
}

/** Default glide, in seconds, for each kind of change. */
export const DEFAULT_GLIDE = { set: 3, steer: 6, mood: 8, prompt: 8, enter: 30, reset: 8 } as const;

const TICK_MS = 100;
const HIDDEN_LOOKAHEAD = 2.5;
const smooth = (x: number): number => x * x * (3 - 2 * x);

interface Glide {
  from: number;
  to: number;
  start: number;
  seconds: number;
}

class Engine implements MusicEngine {
  private readonly options: EngineOptions;
  private readonly steering = new Steering();
  private readonly glides = {} as Record<ParamName, Glide>;
  private readonly listeners = new Map<EngineEventName, Set<(event: never) => void>>();
  private ctx: BaseAudioContext | null;
  private ownsContext = false;
  private composer: Composer | null = null;
  private renderer: Renderer | null = null;
  private queue: MusicEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private teardown: { timer: ReturnType<typeof setTimeout>; run: () => void } | null = null;
  private running = false;
  private disposed = false;
  private districtName: string | null = null;
  private lastChord: ChordEvent | null = null;
  private lastBeat: BeatEvent | null = null;
  private blends: string[] = [];
  private wallStart = 0;
  private _seed: string;
  private readonly onVisible = (): void => {
    if (!this.running) return;
    if (typeof document !== 'undefined' && !document.hidden) this.wake();
    this.tick();
  };

  constructor(options: EngineOptions) {
    this.options = options;
    this.ctx = options.context ?? null;
    this._seed = options.seed || options.district?.seed || 'facility';
    if (options.district) {
      this.steering.enter(options.district);
      this.districtName = options.district.name ?? null;
    }
    const target = this.steering.target();
    for (const k of PARAM_NAMES) this.glides[k] = { from: target[k], to: target[k], start: 0, seconds: 0 };
  }

  get seed(): string {
    return this._seed;
  }
  get context(): BaseAudioContext | null {
    return this.ctx;
  }
  get nodeCount(): number {
    return this.renderer?.nodeCount ?? 0;
  }

  // ---- time and parameters ------------------------------------------------------------------------

  private now(): number {
    if (this.ctx) return this.ctx.currentTime;
    const wall = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return (wall - this.wallStart) / 1000;
  }

  private paramsAt(t: number): Params {
    const out = {} as Params;
    for (const k of PARAM_NAMES) {
      const g = this.glides[k];
      const x = g.seconds > 0 ? Math.min(1, Math.max(0, (t - g.start) / g.seconds)) : 1;
      out[k] = g.from + (g.to - g.from) * smooth(x);
    }
    return out;
  }

  private retarget(seconds: number): void {
    const t = this.now();
    const current = this.paramsAt(t);
    const target = this.steering.target();
    const glide = this.running ? Math.max(0, seconds) : 0;
    for (const k of PARAM_NAMES) {
      if (this.glides[k].to === target[k] && glide > 0) continue;
      this.glides[k] = { from: glide > 0 ? current[k] : target[k], to: target[k], start: t, seconds: glide };
    }
  }

  // ---- transport ------------------------------------------------------------------------------------

  start(): boolean {
    if (this.disposed) return false;
    if (this.running) return true;
    try {
      this.flushTeardown();
      if (!this.ctx) {
        const g = globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
        const AC = g.AudioContext ?? g.webkitAudioContext;
        if (AC) {
          try {
            this.ctx = new AC();
            this.ownsContext = true;
          } catch {
            this.ctx = null;
          }
        }
      }
      this.wallStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
      this.wake();
      if (this.ctx) {
        try {
          const reverb = this.options.reverb;
          this.renderer = new Renderer(this.ctx, this.options.destination ?? this.ctx.destination, {
            reverb: reverb === undefined || reverb === true ? 1 : reverb === false ? 0 : reverb,
            compressor: this.options.compressor,
            voices: this.options.voices,
          });
        } catch {
          // no sound, but the composer still runs so a host can show what would be playing
          this.renderer?.release();
          this.renderer = null;
        }
      }
      const t = this.now();
      this.composer = new Composer({ seed: this._seed, voices: this.options.voices, startTime: t + 0.05 });
      this.running = true;
      this.retarget(0);
      this.renderer?.apply(this.paramsAt(t), t, true);
      this.blends = this.composer.current?.blends ?? Array.from({ length: this.composer.voices }, () => 'pad');
      if (this.options.timer !== false) this.timer = setInterval(() => this.tick(), TICK_MS);
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisible);
      this.tick();
      this.emit('state', this.state);
      return true;
    } catch {
      this.halt(true);
      return false;
    }
  }

  /** Ask a suspended context to run. It may refuse until there has been a user gesture; that is not an error. */
  private wake(): void {
    const ctx = this.ctx as AudioContext | null;
    try {
      if (ctx && ctx.state !== 'running' && ctx.state !== 'closed' && typeof ctx.resume === 'function') void ctx.resume().catch(() => {});
    } catch {
      /* stays suspended */
    }
  }

  tick(): void {
    if (!this.running || !this.composer) return;
    try {
      const now = this.now();
      const params = this.paramsAt(now);
      const hidden = typeof document !== 'undefined' && document.hidden;
      const ahead = hidden ? HIDDEN_LOOKAHEAD : this.options.lookahead ?? 0.35;
      for (const ev of this.composer.advance(now + ahead, params)) {
        this.renderer?.play(ev, now);
        this.queue.push(ev);
      }
      this.renderer?.apply(params, now);
      this.renderer?.sweep(now);
      // tell listeners about each event when it sounds, not when it was scheduled
      let due = 0;
      while (due < this.queue.length && this.queue[due].time <= now + TICK_MS / 2000) due++;
      for (const ev of this.queue.splice(0, due)) this.announce(ev);
    } catch {
      /* one bad tick must not stop the music or the host */
    }
  }

  private announce(ev: MusicEvent): void {
    if (ev.type === 'chord') this.lastChord = ev;
    else if (ev.type === 'beat') this.lastBeat = ev;
    else if (ev.type === 'drift') this.blends[ev.voice] = ev.label;
    if (ev.type === 'hit' || ev.type === 'swell' || ev.type === 'silence') return;
    this.emit(ev.type, ev as never);
  }

  stop(): void {
    if (!this.running) return;
    this.halt(false);
    this.emit('state', this.state);
  }

  private halt(immediately: boolean): void {
    this.running = false;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisible);
    const renderer = this.renderer;
    const ctx = this.ownsContext ? (this.ctx as AudioContext | null) : null;
    this.renderer = null;
    this.composer = null;
    this.queue = [];
    this.lastChord = null;
    this.lastBeat = null;
    this.blends = [];
    if (ctx) {
      this.ctx = null;
      this.ownsContext = false;
    }
    const run = (): void => {
      this.teardown = null;
      try {
        renderer?.release();
        if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => {});
      } catch {
        /* nothing more to do */
      }
    };
    if (immediately || !renderer) return run();
    try {
      renderer.fadeOut(renderer.ctx.currentTime);
    } catch {
      /* release will still happen */
    }
    this.teardown = { timer: setTimeout(run, 1600), run };
  }

  private flushTeardown(): void {
    if (!this.teardown) return;
    clearTimeout(this.teardown.timer);
    this.teardown.run();
  }

  dispose(): void {
    if (this.disposed) return;
    if (this.running) this.halt(true);
    this.flushTeardown();
    this.disposed = true;
    this.listeners.clear();
  }

  // ---- steering ---------------------------------------------------------------------------------

  set(params: Partial<Record<ParamName, number | null>>, options?: GlideOptions): SendResult {
    return this.send({ type: 'set', params, ...options });
  }
  steer(axes: Partial<Axes>, options?: GlideOptions): SendResult {
    return this.send({ type: 'steer', axes, ...options });
  }
  mood(mood: string | MoodWeights, options?: GlideOptions): SendResult {
    return this.send({ type: 'mood', mood, ...options });
  }
  prompt(text: string, options?: GlideOptions): SendResult {
    return this.send({ type: 'prompt', text, ...options });
  }
  enter(district: District, options?: GlideOptions): SendResult {
    return this.send({ type: 'enter', district, ...options });
  }
  fire(event: OneShot, options?: { seconds?: number; amount?: number }): SendResult {
    return this.send({ type: 'event', event, ...options });
  }

  send(input: unknown): SendResult {
    if (this.disposed) return { ok: false, error: 'disposed' };
    try {
      const m = parseMessage(input);
      if (!m) return { ok: false, error: 'not a message' };
      const result: SendResult = { ok: true, message: m };
      switch (m.type) {
        case 'set':
          this.steering.set(m.params);
          this.retarget(m.glide ?? DEFAULT_GLIDE.set);
          break;
        case 'steer':
          this.steering.steer(m.axes);
          this.retarget(m.glide ?? DEFAULT_GLIDE.steer);
          break;
        case 'mood': {
          const blend = this.steering.mood(m.mood);
          if (blend.unknown.length) result.unknown = blend.unknown;
          this.retarget(m.glide ?? DEFAULT_GLIDE.mood);
          break;
        }
        case 'prompt': {
          const parsed = this.steering.prompt(m.text);
          result.understood = parsed.understood;
          result.ignored = parsed.ignored;
          this.retarget(m.glide ?? DEFAULT_GLIDE.prompt);
          break;
        }
        case 'seed':
          this._seed = m.seed || 'facility';
          this.composer?.reseed(this._seed);
          break;
        case 'enter': {
          const parsed = this.steering.enter(m.district);
          if (parsed) {
            result.understood = parsed.understood;
            result.ignored = parsed.ignored;
          }
          this.districtName = m.district.name ?? null;
          if (m.district.seed) {
            this._seed = m.district.seed;
            this.composer?.reseed(this._seed);
          }
          this.retarget(m.glide ?? DEFAULT_GLIDE.enter);
          break;
        }
        case 'event':
          if (!this.composer) return { ok: false, message: m, error: 'not running' };
          this.composer.trigger(m.event, this.now() + 0.03, { seconds: m.seconds, amount: m.amount });
          break;
        case 'reset':
          this.steering.reset();
          this.districtName = null;
          this.retarget(m.glide ?? DEFAULT_GLIDE.reset);
          break;
      }
      this.emit('message', m);
      return result;
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  }

  // ---- watching -----------------------------------------------------------------------------------

  on<K extends EngineEventName>(name: K, fn: (event: EngineEvents[K]) => void): () => void {
    let set = this.listeners.get(name);
    if (!set) this.listeners.set(name, (set = new Set()));
    set.add(fn as (event: never) => void);
    return () => void set.delete(fn as (event: never) => void);
  }

  private emit<K extends EngineEventName>(name: K, event: EngineEvents[K]): void {
    const set = this.listeners.get(name);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        (fn as (event: EngineEvents[K]) => void)(event);
      } catch {
        /* a listener's mistake is not the engine's */
      }
    }
  }

  get state(): EngineState {
    const t = this.now();
    const params = this.paramsAt(t);
    const c = this.lastChord;
    const snap = this.steering.snapshot();
    return {
      running: this.running,
      audio: this.ctx ? ((this.ctx as AudioContext).state ?? 'running') : 'none',
      seed: this._seed,
      district: this.districtName,
      time: t,
      chord: c ? { name: c.name, root: c.root, minor: c.minor, dressing: c.dressing, notes: [...c.notes], drone: c.drone, clash: c.clash, index: c.index } : null,
      move: c ? { key: c.move, label: c.moveLabel, description: c.moveDescription } : null,
      blends: [...this.blends],
      bpm: this.lastBeat?.bpm ?? params.pulse,
      axes: snap.axes,
      moods: snap.moods,
      pinned: snap.pinned,
      overrides: snap.overrides,
      params,
      target: this.steering.target(),
    };
  }
}

/**
 * Make a music engine. Nothing sounds, and no audio context is made, until `start()`.
 * It never throws: where there is no Web Audio it still composes, silently.
 */
export function createMusicEngine(options: EngineOptions = {}): MusicEngine {
  return new Engine(options ?? {});
}
