import type { ArpeggioEvent, BeatEvent, BellEvent, ChordEvent, ClusterEvent, DriftEvent, MusicEvent } from './composer.js';
import type { Params } from './params.js';
import { hz, rng } from './rng.js';
import { type LayerName, LAYERS, LAYER_NAMES } from './tables.js';

/*
 * The renderer turns the composer's events into sound with Web Audio. It owns a node graph that it
 * builds once, plays events onto the audio clock, and can release every node it ever made.
 * It reads no clock of its own and sets no timers: the engine tells it what time it is.
 */

export interface RendererOptions {
  /** 0..1: how much of the engine's own long reverb is used. 0 builds no reverb at all. */
  reverb?: number;
  /** Whether the output passes through a gentle compressor. */
  compressor?: boolean;
  voices?: number;
}

interface Voice {
  oscs: OscillatorNode[];
  layers: Record<LayerName, GainNode>;
  filt: BiquadFilterNode;
  sweepG: GainNode;
  pan: AudioParam | null;
}

interface Transient {
  until: number;
  nodes: AudioNode[];
}

type Source = AudioScheduledSourceNode;

const SWEEP_PERIODS = [47, 61, 83, 107, 131, 149, 167, 191];

export class Renderer {
  readonly ctx: BaseAudioContext;
  private readonly reverb: number;
  private nodes = new Set<AudioNode>();
  private sources = new Set<Source>();
  private transients: Transient[] = [];
  private voices: Voice[] = [];
  private master!: GainNode;
  private duck!: GainNode;
  private bus!: GainNode;
  private pad!: GainNode;
  private tone!: BiquadFilterNode;
  private wet: GainNode | null = null;
  private drone: OscillatorNode[] = [];
  private airG!: GainNode;
  private airF!: BiquadFilterNode;
  private sweepD!: GainNode;
  private echo!: DelayNode;
  private heartDry!: GainNode;
  private heartWet!: GainNode;
  private wetScale = 1;
  private applied: Partial<Record<'level' | 'tone' | 'air' | 'airF' | 'wet', number>> = {};
  private released = false;

  constructor(ctx: BaseAudioContext, destination: AudioNode, options: RendererOptions = {}) {
    this.ctx = ctx;
    this.reverb = Math.max(0, Math.min(1, options.reverb ?? 1));
    this.build(destination, options.compressor ?? true, Math.max(4, Math.min(8, Math.round(options.voices ?? 5))));
  }

  /** How many nodes are alive: for tests and for watching a host's node budget. */
  get nodeCount(): number {
    return this.nodes.size;
  }

  // ---- building ---------------------------------------------------------------------------------

  private keep<N extends AudioNode>(node: N): N {
    this.nodes.add(node);
    return node;
  }

  private gain(value: number): GainNode {
    const g = this.keep(this.ctx.createGain());
    g.gain.value = value;
    return g;
  }

  private osc(type: OscillatorType | PeriodicWave, frequency: number, detune = 0): OscillatorNode {
    const o = this.keep(this.ctx.createOscillator());
    if (typeof type === 'string') o.type = type as OscillatorType;
    else o.setPeriodicWave(type);
    o.frequency.value = frequency;
    o.detune.value = detune;
    this.sources.add(o);
    return o;
  }

  /** A stereo position, or a plain pass-through where the browser has no panner. */
  private panner(value: number): { node: AudioNode; pan: AudioParam | null } {
    if (typeof this.ctx.createStereoPanner !== 'function') return { node: this.gain(1), pan: null };
    const p = this.keep(this.ctx.createStereoPanner());
    p.pan.value = value;
    return { node: p, pan: p.pan };
  }

  private impulse(seconds: number): AudioBuffer {
    const rand = rng('room');
    const n = Math.floor(this.ctx.sampleRate * seconds);
    const b = this.ctx.createBuffer(2, n, this.ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        lp += (rand() * 2 - 1 - lp) * (0.5 - 0.42 * t);
        d[i] = lp * Math.pow(1 - t, 2.6);
      }
    }
    return b;
  }

  private noise(): AudioBufferSourceNode {
    const rand = rng('air');
    const n = Math.floor(this.ctx.sampleRate * 4);
    const b = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      last = (last + 0.02 * (rand() * 2 - 1)) / 1.02;
      d[i] = last * 3.2;
    }
    const s = this.keep(this.ctx.createBufferSource());
    s.buffer = b;
    s.loop = true;
    this.sources.add(s);
    return s;
  }

  private build(destination: AudioNode, compressor: boolean, voiceCount: number): void {
    const ctx = this.ctx;
    this.master = this.gain(0);
    this.duck = this.gain(1);
    this.bus = this.gain(1);
    const dry = this.gain(0.5);
    this.bus.connect(dry).connect(this.master);
    if (this.reverb > 0) {
      const verb = this.keep(ctx.createConvolver());
      verb.buffer = this.impulse(7);
      this.wet = this.gain(0.55 * this.reverb);
      this.bus.connect(verb).connect(this.wet).connect(this.master);
    }
    if (compressor) {
      const comp = this.keep(ctx.createDynamicsCompressor());
      comp.threshold.value = -18;
      comp.ratio.value = 3;
      this.master.connect(comp).connect(this.duck);
    } else this.master.connect(this.duck);
    this.duck.connect(destination);

    this.tone = this.keep(ctx.createBiquadFilter());
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 2000;
    this.tone.Q.value = 0.6;
    this.pad = this.gain(1);
    this.tone.connect(this.pad).connect(this.bus);

    // two drawn waveforms: glass has only odd partials with the fifth and ninth strong; reed has every partial, peaking round the sixth
    const wave = (amps: number[]): PeriodicWave => ctx.createPeriodicWave(new Float32Array(amps.length + 1), new Float32Array([0, ...amps]));
    const glass = wave([1, 0, 0.18, 0, 0.5, 0, 0.1, 0, 0.3, 0, 0.06, 0, 0.12]);
    const reed = wave([1, 0.45, 0.3, 0.28, 0.4, 0.55, 0.42, 0.2, 0.12, 0.08, 0.05, 0.04]);

    for (let i = 0; i < voiceCount; i++) {
      const g = this.gain(0.085);
      const place = voiceCount > 1 ? (i / (voiceCount - 1)) * 1.4 - 0.7 : 0;
      const pan = this.panner(place);
      // six layers per voice, each a different waveform with its own level, so the blend can drift:
      // a saw pair (bright), a triangle (soft), a square (hollow), a glassy wave of odd partials,
      // a reedy wave with a nasal peak, and a sine an octave up (air)
      const spec: Array<[OscillatorType | PeriodicWave, number, LayerName]> = [
        ['sawtooth', -7, 'bright'],
        ['sawtooth', 6, 'bright'],
        ['triangle', 0, 'soft'],
        ['square', 3, 'hollow'],
        [glass, -4, 'glass'],
        [reed, 5, 'reed'],
        ['sine', 1200, 'air'],
      ];
      const layers = {} as Record<LayerName, GainNode>;
      for (const name of LAYER_NAMES) layers[name] = this.gain(LAYERS[name].pad);
      const oscs = spec.map(([type, cents, to]) => {
        const o = this.osc(type, 110, cents + i * 1.5);
        o.connect(layers[to]);
        o.start();
        return o;
      });
      // the voice's own filter, swept over more than two octaves by a very slow wave
      const filt = this.keep(ctx.createBiquadFilter());
      filt.type = 'lowpass';
      filt.frequency.value = 900;
      filt.Q.value = 1.2;
      const sweepL = this.osc('sine', 1 / SWEEP_PERIODS[i % SWEEP_PERIODS.length]);
      const sweepG = this.gain(1400);
      sweepL.connect(sweepG).connect(filt.detune);
      sweepL.start();
      for (const name of LAYER_NAMES) layers[name].connect(filt);
      filt.connect(g);
      // each voice breathes at its own slow rate
      const lfo = this.osc('sine', 0.031 + 0.011 * i);
      const depth = this.gain(0.03);
      lfo.connect(depth).connect(g.gain);
      lfo.start();
      g.connect(pan.node).connect(this.tone);
      this.voices.push({ oscs, layers, filt, sweepG, pan: pan.pan });
    }

    this.drone = [0, 1].map((i) => {
      const o = this.osc('sine', 55, i ? 9 : -9);
      o.connect(this.gain(0.16)).connect(this.bus);
      o.start();
      return o;
    });

    const air = this.noise();
    this.airF = this.keep(ctx.createBiquadFilter());
    this.airF.type = 'bandpass';
    this.airF.frequency.value = 320;
    this.airF.Q.value = 0.5;
    this.airG = this.gain(0.03);
    air.connect(this.airF).connect(this.airG).connect(this.bus);
    air.start();

    const sweep = this.osc('sine', 1 / 173);
    this.sweepD = this.gain(350);
    sweep.connect(this.sweepD).connect(this.tone.frequency);
    sweep.start();

    // an echo for the arpeggio: each note repeats, quieter, three steps later
    this.echo = this.keep(ctx.createDelay(2));
    this.echo.delayTime.value = 0.6;
    const echoFb = this.gain(0.42);
    const echoOut = this.gain(0.5);
    this.echo.connect(echoFb).connect(this.echo);
    this.echo.connect(echoOut).connect(this.bus);

    // the heartbeat goes almost straight to the output, with only a little of the room
    this.heartDry = this.gain(0.9);
    this.heartDry.connect(this.master);
    this.heartWet = this.gain(0.12);
    this.heartWet.connect(this.bus);
  }

  // ---- continuous parameters ----------------------------------------------------------------------

  private glideTo(key: keyof Renderer['applied'], param: AudioParam, value: number, now: number, tc: number): void {
    const last = this.applied[key];
    if (last !== undefined && Math.abs(last - value) <= Math.abs(value) * 1e-4 + 1e-6) return;
    this.applied[key] = value;
    param.setTargetAtTime(value, now, tc);
  }

  /** Follow the parameters that act on the sound directly. Call it often; it only touches what changed. */
  apply(p: Params, now: number, first = false): void {
    if (this.released) return;
    const open = Math.pow(2, (p.brightness - 0.5) * 2.4);
    this.glideTo('level', this.master.gain, p.level, now, first ? 2.5 : 0.4);
    this.glideTo('tone', this.tone.frequency, (2600 - p.depth * 1500) * open, now, first ? 0.05 : 4);
    this.glideTo('air', this.airG.gain, 0.02 + p.depth * 0.07, now, 4);
    this.glideTo('airF', this.airF.frequency, 420 - p.depth * 240, now, 4);
    if (this.wet) this.glideTo('wet', this.wet.gain, p.space * this.reverb * this.wetScale, now, first ? 0.05 : 6);
    if (first) this.voices.forEach((v, i) => v.pan?.setTargetAtTime((((i / Math.max(1, this.voices.length - 1)) * 2 - 1) * p.width), now, 0.05));
  }

  // ---- events -----------------------------------------------------------------------------------

  /** Schedule one event. `now` is the audio clock; an event already due is played at once, a stale note is dropped. */
  play(ev: MusicEvent, now: number): void {
    if (this.released) return;
    switch (ev.type) {
      case 'chord':
        return this.chord(ev, now);
      case 'drift':
        return this.driftTo(ev, now);
      case 'bell':
        return this.bell(ev, now);
      case 'arpeggio':
        return this.arpeggio(ev, now);
      case 'beat':
        return this.beat(ev, now);
      case 'cluster':
        return this.cluster(ev, now);
      case 'hit':
        if (ev.time > now - 0.5) this.thump(Math.max(ev.time, now), ev.level, 130);
        return;
      case 'swell': {
        const at = Math.max(ev.time, now);
        this.pad.gain.setTargetAtTime(1 + 1.2 * ev.amount, at, ev.duration / 5);
        this.pad.gain.setTargetAtTime(1, at + ev.duration * 0.55, ev.duration / 5);
        return;
      }
      case 'silence': {
        const at = Math.max(ev.time, now);
        this.duck.gain.setTargetAtTime(0, at, ev.fade / 3);
        this.duck.gain.setTargetAtTime(1, at + ev.duration, ev.fade / 2);
        return;
      }
    }
  }

  private chord(ev: ChordEvent, now: number): void {
    const at = Math.max(ev.time, now);
    ev.notes.forEach((midi, i) => {
      const v = this.voices[i];
      if (!v) return;
      for (const o of v.oscs) o.frequency.setTargetAtTime(hz(midi), at + ev.voiceDelays[i], ev.glide);
    });
    for (const o of this.drone) o.frequency.setTargetAtTime(hz(ev.drone), at + ev.droneDelay, ev.droneGlide);
    if (ev.sting) {
      // a sting cuts through a silence and leans on the pad for a moment
      this.duck.gain.setTargetAtTime(1, at, 0.02);
      this.pad.gain.setTargetAtTime(1.6, at, 0.03);
      this.pad.gain.setTargetAtTime(1, at + 0.5, 1.5);
    }
  }

  private driftTo(ev: DriftEvent, now: number): void {
    const v = this.voices[ev.voice];
    if (!v) return;
    const at = Math.max(ev.time, now);
    for (const name of LAYER_NAMES) v.layers[name].gain.setTargetAtTime(ev.blend[name], at, ev.glide);
    v.oscs[0].detune.setTargetAtTime(-ev.spread, at, ev.glide);
    v.oscs[1].detune.setTargetAtTime(ev.spread * 0.9, at, ev.glide);
    v.pan?.setTargetAtTime(ev.pan, at, ev.glide);
    v.filt.frequency.setTargetAtTime(ev.filter, at, ev.glide);
    v.filt.Q.setTargetAtTime(ev.q, at, ev.glide);
    v.sweepG.gain.setTargetAtTime(ev.sweep, at, ev.glide);
    this.sweepD.gain.setTargetAtTime(ev.toneSweep, at, ev.glide);
    this.wetScale = ev.wetScale;
  }

  /** Nodes that live for one note: remembered with the time after which they can be let go. */
  private once(until: number, sources: Source[], nodes: AudioNode[]): void {
    for (const n of nodes) this.nodes.add(n);
    for (const s of sources) {
      this.nodes.add(s);
      this.sources.add(s);
    }
    this.transients.push({ until, nodes: [...sources, ...nodes] });
  }

  private bell(ev: BellEvent, now: number): void {
    if (ev.time < now - 0.5) return;
    const ctx = this.ctx;
    const t = Math.max(ev.time, now);
    const f = hz(ev.midi);
    const car = ctx.createOscillator();
    const modulator = ctx.createOscillator();
    const md = ctx.createGain();
    const g = ctx.createGain();
    const pan = this.panner(ev.pan);
    car.frequency.value = f;
    modulator.frequency.value = f * 2.76;
    md.gain.setValueAtTime(f * 0.9, t);
    md.gain.exponentialRampToValueAtTime(1, t + 2.5);
    modulator.connect(md).connect(car.frequency);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(ev.level, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 7);
    car.connect(g).connect(pan.node).connect(this.bus);
    car.start(t);
    modulator.start(t);
    car.stop(t + 7.2);
    modulator.stop(t + 7.2);
    this.once(t + 7.3, [car, modulator], [md, g, pan.node]);
  }

  private pluck(t: number, midi: number, level: number, panTo: number, ring: number, echo: boolean): void {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    const pan = this.panner(Math.max(-1, Math.min(1, panTo)));
    o.type = 'triangle';
    o.frequency.value = hz(midi);
    f.type = 'lowpass';
    f.Q.value = 3;
    f.frequency.setValueAtTime(2600, t);
    f.frequency.exponentialRampToValueAtTime(500, t + ring * 0.55);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0004, t + ring);
    o.connect(f).connect(g).connect(pan.node);
    pan.node.connect(this.bus);
    if (echo) pan.node.connect(this.echo);
    o.start(t);
    o.stop(t + ring + 0.1);
    this.once(t + ring + 0.2, [o], [f, g, pan.node]);
  }

  private arpeggio(ev: ArpeggioEvent, now: number): void {
    this.echo.delayTime.setTargetAtTime(ev.echo, Math.max(ev.time, now), 0.05);
    for (const n of ev.notes) if (n.time >= now - 0.02) this.pluck(Math.max(n.time, now), n.midi, n.level, n.pan, 0.9, true);
  }

  /** One thump of the heart: a sine falling in pitch. */
  private thump(at: number, level: number, top: number): void {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(top, at);
    o.frequency.exponentialRampToValueAtTime(42, at + 0.11);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0005, at + 0.34);
    o.connect(g);
    g.connect(this.heartDry);
    g.connect(this.heartWet);
    o.start(at);
    o.stop(at + 0.4);
    this.once(at + 0.5, [o], [g]);
  }

  private beat(ev: BeatEvent, now: number): void {
    for (const th of ev.thumps) if (th.time >= now - 0.05) this.thump(Math.max(th.time, now), th.level, th.top);
    for (const tk of ev.ticks) if (tk.time >= now - 0.02) this.pluck(Math.max(tk.time, now), tk.midi, tk.level, 0, 0.16, false);
  }

  /** A few high sines a semitone apart that climb slowly and are cut off. */
  private cluster(ev: ClusterEvent, now: number): void {
    if (ev.time < now - 1) return;
    const t = Math.max(ev.time, now);
    const end = t + ev.duration;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(ev.level, t + ev.duration * 0.85);
    g.gain.linearRampToValueAtTime(0, end);
    g.connect(this.bus);
    const oscs = ev.notes.map((midi, i) => {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(hz(midi), t);
      o.frequency.exponentialRampToValueAtTime(hz(midi + ev.rise), end);
      o.detune.value = i * 7 - 10;
      o.connect(g);
      o.start(t);
      o.stop(end + 0.1);
      return o;
    });
    this.once(end + 0.2, oscs, [g]);
  }

  // ---- letting go ---------------------------------------------------------------------------------

  /** Disconnect the nodes of notes that have finished. Call it now and then. */
  sweep(now: number): void {
    if (!this.transients.length) return;
    const live: Transient[] = [];
    for (const tr of this.transients) {
      if (tr.until > now) {
        live.push(tr);
        continue;
      }
      for (const n of tr.nodes) this.drop(n);
    }
    this.transients = live;
  }

  private drop(node: AudioNode): void {
    try {
      node.disconnect();
    } catch {
      /* already gone */
    }
    this.nodes.delete(node);
    this.sources.delete(node as Source);
  }

  /** Fade to nothing; the nodes are still there until `release`. */
  fadeOut(now: number, seconds = 0.4): void {
    if (this.released) return;
    this.applied.level = 0;
    this.master.gain.setTargetAtTime(0, now, seconds);
  }

  /** Stop every source and disconnect every node this renderer made. Safe to call twice. */
  release(): void {
    if (this.released) return;
    this.released = true;
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* never started, or already stopped */
      }
    }
    for (const n of [...this.nodes]) this.drop(n);
    this.transients = [];
    this.voices = [];
    this.drone = [];
  }
}
