import { type Axes, type ParamName, type Params, HOME_AXES, PARAM_NAMES, clampAxes, clampParam, cleanParams, paramsFromAxes } from './params.js';
import { type MoodBlend, type MoodWeights, blendMoods } from './moods.js';
import { type PromptResult, parsePrompt } from './prompt.js';

/**
 * How one part of a game world should sound. Data only, so it can live in a saved file.
 * Give one of `prompt` or `mood`; `axes` and `overrides` are applied on top of it.
 */
export interface District {
  name?: string;
  /** Its own seed: the same district always wanders through the same chords. */
  seed?: string;
  prompt?: string;
  mood?: string | MoodWeights;
  axes?: Partial<Axes>;
  /** Low-level parameters pinned for this district whatever the mood says. */
  overrides?: Partial<Params>;
}

export interface SteeringSnapshot {
  axes: Axes;
  moods: MoodWeights;
  /** Parameters pinned by the current mood or prompt. */
  pinned: Partial<Params>;
  /** Parameters pinned by `set`. */
  overrides: Partial<Params>;
}

/**
 * The three layers that decide the parameters, lowest first:
 * the axes, what the current mood or prompt pins, and what `set` pins.
 * Pure data and arithmetic: no audio, no clock.
 */
export class Steering {
  axes: Axes = { ...HOME_AXES };
  moods: MoodWeights = {};
  pinned: Partial<Params> = {};
  overrides: Partial<Params> = {};

  /** Move along one or more axes; the others stay where they are. */
  steer(axes: Partial<Axes>): void {
    this.axes = clampAxes(axes ?? {}, this.axes);
  }

  /** Replace the mood layer (and the axes) with a mood or a weighted blend. */
  mood(input: string | MoodWeights): MoodBlend {
    const blend = blendMoods(input);
    this.axes = blend.axes;
    this.moods = blend.weights;
    this.pinned = blend.params;
    return blend;
  }

  /** Replace the mood layer with what a line of plain words describes. */
  prompt(text: string): PromptResult {
    const parsed = parsePrompt(text);
    this.mood(parsed.moods);
    this.steer(parsed.axes);
    this.pinned = { ...this.pinned, ...parsed.params };
    return parsed;
  }

  /** Pin low-level parameters. A `null` value releases that parameter back to the mood and axes. */
  set(params: Partial<Record<ParamName, number | null>>): void {
    const clean = cleanParams(params, true);
    for (const k of Object.keys(clean) as ParamName[]) {
      const v = clean[k];
      if (v === null || v === undefined) delete this.overrides[k];
      else this.overrides[k] = v;
    }
  }

  /** Take on a district's whole description: nothing of the previous one is kept. */
  enter(district: District): PromptResult | undefined {
    this.reset();
    let parsed: PromptResult | undefined;
    if (typeof district?.prompt === 'string') parsed = this.prompt(district.prompt);
    else if (district?.mood) this.mood(district.mood);
    if (district?.axes) this.steer(district.axes);
    this.overrides = cleanParams(district?.overrides) as Partial<Params>;
    return parsed;
  }

  reset(): void {
    this.axes = { ...HOME_AXES };
    this.moods = {};
    this.pinned = {};
    this.overrides = {};
  }

  /** The low-level parameters all of this adds up to. */
  target(): Params {
    const out = { ...paramsFromAxes(this.axes), ...this.pinned, ...this.overrides };
    for (const k of PARAM_NAMES) out[k] = clampParam(k, out[k]);
    return out;
  }

  snapshot(): SteeringSnapshot {
    return { axes: { ...this.axes }, moods: { ...this.moods }, pinned: { ...this.pinned }, overrides: { ...this.overrides } };
  }
}

/** The parameters a district description stands for, without an engine. */
export function districtParams(district: District): Params {
  const s = new Steering();
  s.enter(district);
  return s.target();
}
