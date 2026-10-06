# game-music

Generative ambient music for games, made in the browser with Web Audio and no sound files: slow pad chords
joined by small voice-leading moves, a beating drone that holds common tones, bells on loops that never line
up, a double-kick heartbeat, plucked arpeggios in time with it. The same seed always gives the same music.

A game steers it with messages: three axes (`energy`, `valence`, `tension`), named moods that can be
blended, or a line of plain words such as `"laid back, slightly eerie, deep"`, so each district of a world can
describe its own music in data.

It is a small TypeScript library with no runtime dependencies, in two layers:

- **Composer**: pure and deterministic. Given a seed and a set of parameters it decides events over time (chord
  changes with a note for every voice, bell strikes, arpeggio runs, heartbeat thumps, drift targets). No Web
  Audio, no clock; it runs in node.
- **Renderer**: builds the Web Audio node graph and plays the composer's events on the audio clock.

`createMusicEngine` joins the two. This repository also holds the demo page that drives it.

## Use

```ts
import { createMusicEngine } from 'game-music';

const music = createMusicEngine({
  context: audioContext,     // the game's AudioContext; leave out and the engine makes its own
  destination: musicBus,     // the game's own gain node
  seed: 'heavy-industry',
  reverb: 0.2,               // the game has its own room reverb: use little or none of the engine's
});

music.on('chord', (c) => hud.show(c.name));
music.start();                                        // from a user gesture
music.mood('eerie', { glide: 10 });
music.steer({ energy: 0.8, tension: 0.6 });
music.prompt('laid back, slightly eerie, deep');
music.send({ type: 'event', event: 'sting' });        // plain data: fine from a worker or a saved file
music.stop();
```

Install from git or a path. The library is plain ES modules with type declarations in `dist-lib/`; a git
install builds it, and for a path install run `npm run build:lib` in this repository first:

```sh
npm install github:maxthelion/game-music
npm install ../game-music
```

## API

### `createMusicEngine(options?)`

| option | default | |
| --- | --- | --- |
| `context` | made on `start()` | The host's `AudioContext`. A host's context is never closed. |
| `destination` | `context.destination` | Where the output goes: the host's music bus. |
| `seed` | `'facility'` | Same seed, same music. |
| `reverb` | `true` | The engine's own long reverb: `true`/`1`, a number 0..1 for less, `false`/`0` for none (no convolver is built). |
| `compressor` | `true` | A gentle compressor on the output. Turn it off if the host has its own. |
| `voices` | `5` | Pad voices, 4 to 8. |
| `lookahead` | `0.35` | Seconds scheduled ahead of the audio clock. |
| `timer` | `true` | `false` if the host calls `engine.tick()` from its own loop. |
| `district` | | A district to start in. |

The engine:

| | |
| --- | --- |
| `start()` | Begin. Returns false only if it could not. With no Web Audio it still composes, silently. |
| `stop()` | Fade out, then release every node. `start()` begins again from the top of the seed. |
| `dispose()` | Stop at once, release everything, drop every listener. |
| `set(params, { glide })` | Pin low-level parameters. `null` releases one back to the mood and axes. |
| `steer(axes, { glide })` | Move along `energy`, `valence`, `tension`; an axis left out stays put. |
| `mood(name \| weights, { glide })` | A named mood, or a blend: `mood({ eerie: 0.6, industrious: 0.4 })`. |
| `prompt(text, { glide })` | Plain words. The result lists what was `understood` and what was `ignored`. |
| `enter(district, { glide })` | Cross to a district's music (see below). |
| `fire(event, { seconds, amount })` | A one-shot: `'sting'`, `'arpeggio'`, `'swell'`, `'silence'`. |
| `send(message)` | Any of the above as one message object, or as JSON text. Never throws. |
| `on(name, fn)` | `'chord'`, `'arpeggio'`, `'beat'`, `'bell'`, `'drift'`, `'cluster'`, `'message'`, `'state'`. Returns a function that removes the listener. Events arrive when they sound. |
| `state` | What is sounding and where the steering is: `chord`, `move`, `blends`, `bpm`, `axes`, `moods`, `params` (now), `target`, `overrides`, `seed`, `district`, `running`, `audio`. |
| `tick()` | Schedule now. Only needed with `timer: false`. |

Changes never click. `glide` is the number of seconds a change takes to come in (defaults: `set` 3, `steer` 6,
`mood` and `prompt` 8, `enter` 30). During a glide the parameters move smoothly, and each takes effect at the
next musical moment it governs: a new tempo at the next beat, a new harmony at the next chord. If the pace
rises, the chord sounding is cut short rather than left to run its old length.

Scheduling is done by one timer with a short lookahead on the audio clock, not a timer per note. A suspended
context simply pauses the music; `start()` asks it to resume. When the page is hidden the lookahead grows so
throttled timers do not leave gaps.

### Messages

One shape for everything, plain data, so it can cross a worker, sit in a queue or live in a saved file.
`parseMessage(anything)` gives back a clean message or `null`.

```ts
{ type: 'mood',   mood: 'eerie', glide: 10 }
{ type: 'mood',   mood: { eerie: 0.6, industrious: 0.4 } }
{ type: 'steer',  axes: { energy: 0.8 } }
{ type: 'set',    params: { pulse: 96, bells: null } }
{ type: 'prompt', text: 'laid back, slightly eerie, deep' }
{ type: 'seed',   seed: 'agriculture' }
{ type: 'enter',  district: { seed: 'research', prompt: 'sterile, a little wonder' }, glide: 30 }
{ type: 'event',  event: 'sting', amount: 0.8 }
{ type: 'event',  event: 'silence', seconds: 6 }
{ type: 'reset' }
```

One-shots: `sting` is a sudden far chord with a clashing note, a low hit and two bells a semitone apart;
`arpeggio` starts a run on the next beat; `swell` lifts the pad for `seconds` and lets it fall; `silence` fades
everything out for `seconds` and back.

### How the steering layers stack

1. The **axes** give every parameter a value (table below).
2. A **mood** or **prompt** sets the axes and may pin some parameters over them. Each new mood or prompt replaces
   the last.
3. **`set`** pins parameters over both, until released with `null`. `enter` and `reset` clear them.

### Low-level parameters

<!-- table:params -->
| parameter | range | base | what it does |
| --- | --- | --- | --- |
| `level` | 0 … 1 | 0.8 | Overall loudness of the engine before the host's own gain. |
| `unease` | 0 … 1 | 0.6 | Low: related chords. High: chord changes with no key in common (slide, pole, tritone). |
| `mode` | 0 … 1 | 0.5 | 0 prefers minor triads, 1 prefers major; at 0.5 major and minor alternate as each move dictates. |
| `anchor` | 0 … 1 | 0 | How strongly the harmony stays inside its home key instead of roaming. |
| `clash` | 0 … 1 | 1 | Scales the chance (set by unease) of an added note that does not belong: a semitone or a tritone. |
| `colour` | 0 … 1 | 0.8 | How often a chord is dressed (add9, sus2, sus4, sixth, sevenths). At 0 every chord is a plain triad. |
| `brightness` | 0 … 1 | 0.5 | Opens the filters and tilts dressings towards the bright ones (add9, major 7, sixth, sus2). |
| `register` | 0 … 1 | 0.5 | Where the voices, bells and arpeggios sit: 0 is about seven semitones lower, 1 seven higher. |
| `depth` | 0 … 1 | 0.4 | How far down you are: lower pitch, darker tone, more air noise. |
| `drift` | 0 … 1 | 0.7 | How far the synth itself wanders: waveform blends, detune, position, filter sweeps. |
| `pace` | 0 … 1 | 0.5 | Chord length and the speed of drift: 0 is 24 to 40 seconds a chord, 0.5 is 14 to 26, 1 is 4 to 8. |
| `bells` | 0 … 1 | 0.5 | How often the three slow loops strike a high note. At 0 never. |
| `arpeggio` | 0 … 1 | 0.5 | How often a plucked run drifts in. At 0 never. |
| `flurry` | 0 … 1 | 0.35 | How fast and how long each arpeggio is, and how soon the next follows. |
| `heartbeat` | 0 … 1 | 0.5 | Level of the double kick. At 0 it is off (the beat still counts silently). |
| `pulse` | 30 … 180 bpm | 54 | Beats a minute for the heartbeat, the tick and the arpeggios. A change lands on the next beat. |
| `tick` | 0 … 1 | 0 | Level of a light pulse note on the subdivisions of the beat. At 0 it is off. |
| `cluster` | 0 … 1 | 0 | How often and how loudly a high cluster of close notes rises and is cut off. |
| `width` | 0 … 1 | 0.7 | Stereo spread of the voices and bells; 0 is everything in the middle. |
| `space` | 0 … 1 | 0.55 | Amount of the engine's own reverb (multiplied by the engine's `reverb` option). |
<!-- /table:params -->

### Axes

`energy` is laid back 0 to frantic 1; `valence` is eerie and dark 0 to cheerful and bright 1; `tension` is calm 0
to threatened 1. The base values are the original study, which is slow, dark and slightly uneasy, so the
**home point is not the middle**: it is energy 0.3, valence 0.2, tension 0.35. Each cell is what the axis adds to
the parameter at 0 and at 1; at home it adds nothing, with a straight line on each side. The three effects are
summed and clamped. This table is generated from `AXIS_MAP` in `src/params.ts`, and `npm test` fails if it is
out of step.

<!-- table:axes -->
| parameter | base | energy 0 … 1 (home 0.3) | valence 0 … 1 (home 0.2) | tension 0 … 1 (home 0.35) |
| --- | --- | --- | --- | --- |
| `level` | 0.8 |  |  |  |
| `unease` | 0.6 |  | +0.15 … −0.5 | −0.25 … +0.4 |
| `mode` | 0.5 |  | −0.3 … +0.45 |  |
| `anchor` | 0 |  | 0 … +0.9 |  |
| `clash` | 1 |  | 0 … −1 | −0.3 … 0 |
| `colour` | 0.8 |  | 0 … +0.1 |  |
| `brightness` | 0.5 |  | −0.15 … +0.45 | +0.05 … −0.25 |
| `register` | 0.5 |  | −0.1 … +0.4 |  |
| `depth` | 0.4 |  | +0.15 … −0.25 |  |
| `drift` | 0.7 | −0.2 … +0.3 |  |  |
| `pace` | 0.5 | −0.35 … +0.5 |  |  |
| `bells` | 0.5 | 0 … +0.15 | −0.1 … +0.35 |  |
| `arpeggio` | 0.5 | −0.4 … +0.5 | −0.1 … +0.25 |  |
| `flurry` | 0.35 | −0.25 … +0.65 |  |  |
| `heartbeat` | 0.5 | −0.3 … +0.1 |  | −0.4 … +0.5 |
| `pulse` | 54 | −12 … +66 |  | −6 … +40 |
| `tick` | 0 | 0 … +0.8 |  |  |
| `cluster` | 0 |  |  | 0 … +0.9 |
| `width` | 0.7 |  |  | +0.15 … −0.45 |
| `space` | 0.55 |  |  | 0 … −0.1 |
<!-- /table:axes -->

What those parameters do in the composer is data as well (`src/tables.ts`): the weight of each chord move at
low and high `unease`, the weight of each dressing at low and high `brightness`, chord lengths by `pace`,
arpeggio rates by `flurry`, and so on.

### Moods

<!-- table:moods -->
| mood | energy | valence | tension | pins | what it is |
| --- | --- | --- | --- | --- | --- |
| `uneasy` | 0.3 | 0.2 | 0.35 |  | The original study: slow, dark, something slightly wrong. This is the home point. |
| `eerie` | 0.2 | 0.08 | 0.55 | bells 0.7, space 0.75 | Still and strange: unrelated chords, many bells, a long room. |
| `calm` | 0.1 | 0.6 | 0.05 | heartbeat 0, clash 0 | Long related chords, no heartbeat, nothing that clashes. |
| `melancholy` | 0.15 | 0.35 | 0.2 | mode 0.12, anchor 0.75, clash 0, unease 0.2 | Minor, but in one key and consonant: sad rather than wrong. |
| `cheerful` | 0.55 | 0.95 | 0.05 |  | Major chords in one key, high and open, frequent bells and runs. |
| `industrious` | 0.7 | 0.55 | 0.3 | tick 0.7, heartbeat 0.6, bells 0.3 | Busy and purposeful: a steady tick, a firm pulse, regular runs. |
| `frantic` | 1 | 0.35 | 0.8 |  | Short chords, a racing pulse, runs tumbling over each other. |
| `dread` | 0.15 | 0 | 1 | depth 0.9, bells 0.15 | Deep, narrow and dark with a loud heart and a rising high cluster. |
| `wonder` | 0.35 | 0.8 | 0.1 | anchor 0.1, unease 0.45, bells 0.9, space 0.8, register 0.8 | Bright major chords that step sideways into far keys; high, wide, full of bells. |
| `sterile` | 0.2 | 0.55 | 0.15 | colour 0.1, drift 0.1, space 0.15, bells 0.1, arpeggio 0.2, heartbeat 0, clash 0, unease 0.25, anchor 0.6 | Plain triads, almost no movement in the sound, a dry room. |
<!-- /table:moods -->

Weights above a total of 1 are normalised; below 1 the remainder is the home point, so `mood({ cheerful: 0.3 })`
is a little cheerful. What each mood comes to in low-level parameters:

<!-- table:mood-params -->
| parameter | uneasy | eerie | calm | melancholy | cheerful | industrious | frantic | dread | wonder | sterile |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `level` | 0.8 | 0.8 | 0.8 | 0.8 | 0.8 | 0.8 | 0.8 | 0.8 | 0.8 | 0.8 |
| `unease` | 0.6 | 0.81 | 0.14 | 0.2 | 0 | 0.35 | 0.78 | 1 | 0.45 | 0.25 |
| `mode` | 0.5 | 0.32 | 0.73 | 0.12 | 0.92 | 0.7 | 0.58 | 0.2 | 0.84 | 0.7 |
| `anchor` | 0 | 0 | 0.45 | 0.75 | 0.84 | 0.39 | 0.17 | 0 | 0.1 | 0.6 |
| `clash` | 1 | 1 | 0 | 0 | 0 | 0.52 | 0.81 | 1 | 0.04 | 0 |
| `colour` | 0.8 | 0.8 | 0.85 | 0.82 | 0.89 | 0.84 | 0.82 | 0.8 | 0.88 | 0.1 |
| `brightness` | 0.5 | 0.33 | 0.77 | 0.61 | 0.96 | 0.7 | 0.41 | 0.1 | 0.87 | 0.73 |
| `register` | 0.5 | 0.44 | 0.7 | 0.57 | 0.88 | 0.68 | 0.57 | 0.4 | 0.8 | 0.68 |
| `depth` | 0.4 | 0.49 | 0.28 | 0.35 | 0.17 | 0.29 | 0.35 | 0.9 | 0.21 | 0.29 |
| `drift` | 0.7 | 0.63 | 0.57 | 0.6 | 0.81 | 0.87 | 1 | 0.6 | 0.72 | 0.1 |
| `pace` | 0.5 | 0.38 | 0.27 | 0.33 | 0.68 | 0.79 | 1 | 0.33 | 0.54 | 0.38 |
| `bells` | 0.5 | 0.7 | 0.68 | 0.57 | 0.88 | 0.3 | 0.72 | 0.15 | 0.9 | 0.1 |
| `arpeggio` | 0.5 | 0.31 | 0.36 | 0.35 | 0.91 | 0.9 | 1 | 0.2 | 0.72 | 0.2 |
| `flurry` | 0.35 | 0.27 | 0.18 | 0.22 | 0.58 | 0.72 | 1 | 0.22 | 0.4 | 0.27 |
| `heartbeat` | 0.5 | 0.55 | 0 | 0.18 | 0.19 | 0.6 | 0.95 | 0.85 | 0.22 | 0 |
| `pulse` | 54 | 62 | 41 | 45 | 72 | 91 | 148 | 88 | 54 | 47 |
| `tick` | 0 | 0 | 0 | 0 | 0.29 | 0.7 | 0.8 | 0 | 0.06 | 0 |
| `cluster` | 0 | 0.28 | 0 | 0 | 0 | 0 | 0.62 | 0.9 | 0 | 0 |
| `width` | 0.7 | 0.56 | 0.83 | 0.76 | 0.83 | 0.72 | 0.39 | 0.25 | 0.81 | 0.79 |
| `space` | 0.55 | 0.75 | 0.55 | 0.55 | 0.55 | 0.55 | 0.48 | 0.45 | 0.8 | 0.15 |
<!-- /table:mood-params -->

### Adding a mood

A mood is data: a point on the axes and, if wanted, parameters it pins.

```ts
import { registerMood, registerPromptWord } from 'game-music';

registerMood('flooded', {
  description: 'Slow, deep and wet, with many bells.',
  axes: { energy: 0.15, valence: 0.3, tension: 0.4 },
  params: { depth: 0.9, space: 0.9, bells: 0.8, heartbeat: 0 },
});
registerPromptWord('waterlogged', { mood: 'flooded' });   // optional: a synonym for prompts

music.mood({ flooded: 0.7, eerie: 0.3 });
music.prompt('very flooded, tense');
```

To add one to the library itself, add an entry to `BUILT_IN` in `src/moods.ts` and run `npm run docs:table`.

### Prompts

`parsePrompt(text)` is a keyword parser: no AI and no network. It knows the mood names and their synonyms
(creepy, serene, sad, mechanical, panicked ...), words for each axis (laid back, busy, dark, bright, tense, safe
...), words for single parameters (deep, shallow, high, low, dry, cavernous, bells, heartbeat, ticking, quiet,
narrow, minor, major ...), `high energy` / `low tension`, and the modifiers `very`, `extremely`, `quite`,
`slightly`, `a little`, `barely`, `not`, `no`, `without`. Mood words become blend weights (`slightly eerie` is
eerie at 0.4, the rest home); axis words then set their axis; parameter words pin a parameter. Words it does
not know are returned in `ignored`. `promptVocabulary()` lists every word.

## Driving it from a game, district by district

A district is data: `{ seed, prompt | mood, axes?, overrides? }`. Keep one with each district's definition.

```ts
import type { District } from 'game-music';

const districts: Record<string, District> = {
  heavyIndustry: { name: 'Heavy industry', seed: 'heavy-industry', prompt: 'industrious, slightly uneasy, deep, ticking' },
  agriculture:   { name: 'Agriculture', seed: 'agriculture', mood: { calm: 0.6, cheerful: 0.4 }, overrides: { depth: 0.1 } },
  research:      { name: 'Research', seed: 'research', prompt: 'sterile, a little wonder, slightly eerie, high', axes: { tension: 0.3 } },
};

// when the player crosses a boundary
music.enter(districts.agriculture, { glide: 30 });

// on top of the district, as things happen
music.steer({ tension: 0.9 }, { glide: 4 });      // an alarm: the heart quickens within a beat or two
music.fire('sting');                              // something seen
music.steer({ tension: 0.2 }, { glide: 20 });     // it passes
```

`enter` replaces the whole description (mood, axes and `set` pins), switches to the district's seed and glides
the parameters there over `glide` seconds, which at the default is a chord or two. The chord sounding carries
on, and the drone stays on its note for as long as the next chords share it, so there is no seam. From a worker
or from saved data, send the same thing as a message: `{ type: 'enter', district, glide: 30 }`.

Suggested wiring in a game: one engine for the whole session, on the game's audio context, into a music gain
node, with `reverb` low or off if rooms have their own. Let `level` follow the game's music volume through
that gain node rather than through `set`. Use `enter` for place, `steer` for what is happening to the player,
and `fire` for moments.

## What is new since the study, and not yet heard

The dark, slow side of the engine is the original study, which has been listened to. The home point reproduces
its parameters. Everything else was written without being heard and should be listened to critically:

- **Valence up**: chord moves that keep major as major (fifth, fourth, mediant), a home key the harmony is held
  to, bright dressings including the sixth chord, a higher register, open filters, no clashing notes, a second
  bell strike per loop.
- **Energy up**: chords of 4 to 8 seconds with squeezed voice glides, pulse up to 120, arpeggios at 4 to 8 notes a
  beat that run three times longer and return three times sooner, the tick (a soft pulse note on the half or
  quarter beat), faster drift.
- **Tension up**: the rising high cluster, a narrower stereo field, the darker tone.
- **One-shots**: sting, swell and silence.
- All moods except `uneasy`, which is the study itself.

## The demo

```sh
npm install
npm run dev        # the desk at http://localhost:5173
```

Start/Stop, the chord sounding with the move that led to it and each voice's blend, three district presets, the
three axes, mood buttons with blend weights, a prompt box that shows what was understood and ignored, the
one-shots, the seed, the low-level parameters in a collapsed section, and a log of every message as the JSON a
game would send. Headphones help.

## Develop

```sh
npm run typecheck
npm test             # node, no audio: the composer, steering, prompt, messages, a fake AudioContext
npm run build        # library to dist-lib/, demo site to dist/
npm run docs:table   # rewrite the README tables from the code
```

## Deploy

Build command `npm run build`; output directory `dist` (a static site with relative paths, so it works at any
base path). `wrangler.jsonc` describes it as a static-assets Worker named `game-music`, so `npx wrangler deploy`
after the build is enough.

## Licence

MIT, © Max Williams. `prototype/facility-drone.html` is the original single-page study, kept for reference.
