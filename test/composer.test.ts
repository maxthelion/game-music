import { describe, expect, it } from 'vitest';
import { type ArpeggioEvent, type ChordEvent, type MusicEvent, Composer, chordSeconds } from '../src/composer.js';
import { type Axes, type Params, HOME_AXES, paramsFromAxes } from '../src/params.js';
import { moodNames, moodParams } from '../src/moods.js';

function play(seed: string, params: Params, seconds: number, step = 0.25): MusicEvent[] {
  const c = new Composer({ seed });
  const out: MusicEvent[] = [];
  for (let t = step; t <= seconds; t += step) out.push(...c.advance(t, params));
  return out;
}
/** Run until there are `count` chords. */
function chords(seed: string, params: Params, count = 200): { chords: ChordEvent[]; events: MusicEvent[]; seconds: number } {
  const c = new Composer({ seed });
  const events: MusicEvent[] = [];
  let t = 0;
  let n = 0;
  while (n < count) {
    t += 1;
    for (const ev of c.advance(t, params)) {
      events.push(ev);
      if (ev.type === 'chord') n++;
    }
  }
  return { chords: events.filter((e): e is ChordEvent => e.type === 'chord'), events, seconds: t };
}
const at = (axes: Partial<Axes>): Params => paramsFromAxes({ ...HOME_AXES, ...axes });
const share = (list: ChordEvent[], test: (c: ChordEvent) => boolean): number => list.filter(test).length / list.length;
const pcsOf = (notes: number[]): number[] => [...new Set(notes.map((m) => ((m % 12) + 12) % 12))].sort((a, b) => a - b);

describe('composer', () => {
  it('gives the same events for the same seed and parameters', () => {
    const p = at({});
    expect(play('heavy-industry', p, 600)).toEqual(play('heavy-industry', p, 600));
    expect(JSON.stringify(play('heavy-industry', p, 300))).not.toEqual(JSON.stringify(play('agriculture', p, 300)));
  });

  it('does not depend on how often it is asked', () => {
    const p = at({ energy: 0.7, valence: 0.6 });
    const strip = (evs: MusicEvent[]): string => JSON.stringify(evs.map((e) => [e.type, e.time.toFixed(6)]).sort());
    expect(strip(play('s', p, 300, 0.1))).toEqual(strip(play('s', p, 300, 2.5)));
  });

  it('gives the same events for the same history of parameter changes', () => {
    const run = (): MusicEvent[] => {
      const c = new Composer({ seed: 'history' });
      const out: MusicEvent[] = [];
      for (let t = 0.5; t <= 400; t += 0.5) {
        if (Math.abs(t - 120) < 1e-9) c.trigger('sting', t);
        out.push(...c.advance(t, at({ energy: t < 100 ? 0.2 : 0.9, valence: t < 200 ? 0.1 : 0.9 })));
      }
      return out;
    };
    expect(run()).toEqual(run());
  });

  it('emits events in time order and never in the past', () => {
    const c = new Composer({ seed: 'order' });
    const p = at({ energy: 0.9, tension: 0.9 });
    let before = 0;
    for (let t = 0.3; t < 200; t += 0.3) {
      const evs = c.advance(t, p);
      evs.forEach((e, i) => {
        expect(e.time).toBeGreaterThanOrEqual(before - 1e-9);
        expect(e.time).toBeLessThan(t + 0.06);
        if (i) expect(e.time).toBeGreaterThanOrEqual(evs[i - 1].time);
      });
      before = t - 0.3;
    }
  });

  it('voices every note of every chord, in every mood', () => {
    for (const mood of moodNames()) {
      for (const voices of [4, 5, 7]) {
        const c = new Composer({ seed: mood, voices });
        const p = moodParams(mood)!;
        let n = 0;
        for (let t = 1; n < 150; t += 1) {
          for (const ev of c.advance(t, p)) {
            if (ev.type !== 'chord') continue;
            n++;
            expect(ev.notes).toHaveLength(voices);
            expect(pcsOf(ev.notes), `${mood} ${ev.name}`).toEqual([...ev.pcs].sort((a, b) => a - b));
          }
        }
      }
    }
  });

  it('never moves a voice more than an octave, even while depth and register swing', () => {
    const c = new Composer({ seed: 'leaps' });
    let prev: number[] | null = null;
    let n = 0;
    for (let t = 1; n < 300; t += 1) {
      const swing = Math.floor(t / 40) % 2;
      const p = { ...at({ valence: swing, energy: 0.8 }), depth: swing ? 0 : 1, register: swing ? 1 : 0 };
      if (t % 97 === 0) c.trigger('sting', t - 0.5);
      for (const ev of c.advance(t, p)) {
        if (ev.type !== 'chord') continue;
        n++;
        if (prev) ev.notes.forEach((m, i) => expect(Math.abs(m - prev![i])).toBeLessThanOrEqual(12));
        prev = ev.notes;
      }
    }
  });

  it('keeps the drone on a note the chord shares when it can', () => {
    const { chords: list } = chords('drone', at({}), 120);
    let held = 0;
    for (let i = 1; i < list.length; i++) {
      const ok = [list[i].root, (list[i].root + 7) % 12];
      expect(ok).toContain(list[i].drone % 12);
      if (ok.includes(list[i - 1].drone % 12)) {
        expect(list[i].drone).toBe(list[i - 1].drone);
        held++;
      }
    }
    expect(held).toBeGreaterThan(10);
  });

  it('high valence is mostly major with no clashes; low valence is mostly minor', () => {
    const bright = chords('valence', at({ valence: 1 })).chords;
    const dark = chords('valence', at({ valence: 0 })).chords;
    expect(share(bright, (c) => !c.minor)).toBeGreaterThan(0.8);
    expect(bright.filter((c) => c.clash).length).toBe(0);
    expect(share(dark, (c) => c.minor)).toBeGreaterThan(0.6);
    expect(dark.filter((c) => c.clash).length).toBeGreaterThan(10);
    // bright dressings, and a higher register
    const brightIds = new Set(['add9', 'major7', 'sixth', 'sus2']);
    expect(share(bright, (c) => brightIds.has(c.dressing))).toBeGreaterThan(0.6);
    const mean = (l: ChordEvent[]): number => l.reduce((a, c) => a + c.notes.reduce((x, y) => x + y, 0) / c.notes.length, 0) / l.length;
    expect(mean(bright)).toBeGreaterThan(mean(dark) + 4);
  });

  it('high valence stays in its key; low valence roams', () => {
    const homes = (l: ChordEvent[]): number => l.filter((c, i) => i && c.home !== l[i - 1].home).length;
    const bright = chords('keys', at({ valence: 1 })).chords;
    const dark = chords('keys', at({ valence: 0 })).chords;
    expect(homes(bright)).toBeLessThan(homes(dark) / 3);
    const far = new Set(['S', 'H', 'T']);
    expect(share(dark, (c) => !!c.move && far.has(c.move))).toBeGreaterThan(share(bright, (c) => !!c.move && far.has(c.move)) + 0.2);
  });

  it('at the home point major and minor alternate, as in the original study', () => {
    const list = chords('home', at({}), 100).chords;
    for (let i = 1; i < list.length; i++) expect(list[i].minor).not.toBe(list[i - 1].minor);
  });

  it('high energy gives shorter chords, a faster pulse, more arpeggio notes and a tick', () => {
    const fast = chords('energy', at({ energy: 1 }));
    const slow = chords('energy', at({ energy: 0 }));
    const mean = (l: ChordEvent[]): number => l.reduce((a, c) => a + c.duration, 0) / l.length;
    expect(mean(fast.chords)).toBeLessThan(mean(slow.chords) / 3);
    const perMinute = (r: typeof fast, pick: (e: MusicEvent) => number): number => (r.events.reduce((a, e) => a + pick(e), 0) / r.seconds) * 60;
    const arp = (e: MusicEvent): number => (e.type === 'arpeggio' ? e.notes.length : 0);
    expect(perMinute(fast, arp)).toBeGreaterThan(perMinute(slow, arp) * 5);
    expect(perMinute(fast, (e) => (e.type === 'beat' ? 1 : 0))).toBeGreaterThan(100);
    expect(perMinute(slow, (e) => (e.type === 'beat' ? 1 : 0))).toBeLessThan(50);
    expect(perMinute(fast, (e) => (e.type === 'beat' ? e.ticks.length : 0))).toBeGreaterThan(200);
    expect(perMinute(slow, (e) => (e.type === 'beat' ? e.ticks.length : 0))).toBe(0);
    const step = (r: typeof fast): number => {
      const a = r.events.filter((e): e is ArpeggioEvent => e.type === 'arpeggio');
      return a.reduce((x, e) => x + e.step, 0) / a.length;
    };
    expect(step(fast)).toBeLessThan(step(slow) / 2);
  });

  it('tension raises the heartbeat and the clusters', () => {
    const tense = chords('tension', at({ tension: 1 }), 60);
    const calm = chords('tension', at({ tension: 0 }), 60);
    const level = (r: typeof tense): number => {
      const b = r.events.filter((e) => e.type === 'beat');
      return b.reduce((a, e) => a + (e.type === 'beat' ? e.level : 0), 0) / b.length;
    };
    expect(level(tense)).toBeGreaterThan(level(calm) + 0.5);
    expect(tense.events.filter((e) => e.type === 'cluster').length).toBeGreaterThan(5);
    expect(calm.events.filter((e) => e.type === 'cluster').length).toBe(0);
  });

  it('a faster pace cuts short a chord chosen under a slower one', () => {
    const c = new Composer({ seed: 'cut' });
    c.advance(1, at({ energy: 0 }));
    const next = c.advance(40, at({ energy: 1 })).filter((e) => e.type === 'chord');
    expect(next[0].time).toBeLessThanOrEqual(chordSeconds(1)[1] + 0.001);
  });

  it('fires one-shots', () => {
    const c = new Composer({ seed: 'shots' });
    const p = at({});
    c.advance(10, p);
    c.trigger('sting', 10.5, { amount: 1 });
    c.trigger('swell', 11, { seconds: 5 });
    const evs = c.advance(12, p);
    const sting = evs.find((e): e is ChordEvent => e.type === 'chord')!;
    expect(sting.sting).toBe(true);
    expect(sting.time).toBe(10.5);
    expect(sting.clash).not.toBe('');
    expect(evs.some((e) => e.type === 'hit')).toBe(true);
    expect(evs.find((e) => e.type === 'swell')).toMatchObject({ time: 11, duration: 5 });

    c.trigger('arpeggio', 12);
    const quiet = { ...p, arpeggio: 0 };
    expect(c.advance(15, quiet).filter((e) => e.type === 'arpeggio')).toHaveLength(1);

    c.trigger('silence', 15, { seconds: 20 });
    const during = c.advance(34, { ...p, bells: 1, arpeggio: 1, heartbeat: 1 });
    expect(during.some((e) => e.type === 'silence')).toBe(true);
    expect(during.filter((e) => e.type === 'bell' || e.type === 'arpeggio')).toHaveLength(0);
    expect(during.filter((e) => e.type === 'beat').every((e) => e.type === 'beat' && e.thumps.length === 0)).toBe(true);
  });

  it('reseeding keeps the chord and changes what follows', () => {
    const p = at({});
    const a = new Composer({ seed: 'one' });
    const b = new Composer({ seed: 'one' });
    a.advance(50, p);
    b.advance(50, p);
    expect(a.current).toEqual(b.current);
    b.reseed('two');
    expect(b.current).toEqual(a.current);
    expect(JSON.stringify(a.advance(300, p))).not.toEqual(JSON.stringify(b.advance(300, p)));
  });
});
