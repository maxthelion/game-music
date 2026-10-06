import { type AxisName, type Axes, type ParamName, type Params, AXIS_NAMES, HOME_AXES, PARAMS, clampParam, isAxisName, isParamName } from './params.js';
import { type MoodWeights, getMood, moodNames } from './moods.js';
import { clamp } from './rng.js';

/**
 * A plain keyword parser: no AI, no network. It maps words and simple modifiers onto moods, axes
 * and parameters, ignores what it does not know, and says what it understood and what it ignored.
 */
export type PromptTerm =
  | { mood: string }
  | { axis: AxisName; value: number }
  /** `off` is the value used when the word is negated ("no bells"). */
  | { params: Partial<Params>; off?: Partial<Params> };

export interface PromptResult {
  text: string;
  moods: MoodWeights;
  axes: Partial<Axes>;
  params: Partial<Params>;
  understood: Array<{ phrase: string; meaning: string }>;
  ignored: string[];
}

const axis = (name: AxisName, words: Record<string, number>): Array<[string, PromptTerm]> =>
  Object.entries(words).map(([w, value]) => [w, { axis: name, value }]);
const mood = (name: string, words: string[]): Array<[string, PromptTerm]> => words.map((w) => [w, { mood: name }]);
const param = (words: string[], params: Partial<Params>, off?: Partial<Params>): Array<[string, PromptTerm]> =>
  words.map((w) => [w, off ? { params, off } : { params }]);

const LEXICON = new Map<string, PromptTerm>([
  ...axis('energy', {
    'laid back': 0.1, laidback: 0.1, relaxed: 0.12, slow: 0.08, still: 0.03, sleepy: 0.03, lazy: 0.1, languid: 0.08, unhurried: 0.12,
    gentle: 0.15, active: 0.6, busy: 0.7, lively: 0.7, brisk: 0.7, energetic: 0.85, fast: 0.85, driving: 0.8, urgent: 0.9, hectic: 0.95, restless: 0.75,
  }),
  ...axis('valence', {
    dark: 0.03, bleak: 0, gloomy: 0.05, grim: 0.03, murky: 0.08, sinister: 0.02, bright: 0.85, happy: 0.9, warm: 0.7, sunny: 0.95,
    light: 0.8, hopeful: 0.75, pleasant: 0.75, friendly: 0.8, optimistic: 0.85, sweet: 0.85,
  }),
  ...axis('tension', {
    tense: 0.8, threatening: 0.95, threatened: 0.95, anxious: 0.75, nervous: 0.7, dangerous: 0.9, ominous: 0.8, menacing: 0.9,
    scary: 0.85, suspenseful: 0.8, hostile: 0.9, safe: 0.03, peaceful: 0.03, secure: 0.05, restful: 0.05, easy: 0.08,
  }),
  ...mood('eerie', ['creepy', 'spooky', 'haunted', 'ghostly', 'uncanny', 'strange']),
  ...mood('uneasy', ['unsettled', 'unsettling', 'wary']),
  ...mood('calm', ['serene', 'tranquil', 'placid', 'soothing']),
  ...mood('melancholy', ['sad', 'mournful', 'wistful', 'lonely', 'melancholic', 'sombre', 'somber']),
  ...mood('cheerful', ['cheery', 'joyful', 'jolly', 'merry', 'playful']),
  ...mood('industrious', ['industrial', 'mechanical', 'working', 'productive', 'purposeful']),
  ...mood('frantic', ['panicked', 'panic', 'frenzied', 'chaotic', 'alarm']),
  ...mood('dread', ['doom', 'dreadful', 'horror', 'terror', 'oppressive']),
  ...mood('wonder', ['awe', 'wondrous', 'magical', 'majestic', 'grand', 'mysterious']),
  ...mood('sterile', ['clinical', 'antiseptic', 'cold', 'blank', 'empty']),
  ...param(['deep', 'underground', 'buried', 'subterranean'], { depth: 0.9 }),
  ...param(['shallow', 'surface'], { depth: 0.08 }),
  ...param(['low'], { register: 0.15 }),
  ...param(['high', 'airy'], { register: 0.85 }),
  ...param(['dry', 'close', 'dead'], { space: 0.08 }),
  ...param(['echoing', 'cavernous', 'spacious', 'reverberant', 'vast', 'huge'], { space: 0.95 }),
  ...param(['bells', 'bell', 'chimes', 'chiming'], { bells: 0.9 }, { bells: 0 }),
  ...param(['heartbeat', 'heart', 'thump', 'kick'], { heartbeat: 0.85 }, { heartbeat: 0 }),
  ...param(['arpeggio', 'arpeggios', 'runs', 'plucked'], { arpeggio: 0.9 }, { arpeggio: 0 }),
  ...param(['ticking', 'tick', 'rhythmic', 'rhythm', 'clockwork'], { tick: 0.7 }, { tick: 0 }),
  ...param(['drifting', 'shifting', 'wandering'], { drift: 1 }, { drift: 0.05 }),
  ...param(['static', 'steady', 'fixed'], { drift: 0.08 }),
  ...param(['colourful', 'colorful', 'rich', 'lush'], { colour: 1 }),
  ...param(['plain', 'bare', 'simple', 'austere'], { colour: 0.05 }),
  ...param(['quiet', 'soft', 'faint', 'background'], { level: 0.4 }),
  ...param(['loud', 'full'], { level: 1 }),
  ...param(['wide'], { width: 1 }),
  ...param(['narrow', 'mono', 'claustrophobic', 'cramped'], { width: 0.15 }),
  ...param(['dissonant', 'clashing', 'harsh'], { clash: 1, unease: 0.9 }, { clash: 0 }),
  ...param(['consonant', 'harmonious', 'pure'], { clash: 0, anchor: 0.8 }),
  ...param(['minor'], { mode: 0.08 }),
  ...param(['major'], { mode: 0.92 }),
  ...param(['cluster', 'shrill', 'whine'], { cluster: 0.8 }, { cluster: 0 }),
]);

/** Words that scale what follows them. */
const SCALES: Record<string, number> = {
  very: 1.5, extremely: 1.8, really: 1.4, highly: 1.5, intensely: 1.6, deeply: 1.5, utterly: 1.8, so: 1.3, too: 1.4,
  quite: 0.85, fairly: 0.75, rather: 0.8, pretty: 0.85, somewhat: 0.6, slightly: 0.4, mildly: 0.4, faintly: 0.3, subtly: 0.3,
  'a little': 0.4, 'a bit': 0.4, 'a touch': 0.3, 'a hint': 0.25, barely: 0.2, more: 1.25, less: 0.6, mostly: 0.8, half: 0.5,
};
const NEGATIONS = new Set(['not', 'no', 'never', 'without', 'non', 'isnt', 'not at all']);
const SILENT = new Set([
  'a', 'an', 'the', 'and', 'but', 'or', 'of', 'with', 'in', 'at', 'on', 'to', 'for', 'is', 'it', 'its', 'this', 'that', 'be', 'feel', 'feels',
  'feeling', 'sound', 'sounds', 'sounding', 'music', 'mood', 'tone', 'kind', 'sort', 'place', 'room', 'district', 'area', 'like', 'all',
  'some', 'here', 'there', 'should', 'make', 'yet', 'also', 'then', 'while', 'bit', 'little', 'touch', 'hint',
]);

/** Teach the parser a new word or phrase (up to three words). Never throws. */
export function registerPromptWord(phrase: string, term: PromptTerm): void {
  const key = normalise(String(phrase)).join(' ');
  if (!key || !term || typeof term !== 'object') return;
  LEXICON.set(key, term);
}

const normalise = (text: string): string[] => text.toLowerCase().replace(/[’']/g, '').replace(/-/g, ' ').match(/[a-z]+/g) ?? [];
const fmt = (n: number): string => n.toFixed(2);

function lookup(phrase: string): PromptTerm | undefined {
  if (getMood(phrase)) return { mood: phrase };
  const term = LEXICON.get(phrase);
  if (term) return term;
  // "high energy", "low tension", "high bells"
  const [level, name, extra] = phrase.split(' ');
  if (!extra && name && (level === 'high' || level === 'low')) {
    const v = level === 'high' ? 0.9 : 0.1;
    if (isAxisName(name)) return { axis: name, value: v };
    if (isParamName(name) && name !== 'pulse') return { params: { [name]: v } };
  }
  if (isAxisName(phrase)) return { axis: phrase, value: 0.9 };
  if (isParamName(phrase) && phrase !== 'pulse') return { params: { [phrase]: 0.9 }, off: { [phrase]: 0 } };
  return undefined;
}

export function parsePrompt(text: string): PromptResult {
  const words = normalise(typeof text === 'string' ? text : '');
  const result: PromptResult = { text: typeof text === 'string' ? text : '', moods: {}, axes: {}, params: {}, understood: [], ignored: [] };
  const axisVotes: Record<AxisName, number[]> = { energy: [], valence: [], tension: [] };
  let scale = 1;
  let negate = false;
  let lead: string[] = [];
  const reset = (): void => {
    scale = 1;
    negate = false;
    lead = [];
  };
  const about = (home: number, value: number): number => home + (value - home) * (negate ? -scale : scale);

  for (let i = 0; i < words.length; ) {
    let matched = false;
    for (let n = Math.min(3, words.length - i); n >= 1 && !matched; n--) {
      const phrase = words.slice(i, i + n).join(' ');
      if (NEGATIONS.has(phrase)) {
        negate = !negate;
      } else if (phrase in SCALES) {
        scale *= SCALES[phrase];
      } else {
        const term = lookup(phrase);
        if (!term) continue;
        const said = [...lead, phrase].join(' ');
        if ('mood' in term) {
          const def = getMood(term.mood);
          if (def && negate) {
            // "not eerie": push each axis the other way from home, as far as the mood pulls it
            const bits: string[] = [];
            for (const a of AXIS_NAMES) {
              const v = clamp(about(HOME_AXES[a], def.axes[a]));
              axisVotes[a].push(v);
              bits.push(`${a} ${fmt(v)}`);
            }
            result.understood.push({ phrase: said, meaning: `away from mood ${term.mood}: ${bits.join(', ')}` });
          } else if (def) {
            result.moods[term.mood] = (result.moods[term.mood] ?? 0) + scale;
            result.understood.push({ phrase: said, meaning: `mood ${term.mood} × ${fmt(scale)}` });
          }
        } else if ('axis' in term) {
          const v = clamp(about(HOME_AXES[term.axis], term.value));
          axisVotes[term.axis].push(v);
          result.understood.push({ phrase: said, meaning: `${term.axis} ${fmt(v)}` });
        } else {
          const source = negate && term.off ? term.off : term.params;
          const bits: string[] = [];
          for (const k of Object.keys(source) as ParamName[]) {
            const v = negate && term.off ? source[k]! : clampParam(k, about(PARAMS[k].base, source[k]!));
            result.params[k] = v;
            bits.push(`${k} ${fmt(v)}`);
          }
          result.understood.push({ phrase: said, meaning: bits.join(', ') });
        }
        reset();
        i += n;
        matched = true;
        continue;
      }
      lead.push(phrase);
      i += n;
      matched = true;
    }
    if (matched) continue;
    const word = words[i++];
    if (SILENT.has(word)) continue;
    result.ignored.push(word);
    reset();
  }
  for (const a of AXIS_NAMES) {
    const votes = axisVotes[a];
    if (votes.length) result.axes[a] = votes.reduce((x, y) => x + y, 0) / votes.length;
  }
  return result;
}

/** Every word the parser knows, for showing in an interface. */
export function promptVocabulary(): { moods: string[]; words: string[]; modifiers: string[] } {
  return { moods: moodNames(), words: [...LEXICON.keys()].sort(), modifiers: [...Object.keys(SCALES), ...NEGATIONS].sort() };
}
