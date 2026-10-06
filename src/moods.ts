import {
  type Axes,
  type ParamName,
  type Params,
  AXIS_NAMES,
  HOME_AXES,
  PARAM_NAMES,
  clampAxes,
  clampParam,
  cleanParams,
  paramsFromAxes,
} from './params.js';

/** A named mood: a point on the axes, plus any low-level parameters it pins regardless of the axes. */
export interface MoodDef {
  description: string;
  axes: Axes;
  params?: Partial<Params>;
}

/** Weights by mood name. Above a total of 1 they are normalised; below 1 the rest is the home point. */
export type MoodWeights = Record<string, number>;

const BUILT_IN: Record<string, MoodDef> = {
  uneasy: {
    description: 'The original study: slow, dark, something slightly wrong. This is the home point.',
    axes: { ...HOME_AXES },
  },
  eerie: {
    description: 'Still and strange: unrelated chords, many bells, a long room.',
    axes: { energy: 0.2, valence: 0.08, tension: 0.55 },
    params: { bells: 0.7, space: 0.75 },
  },
  calm: {
    description: 'Long related chords, no heartbeat, nothing that clashes.',
    axes: { energy: 0.1, valence: 0.6, tension: 0.05 },
    params: { heartbeat: 0, clash: 0 },
  },
  melancholy: {
    description: 'Minor, but in one key and consonant: sad rather than wrong.',
    axes: { energy: 0.15, valence: 0.35, tension: 0.2 },
    params: { mode: 0.12, anchor: 0.75, clash: 0, unease: 0.2 },
  },
  cheerful: {
    description: 'Major chords in one key, high and open, frequent bells and runs.',
    axes: { energy: 0.55, valence: 0.95, tension: 0.05 },
  },
  industrious: {
    description: 'Busy and purposeful: a steady tick, a firm pulse, regular runs.',
    axes: { energy: 0.7, valence: 0.55, tension: 0.3 },
    params: { tick: 0.7, heartbeat: 0.6, bells: 0.3 },
  },
  frantic: {
    description: 'Short chords, a racing pulse, runs tumbling over each other.',
    axes: { energy: 1, valence: 0.35, tension: 0.8 },
  },
  dread: {
    description: 'Deep, narrow and dark with a loud heart and a rising high cluster.',
    axes: { energy: 0.15, valence: 0, tension: 1 },
    params: { depth: 0.9, bells: 0.15 },
  },
  wonder: {
    description: 'Bright major chords that step sideways into far keys; high, wide, full of bells.',
    axes: { energy: 0.35, valence: 0.8, tension: 0.1 },
    params: { anchor: 0.1, unease: 0.45, bells: 0.9, space: 0.8, register: 0.8 },
  },
  sterile: {
    description: 'Plain triads, almost no movement in the sound, a dry room.',
    axes: { energy: 0.2, valence: 0.55, tension: 0.15 },
    params: { colour: 0.1, drift: 0.1, space: 0.15, bells: 0.1, arpeggio: 0.2, heartbeat: 0, clash: 0, unease: 0.25, anchor: 0.6 },
  },
};

const registry = new Map<string, MoodDef>();
for (const [name, def] of Object.entries(BUILT_IN)) registry.set(name, def);

const normalName = (name: string): string => name.trim().toLowerCase();

/** Add or replace a mood. Values are clamped; unknown parameters are dropped. Never throws. */
export function registerMood(name: string, def: { description?: string; axes?: Partial<Axes>; params?: Partial<Params> }): void {
  const key = normalName(String(name));
  if (!key) return;
  const params = cleanParams(def?.params) as Partial<Params>;
  registry.set(key, {
    description: def?.description ?? '',
    axes: clampAxes(def?.axes ?? {}),
    ...(Object.keys(params).length ? { params } : {}),
  });
}

export const getMood = (name: string): MoodDef | undefined => registry.get(normalName(name));
export const moodNames = (): string[] => [...registry.keys()];
/** The full low-level parameter set a mood stands for on its own. */
export function moodParams(name: string): Params | undefined {
  const def = getMood(name);
  return def ? { ...paramsFromAxes(def.axes), ...def.params } : undefined;
}

export interface MoodBlend {
  /** The weights actually used, after dropping unknown names and normalising. */
  weights: MoodWeights;
  axes: Axes;
  /** Parameters pinned by at least one mood in the blend, mixed by weight. */
  params: Partial<Params>;
  unknown: string[];
}

/** Mix moods by weight. A total below 1 leaves the remainder at the home point. */
export function blendMoods(input: string | MoodWeights): MoodBlend {
  const asked: MoodWeights = typeof input === 'string' ? { [input]: 1 } : input ?? {};
  const unknown: string[] = [];
  const parts: Array<{ name: string; weight: number; def: MoodDef }> = [];
  for (const [raw, w] of Object.entries(asked)) {
    const def = getMood(raw);
    if (!def) {
      unknown.push(raw);
      continue;
    }
    if (typeof w === 'number' && Number.isFinite(w) && w > 0) parts.push({ name: normalName(raw), weight: w, def });
  }
  const total = parts.reduce((a, p) => a + p.weight, 0);
  const scale = total > 1 ? 1 / total : 1;
  const rest = Math.max(0, 1 - total * scale);
  const weights: MoodWeights = {};
  const axes = {} as Axes;
  for (const a of AXIS_NAMES) axes[a] = HOME_AXES[a] * rest;
  const pinned = new Set<ParamName>();
  for (const p of parts) {
    const w = p.weight * scale;
    weights[p.name] = (weights[p.name] ?? 0) + w;
    for (const a of AXIS_NAMES) axes[a] += p.def.axes[a] * w;
    for (const k of Object.keys(p.def.params ?? {}) as ParamName[]) pinned.add(k);
  }
  const params: Partial<Params> = {};
  if (pinned.size) {
    const home = paramsFromAxes(HOME_AXES);
    const full = parts.map((p) => ({ w: p.weight * scale, values: { ...paramsFromAxes(p.def.axes), ...p.def.params } }));
    for (const k of PARAM_NAMES) {
      if (!pinned.has(k)) continue;
      let v = home[k] * rest;
      for (const f of full) v += f.values[k] * f.w;
      params[k] = clampParam(k, v);
    }
  }
  return { weights, axes: clampAxes(axes), params, unknown };
}
