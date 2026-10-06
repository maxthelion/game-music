/**
 * The composer's musical knowledge, as data. Every weight and range the composer uses is here, so
 * a new behaviour is a new row or a changed number rather than new code.
 */

export const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'] as const;

export interface MoveDef {
  label: string;
  description: string;
  /** From a major triad: [semitones the root moves, whether the result is minor]. */
  major: readonly [number, boolean];
  /** From a minor triad: the same. */
  minor: readonly [number, boolean];
  /** The move that undoes this one; it is made unlikely straight afterwards. */
  inverse: string;
  /** Weight at unease 0 and at unease 1. */
  weight: readonly [number, number];
  /** Moves that keep major as major and minor as minor only appear when `mode` leans one way. */
  keepsMode?: boolean;
}

/**
 * Ways of getting from one triad to the next. The first six are the original study's: each moves one
 * or two notes by a semitone or a tone and each swaps major and minor. The rest keep the mode, which is
 * what lets the music stay major (or stay minor) for more than one chord.
 */
export const MOVES = {
  R: { label: 'relative', description: 'shares two notes; same key', major: [9, true], minor: [3, false], inverse: 'R', weight: [1, 0.2] },
  L: { label: 'leading note', description: 'shares two notes; one slips a semitone', major: [4, true], minor: [8, false], inverse: 'L', weight: [1, 0.4] },
  P: { label: 'parallel', description: 'same root, major and minor swap', major: [0, true], minor: [0, false], inverse: 'P', weight: [0.3, 0.8] },
  N: { label: 'neighbour', description: 'two notes slip a semitone', major: [5, true], minor: [7, false], inverse: 'N', weight: [0.2, 0.8] },
  S: { label: 'slide', description: 'keeps only the third; root slips a semitone', major: [1, true], minor: [11, false], inverse: 'S', weight: [0, 1] },
  H: { label: 'pole', description: 'no shared key at all', major: [8, true], minor: [4, false], inverse: 'H', weight: [0, 1.4] },
  D: { label: 'fifth', description: 'up a fifth; same key, shares one note', major: [7, false], minor: [7, true], inverse: 'F', weight: [1, 0.25], keepsMode: true },
  F: { label: 'fourth', description: 'up a fourth; same key, shares one note', major: [5, false], minor: [5, true], inverse: 'D', weight: [1, 0.25], keepsMode: true },
  M: { label: 'mediant', description: 'up a major third into a far key; shares one note', major: [4, false], minor: [4, true], inverse: 'W', weight: [0.1, 0.6], keepsMode: true },
  W: { label: 'submediant', description: 'down a major third into a far key; shares one note', major: [8, false], minor: [8, true], inverse: 'M', weight: [0.1, 0.6], keepsMode: true },
  T: { label: 'tritone', description: 'the furthest root; nothing shared', major: [6, false], minor: [6, true], inverse: 'T', weight: [0, 0.5], keepsMode: true },
} as const satisfies Record<string, MoveDef>;

export type MoveKey = keyof typeof MOVES;
export const MOVE_KEYS = Object.keys(MOVES) as MoveKey[];

export interface DressingDef {
  id: string;
  /** Appended to the root's name. */
  suffix: string;
  /** Semitones above the root. A sus chord drops the third. */
  steps: readonly number[];
  /** Weight at brightness 0 and at brightness 1. */
  weight: readonly [number, number];
}

export const PLAIN: Record<'major' | 'minor', DressingDef> = {
  major: { id: 'major', suffix: ' major', steps: [0, 4, 7], weight: [1, 1] },
  minor: { id: 'minor', suffix: ' minor', steps: [0, 3, 7], weight: [1, 1] },
};

export const DRESSINGS: Record<'major' | 'minor', readonly DressingDef[]> = {
  major: [
    { id: 'add9', suffix: ' add9', steps: [0, 4, 7, 14], weight: [3, 4] },
    { id: 'sus2', suffix: ' sus2', steps: [0, 2, 7], weight: [2, 3] },
    { id: 'sus4', suffix: ' sus4', steps: [0, 5, 7], weight: [1.5, 0.4] },
    { id: 'major7', suffix: ' major 7', steps: [0, 4, 7, 11], weight: [2.5, 3.5] },
    { id: 'dominant7', suffix: ' 7', steps: [0, 4, 7, 10], weight: [1, 0.1] },
    { id: 'sixth', suffix: ' 6', steps: [0, 4, 7, 9], weight: [0, 6] },
  ],
  minor: [
    { id: 'minor-add9', suffix: ' minor add9', steps: [0, 3, 7, 14], weight: [3, 2.5] },
    { id: 'minor7', suffix: ' minor 7', steps: [0, 3, 7, 10], weight: [3.5, 3.5] },
    { id: 'sus2', suffix: ' sus2', steps: [0, 2, 7], weight: [1.5, 2.5] },
    { id: 'sus4', suffix: ' sus4', steps: [0, 5, 7], weight: [2, 0.8] },
  ],
};

/** The waveform layers of a voice, with the level each has in the plain pad and when it leads a blend. */
export const LAYERS = {
  bright: { pad: 0.3, peak: 0.5 },
  soft: { pad: 0.7, peak: 0.9 },
  hollow: { pad: 0, peak: 0.22 },
  glass: { pad: 0, peak: 0.6 },
  reed: { pad: 0, peak: 0.38 },
  air: { pad: 0, peak: 0.3 },
} as const;
export type LayerName = keyof typeof LAYERS;
export const LAYER_NAMES = Object.keys(LAYERS) as LayerName[];

export const TABLES = {
  /** How strongly `mode` favours moves that land on the preferred kind of triad (an exponent). */
  modeGain: 1.6,
  /** At anchor 1, a move out of the home key keeps only this much of its weight. */
  anchorLeak: 0.05,
  /** The move that undoes the last one keeps this much of its weight. */
  undoWeight: 0.15,
  /** Chance of a clashing extra note is unease × clash × this. */
  clashChance: 0.3,
  /** Of the clashes, the share that are a semitone above the root (the rest are a tritone). */
  clashSemitoneShare: 0.6,
  /** Chord length in seconds at pace 0, 0.5 and 1. */
  chordSeconds: { slow: [24, 40], mid: [14, 26], fast: [4, 8] },
  /** Drift's interval and glide time are multiplied by this at pace 0 and at pace 1. */
  driftPaceScale: [1.3, 0.45],
  /** The middle of the voices' range as a MIDI note, and how far depth and register move it. */
  voiceCentre: 57,
  depthDrop: 10,
  registerSpan: 14,
  /** The voices' range may move this many semitones a chord at most, so no voice ever leaps. */
  centreStep: 4,
  voiceRange: [-12, 17],
  /** Voices change note this many seconds apart, each gliding with this time constant. */
  voiceStagger: 2.2,
  voiceStaggerJitter: 1.5,
  voiceGlide: 1.4,
  /** Chords shorter than this many seconds squeeze the stagger and the glide in proportion. */
  fullStaggerSeconds: 20,
  droneBase: 34,
  droneDepthDrop: 7,
  /** The three bell loops: seconds a loop, lowest note, seconds before the first strike. */
  bellLoops: [
    { period: 17.3, low: 72, first: 6 },
    { period: 23.7, low: 79, first: 11 },
    { period: 31.1, low: 67, first: 16 },
  ],
  bellChance: [0.25, 0.95],
  /** Above this bells value a loop may strike a second time half a loop later. */
  bellSecondAbove: 0.6,
  bellRegisterSpan: 12,
  /** Arpeggio notes to a beat, by flurry: the first row whose `upTo` is not below flurry is used. */
  arpeggioRates: [
    { upTo: 0.18, perBeat: [2, 3] },
    { upTo: 0.6, perBeat: [3, 4] },
    { upTo: 0.85, perBeat: [4, 6] },
    { upTo: 1, perBeat: [6, 8] },
  ],
  /** No arpeggio note follows another closer than this many seconds. */
  arpeggioFastest: 0.075,
  arpeggioBeats: [2, 4],
  /** At flurry 1 a run is this many times longer, and the wait this many times shorter, than at 0.35. */
  flurryStretch: 3,
  flurryNeutral: 0.35,
  arpeggioBase: 64,
  arpeggioDepthDrop: 7,
  arpeggioRegisterSpan: 10,
  arpeggioWait: [18, 48],
  /** Seconds before the first beat, and the wait after the first arpeggio. */
  firstBeat: 4,
  secondArpeggioWait: [9, 15],
  /** How uneven the beat is (a share of its length) with no tick; the tick steadies it. */
  beatWander: 0.06,
  /** The tick's notes above the chord root, for two and for four to the beat. */
  tickPatterns: { 2: [0, 7], 4: [0, 7, 12, 7] } as Record<number, number[]>,
  tickFourAbove: 0.5,
  tickBase: 72,
  /** The rising cluster: seconds between attempts, seconds long, lowest note, semitone offsets. */
  clusterGap: [25, 55],
  clusterSeconds: [8, 18],
  clusterLow: [84, 90],
  clusterSteps: [0, 1, 2],
  clusterWideSteps: [0, 1, 2, 6],
  clusterWideAbove: 0.6,
  /** A sting uses one of these moves and always clashes. */
  stingMoves: ['H', 'S', 'T'] as MoveKey[],
} as const;
