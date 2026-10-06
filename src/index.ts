/**
 * game-music: generative ambient music for games.
 *
 * Two layers: a pure, deterministic composer (`./composer`) that decides events from a seed and a
 * set of parameters, and a Web Audio renderer that plays them. `createMusicEngine` joins the two
 * and is what a host normally uses.
 */
export { createMusicEngine, DEFAULT_GLIDE } from './engine.js';
export type { EngineEventName, EngineEvents, EngineOptions, EngineState, GlideOptions, MusicEngine, SendResult } from './engine.js';

export { Composer, createComposer, chordSeconds } from './composer.js';
export type {
  ArpeggioEvent,
  BeatEvent,
  BellEvent,
  ChordEvent,
  ClusterEvent,
  ComposerOptions,
  DriftEvent,
  HitEvent,
  MusicEvent,
  MusicEventType,
  OneShotOptions,
  SilenceEvent,
  SwellEvent,
} from './composer.js';

export { Renderer } from './renderer.js';
export type { RendererOptions } from './renderer.js';

export { AXIS_DOCS, AXIS_MAP, AXIS_NAMES, HOME_AXES, PARAMS, PARAM_NAMES, baseParams, paramsFromAxes } from './params.js';
export type { Axes, AxisName, ParamName, ParamSpec, Params } from './params.js';

export { blendMoods, getMood, moodNames, moodParams, registerMood } from './moods.js';
export type { MoodBlend, MoodDef, MoodWeights } from './moods.js';

export { parsePrompt, promptVocabulary, registerPromptWord } from './prompt.js';
export type { PromptResult, PromptTerm } from './prompt.js';

export { Steering, districtParams } from './steering.js';
export type { District, SteeringSnapshot } from './steering.js';

export { ONE_SHOTS, parseMessage } from './messages.js';
export type { Message, MessageType, OneShot } from './messages.js';

export { DRESSINGS, LAYERS, MOVES, NOTE_NAMES, TABLES } from './tables.js';
export type { DressingDef, LayerName, MoveDef, MoveKey } from './tables.js';

export { axesTable, moodParamsTable, moodsTable, paramsTable } from './docs.js';
export { rng } from './rng.js';
