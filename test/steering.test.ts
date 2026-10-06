import { describe, expect, it } from 'vitest';
import { blendMoods, getMood, moodNames, moodParams, registerMood } from '../src/moods.js';
import { type Message, parseMessage } from '../src/messages.js';
import { AXIS_MAP, AXIS_NAMES, HOME_AXES, PARAMS, PARAM_NAMES, baseParams, paramsFromAxes } from '../src/params.js';
import { parsePrompt, registerPromptWord } from '../src/prompt.js';
import { Steering, districtParams } from '../src/steering.js';

describe('axes', () => {
  it('the home point is the original study', () => {
    expect(paramsFromAxes(HOME_AXES)).toEqual(baseParams());
    expect(baseParams()).toMatchObject({ unease: 0.6, colour: 0.8, drift: 0.7, depth: 0.4, bells: 0.5, arpeggio: 0.5, heartbeat: 0.5, pulse: 54 });
  });
  it('every corner stays in range, and every mapped parameter exists', () => {
    for (const e of [0, 1]) for (const v of [0, 1]) for (const t of [0, 1]) {
      const p = paramsFromAxes({ energy: e, valence: v, tension: t });
      for (const k of PARAM_NAMES) {
        expect(p[k]).toBeGreaterThanOrEqual(PARAMS[k].min);
        expect(p[k]).toBeLessThanOrEqual(PARAMS[k].max);
      }
    }
    for (const a of AXIS_NAMES) for (const k of Object.keys(AXIS_MAP[a])) expect(PARAM_NAMES).toContain(k);
  });
  it('each axis pulls the parameters the right way', () => {
    const lo = (a: string) => paramsFromAxes({ ...HOME_AXES, [a]: 0 });
    const hi = (a: string) => paramsFromAxes({ ...HOME_AXES, [a]: 1 });
    expect(hi('energy').pulse).toBeGreaterThan(lo('energy').pulse + 50);
    expect(hi('energy').pace).toBeGreaterThan(lo('energy').pace);
    expect(hi('energy').tick).toBeGreaterThan(0.5);
    expect(hi('valence').mode).toBeGreaterThan(0.9);
    expect(hi('valence').clash).toBe(0);
    expect(hi('valence').unease).toBeLessThan(lo('valence').unease);
    expect(hi('valence').brightness).toBeGreaterThan(lo('valence').brightness);
    expect(hi('valence').register).toBeGreaterThan(lo('valence').register);
    expect(hi('tension').heartbeat).toBe(1);
    expect(hi('tension').unease).toBeGreaterThan(lo('tension').unease);
    expect(hi('tension').width).toBeLessThan(lo('tension').width);
    expect(hi('tension').cluster).toBeGreaterThan(0.8);
  });
});

describe('moods', () => {
  it('has the named moods', () => {
    for (const m of ['eerie', 'uneasy', 'calm', 'melancholy', 'cheerful', 'industrious', 'frantic', 'dread', 'wonder', 'sterile']) expect(moodNames()).toContain(m);
    expect(moodParams('uneasy')).toEqual(baseParams());
  });
  it('blends by weight', () => {
    const eerie = getMood('eerie')!;
    const busy = getMood('industrious')!;
    const b = blendMoods({ eerie: 0.6, industrious: 0.4 });
    for (const a of AXIS_NAMES) expect(b.axes[a]).toBeCloseTo(eerie.axes[a] * 0.6 + busy.axes[a] * 0.4, 10);
    expect(b.params.tick).toBeCloseTo(0.4 * 0.7 + 0.6 * paramsFromAxes(eerie.axes).tick, 10);
    expect(b.params.space).toBeCloseTo(0.6 * 0.75 + 0.4 * paramsFromAxes(busy.axes).space, 10);
    const scaled = blendMoods({ eerie: 3, industrious: 2 });
    for (const a of AXIS_NAMES) expect(scaled.axes[a]).toBeCloseTo(b.axes[a], 10);
    expect(scaled.weights.eerie).toBeCloseTo(0.6, 10);
    expect(scaled.params.tick).toBeCloseTo(b.params.tick!, 10);
    expect(blendMoods('eerie').axes).toEqual(eerie.axes);
  });
  it('a total under one leaves the rest at home, and unknown names are reported', () => {
    const b = blendMoods({ cheerful: 0.5, nonsense: 1 });
    expect(b.unknown).toEqual(['nonsense']);
    expect(b.axes.valence).toBeCloseTo((0.95 + HOME_AXES.valence) / 2, 10);
    expect(blendMoods({}).axes).toEqual(HOME_AXES);
  });
  it('hosts can register their own', () => {
    registerMood('Flooded', { description: 'test', axes: { energy: 0.1, valence: 0.3 }, params: { depth: 5, nonsense: 1 } as never });
    expect(getMood('flooded')).toEqual({ description: 'test', axes: { energy: 0.1, valence: 0.3, tension: HOME_AXES.tension }, params: { depth: 1 } });
    expect(parsePrompt('flooded').moods).toEqual({ flooded: 1 });
  });
});

describe('prompt', () => {
  it('reads words and modifiers, and says what it understood and ignored', () => {
    const r = parsePrompt('laid back, slightly eerie, deep, with purple monkeys');
    expect(r.axes.energy).toBeLessThan(0.2);
    expect(r.moods).toEqual({ eerie: 0.4 });
    expect(r.params.depth).toBeGreaterThan(0.8);
    expect(r.understood.map((u) => u.phrase)).toEqual(['laid back', 'slightly eerie', 'deep']);
    expect(r.ignored).toEqual(['purple', 'monkeys']);
  });
  it('handles very, not and no', () => {
    expect(parsePrompt('very bright').axes.valence).toBe(1);
    expect(parsePrompt('bright').axes.valence).toBeLessThan(1);
    expect(parsePrompt('slightly bright').axes.valence!).toBeLessThan(parsePrompt('bright').axes.valence!);
    expect(parsePrompt('not tense').axes.tension!).toBeLessThan(HOME_AXES.tension);
    expect(parsePrompt('no bells, no heartbeat').params).toEqual({ bells: 0, heartbeat: 0 });
    expect(parsePrompt('not cheerful').moods).toEqual({});
    expect(parsePrompt('not cheerful').axes.valence!).toBeLessThan(HOME_AXES.valence);
    expect(parsePrompt('high energy, low tension').axes.energy).toBeCloseTo(0.9, 10);
    expect(parsePrompt('high energy, low tension').axes.tension).toBeCloseTo(0.1, 10);
    expect(parsePrompt('a little frantic').moods.frantic).toBeCloseTo(0.4);
  });
  it('survives anything', () => {
    expect(parsePrompt('').understood).toEqual([]);
    expect(parsePrompt(undefined as never).ignored).toEqual([]);
    expect(parsePrompt('!!! 123 ???').ignored).toEqual([]);
    expect(parsePrompt('very').understood).toEqual([]);
  });
  it('can be taught words', () => {
    registerPromptWord('coolant leak', { mood: 'dread' });
    expect(parsePrompt('a coolant-leak').moods).toEqual({ dread: 1 });
  });
  it('steers the same way as the words say', () => {
    const s = new Steering();
    s.prompt('cheerful, busy');
    const cheerful = s.target();
    s.prompt('dread, deep, no bells');
    const dread = s.target();
    expect(cheerful.mode).toBeGreaterThan(dread.mode + 0.4);
    expect(cheerful.pulse).toBeGreaterThan(54);
    expect(dread.bells).toBe(0);
    expect(dread.depth).toBeGreaterThan(0.85);
    s.prompt('slightly cheerful');
    expect(s.target().mode).toBeGreaterThan(0.5);
    expect(s.target().mode).toBeLessThan(cheerful.mode);
  });
});

describe('steering layers', () => {
  it('set pins over mood, null releases, enter replaces everything', () => {
    const s = new Steering();
    s.mood('sterile');
    expect(s.target().space).toBe(0.15);
    s.set({ space: 0.9, level: 0.3 });
    s.mood('cheerful');
    expect(s.target()).toMatchObject({ space: 0.9, level: 0.3 });
    s.set({ space: null });
    expect(s.target().space).toBe(paramsFromAxes(getMood('cheerful')!.axes).space);
    s.steer({ tension: 1 });
    expect(s.axes).toEqual({ ...getMood('cheerful')!.axes, tension: 1 });
    s.enter({ seed: 'x', mood: 'calm', axes: { energy: 0.4 }, overrides: { depth: 0.2 } });
    expect(s.overrides).toEqual({ depth: 0.2 });
    expect(s.axes.energy).toBe(0.4);
    expect(s.target().heartbeat).toBe(0);
    expect(districtParams({ prompt: 'calm' }).heartbeat).toBe(0);
  });
});

describe('messages', () => {
  const messages: Message[] = [
    { type: 'mood', mood: 'eerie', glide: 4 },
    { type: 'mood', mood: { eerie: 0.6, industrious: 0.4 } },
    { type: 'steer', axes: { energy: 0.9, tension: 0.2 }, glide: 2 },
    { type: 'set', params: { unease: 0.3, pulse: 96, bells: null } },
    { type: 'prompt', text: 'laid back, slightly eerie, deep' },
    { type: 'seed', seed: 'agriculture' },
    { type: 'event', event: 'silence', seconds: 5 },
    { type: 'event', event: 'sting', amount: 0.8 },
    { type: 'enter', district: { name: 'Research', seed: 'research', prompt: 'sterile, wonder', axes: { tension: 0.2 }, overrides: { depth: 0.7 } }, glide: 20 },
    { type: 'reset' },
  ];
  it('round-trip through JSON unchanged', () => {
    for (const m of messages) {
      expect(parseMessage(JSON.parse(JSON.stringify(m)))).toEqual(m);
      expect(parseMessage(JSON.stringify(m))).toEqual(m);
    }
  });
  it('give the same steering after a round trip', () => {
    const direct = new Steering();
    const viaJson = new Steering();
    const apply = (s: Steering, m: Message): void => {
      if (m.type === 'mood') s.mood(m.mood);
      else if (m.type === 'steer') s.steer(m.axes);
      else if (m.type === 'set') s.set(m.params);
      else if (m.type === 'prompt') s.prompt(m.text);
      else if (m.type === 'enter') s.enter(m.district);
    };
    for (const m of messages.slice(0, 5)) {
      apply(direct, m);
      apply(viaJson, parseMessage(JSON.stringify(m))!);
      expect(viaJson.target()).toEqual(direct.target());
    }
  });
  it('rejects or cleans rubbish without throwing', () => {
    for (const bad of [null, 5, 'nope', '{', {}, { type: 'dance' }, { type: 'event', event: 'explode' }, { type: 'prompt' }, { type: 'mood' }]) expect(parseMessage(bad)).toBeNull();
    expect(parseMessage({ type: 'set', params: { unease: 7, pulse: 1, junk: 1, colour: 'x' }, glide: -1, extra: true })).toEqual({ type: 'set', params: { unease: 1, pulse: 30 } });
    expect(parseMessage({ type: 'steer', axes: { energy: 4, mood: 1 } })).toEqual({ type: 'steer', axes: { energy: 1 } });
  });
});
