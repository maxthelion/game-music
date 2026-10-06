import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMusicEngine } from '../src/engine.js';
import type { ChordEvent } from '../src/composer.js';
import { getMood, moodParams } from '../src/moods.js';
import { FakeContext } from './fake-audio.js';

function make(options: Record<string, unknown> = {}): { ctx: FakeContext; engine: ReturnType<typeof createMusicEngine> } {
  const ctx = new FakeContext();
  const engine = createMusicEngine({ context: ctx as never, destination: ctx.destination as never, seed: 'test', timer: false, ...options });
  return { ctx, engine };
}
function run(ctx: FakeContext, engine: { tick(): void }, seconds: number, step = 0.1): void {
  const end = ctx.currentTime + seconds;
  while (ctx.currentTime < end) {
    ctx.currentTime += step;
    engine.tick();
  }
}

afterEach(() => vi.useRealTimers());

describe('engine against a fake audio context', () => {
  it('plays without throwing, schedules ahead of the clock, and reports what is sounding', () => {
    const { ctx, engine } = make();
    const chords: ChordEvent[] = [];
    const beats: number[] = [];
    const arps: number[] = [];
    engine.on('chord', (c) => chords.push(c));
    engine.on('beat', (b) => beats.push(b.time));
    engine.on('arpeggio', (a) => arps.push(a.time));
    expect(engine.state.running).toBe(false);
    expect(engine.start()).toBe(true);
    ctx.currentTime = 1;
    engine.tick();
    expect(engine.state.chord).not.toBeNull();
    run(ctx, engine, 120);
    expect(chords.length).toBeGreaterThan(3);
    expect(beats.length).toBeGreaterThan(90);
    expect(arps.length).toBeGreaterThan(1);
    expect(engine.state.chord!.name).toBe(chords[chords.length - 1].name);
    expect(engine.state.move!.label).toBe(chords[chords.length - 1].moveLabel);
    expect(engine.state.blends).toHaveLength(5);
    expect(engine.state.blends.some((b) => b !== 'pad')).toBe(true);
    // nothing is ever scheduled in the past, and one-shot notes start ahead of the clock
    expect(ctx.scheduled.length).toBeGreaterThan(500);
    for (const s of ctx.scheduled) expect(s.time).toBeGreaterThanOrEqual(s.at - 1e-9);
    const shots = ctx.starts.filter((s) => s.time > 0);
    expect(shots.length).toBeGreaterThan(100);
    for (const s of shots) expect(s.time).toBeGreaterThanOrEqual(s.at);
    expect(shots.filter((s) => s.time > s.at + 0.05).length).toBeGreaterThan(shots.length * 0.6);
    // listeners hear each event about when it sounds
    for (const t of beats) expect(Math.abs(t - beats[0])).toBeLessThan(200);
    engine.dispose();
  });

  it('lets go of finished notes while playing, and of every node on dispose', () => {
    const { ctx, engine } = make();
    engine.start();
    run(ctx, engine, 30);
    const steady = engine.nodeCount;
    run(ctx, engine, 300);
    expect(engine.nodeCount).toBeLessThan(steady + 80);
    expect(ctx.created.length).toBeGreaterThan(engine.nodeCount + 500);
    engine.dispose();
    expect(engine.nodeCount).toBe(0);
    expect(ctx.live).toHaveLength(0);
    for (const n of ctx.created) if (n.kind === 'oscillator' || n.kind === 'source') expect(n.stopped || n.disconnected).toBe(true);
    expect(ctx.state).toBe('running'); // a host's context is never closed
    expect(engine.start()).toBe(false);
    expect(engine.send({ type: 'mood', mood: 'calm' }).ok).toBe(false);
  });

  it('stop fades, then releases; start begins the same music again', () => {
    vi.useFakeTimers();
    const { ctx, engine } = make();
    const names: string[] = [];
    engine.on('chord', (c) => names.push(c.name));
    engine.start();
    run(ctx, engine, 60);
    const first = [...names];
    engine.stop();
    expect(engine.state.running).toBe(false);
    expect(engine.state.chord).toBeNull();
    expect(ctx.live.length).toBeGreaterThan(0);
    vi.advanceTimersByTime(2000);
    expect(ctx.live).toHaveLength(0);
    names.length = 0;
    engine.start();
    run(ctx, engine, 60);
    expect(names).toEqual(first);
    engine.stop();
    engine.start(); // starting during the fade releases the old graph at once
    engine.dispose();
    expect(ctx.live).toHaveLength(0);
  });

  it('survives a suspended context and a long gap between ticks', () => {
    const { ctx, engine } = make();
    ctx.state = 'suspended';
    engine.start();
    expect(ctx.resumed).toBe(1);
    ctx.state = 'suspended';
    for (let i = 0; i < 50; i++) engine.tick(); // clock stands still
    const before = ctx.scheduled.length;
    for (let i = 0; i < 50; i++) engine.tick();
    expect(ctx.scheduled.length).toBe(before);
    ctx.state = 'running';
    ctx.currentTime += 45; // a hidden tab: one tick after a long sleep
    expect(() => engine.tick()).not.toThrow();
    for (const s of ctx.scheduled) expect(s.time).toBeGreaterThanOrEqual(s.at - 1e-9);
    run(ctx, engine, 20);
    expect(engine.state.chord).not.toBeNull();
    engine.dispose();
  });

  it('runs with no reverb and no compressor when the host has its own', () => {
    const withAll = make();
    withAll.engine.start();
    const dry = make({ reverb: false, compressor: false });
    dry.engine.start();
    expect(withAll.ctx.created.some((n) => n.kind === 'convolver')).toBe(true);
    expect(dry.ctx.created.some((n) => n.kind === 'convolver' || n.kind === 'compressor')).toBe(false);
    run(dry.ctx, dry.engine, 20);
    withAll.engine.dispose();
    dry.engine.dispose();
  });

  it('glides parameters and applies a mood by the next chord', () => {
    const { ctx, engine } = make();
    engine.start();
    run(ctx, engine, 5);
    const from = engine.state.params.mode;
    const r = engine.mood('cheerful', { glide: 10 });
    expect(r).toMatchObject({ ok: true, message: { type: 'mood', mood: 'cheerful', glide: 10 } });
    expect(engine.state.params.mode).toBeCloseTo(from, 5);
    expect(engine.state.target.mode).toBeCloseTo(moodParams('cheerful')!.mode, 10);
    run(ctx, engine, 5);
    expect(engine.state.params.mode).toBeGreaterThan(from);
    expect(engine.state.params.mode).toBeLessThan(engine.state.target.mode);
    run(ctx, engine, 6);
    expect(engine.state.params.mode).toBeCloseTo(engine.state.target.mode, 10);
    expect(engine.state.axes).toEqual(getMood('cheerful')!.axes);
    const chords: ChordEvent[] = [];
    engine.on('chord', (c) => chords.push(c));
    run(ctx, engine, 400);
    expect(chords.filter((c) => !c.minor).length / chords.length).toBeGreaterThan(0.75);
    // a new tempo lands on a beat
    const bpm: number[] = [];
    engine.on('beat', (b) => bpm.push(b.bpm));
    engine.set({ pulse: 120 }, { glide: 0 });
    run(ctx, engine, 5);
    expect(bpm[bpm.length - 1]).toBe(120);
    expect(engine.state.overrides).toEqual({ pulse: 120 });
    engine.dispose();
  });

  it('takes every kind of message, as objects or JSON, and reports them', () => {
    const { ctx, engine } = make();
    const log: string[] = [];
    engine.on('message', (m) => log.push(JSON.stringify(m)));
    expect(engine.fire('sting').ok).toBe(false); // not running yet
    engine.start();
    run(ctx, engine, 10);
    const p = engine.prompt('laid back, slightly eerie, deep, wibble');
    expect(p.understood!.map((u) => u.phrase)).toEqual(['laid back', 'slightly eerie', 'deep']);
    expect(p.ignored).toEqual(['wibble']);
    expect(engine.send('{"type":"steer","axes":{"energy":0.9}}').ok).toBe(true);
    expect(engine.state.axes.energy).toBe(0.9);
    expect(engine.mood({ eerie: 0.6, industrious: 0.4, bogus: 1 }).unknown).toEqual(['bogus']);
    expect(engine.send({ type: 'nonsense' })).toEqual({ ok: false, error: 'not a message' });
    const chords: ChordEvent[] = [];
    engine.on('chord', (c) => chords.push(c));
    expect(engine.fire('sting').ok).toBe(true);
    run(ctx, engine, 1);
    expect(chords[0].sting).toBe(true);
    for (const e of ['arpeggio', 'swell', 'silence'] as const) expect(engine.fire(e, { seconds: 3 }).ok).toBe(true);
    run(ctx, engine, 10);
    const d = engine.enter({ name: 'Agriculture', seed: 'agriculture', prompt: 'calm, bright, shallow' }, { glide: 12 });
    expect(d.ok).toBe(true);
    expect(engine.state).toMatchObject({ seed: 'agriculture', district: 'Agriculture' });
    const drone = engine.state.chord!.drone;
    run(ctx, engine, 0.5);
    expect(engine.state.chord!.drone).toBe(drone);
    expect(engine.send({ type: 'seed', seed: 'other' }).ok).toBe(true);
    expect(engine.seed).toBe('other');
    expect(log.length).toBe(9);
    for (const line of [...log]) expect(engine.send(line).ok).toBe(true);
    engine.dispose();
  });

  it('a listener that throws does not stop the music', () => {
    const { ctx, engine } = make();
    engine.on('beat', () => {
      throw new Error('host bug');
    });
    const off = engine.on('chord', () => {
      throw new Error('host bug');
    });
    engine.start();
    expect(() => run(ctx, engine, 30)).not.toThrow();
    off();
    engine.dispose();
  });
});

describe('engine with no Web Audio at all', () => {
  it('still starts, composes and stops, silently', () => {
    vi.useFakeTimers();
    expect((globalThis as { AudioContext?: unknown }).AudioContext).toBeUndefined();
    const engine = createMusicEngine({ seed: 'silent' });
    const chords: string[] = [];
    engine.on('chord', (c) => chords.push(c.name));
    expect(engine.start()).toBe(true);
    expect(engine.state.audio).toBe('none');
    vi.advanceTimersByTime(60000);
    expect(chords.length).toBeGreaterThan(1);
    expect(engine.nodeCount).toBe(0);
    engine.stop();
    engine.dispose();
  });

  it('does not throw when the audio context is broken', () => {
    const broken = { currentTime: 0, state: 'running', destination: {}, createGain: () => { throw new Error('no'); } };
    const engine = createMusicEngine({ context: broken as never, timer: false });
    expect(() => engine.start()).not.toThrow();
    expect(() => engine.tick()).not.toThrow();
    expect(() => engine.dispose()).not.toThrow();
  });
});
