// The demo desk. It uses the library only through its public entry point, as a game would:
// every control builds one message and hands it to engine.send().
import {
  type AxisName,
  type District,
  type Message,
  type MoodWeights,
  type ParamName,
  AXIS_DOCS,
  AXIS_NAMES,
  ONE_SHOTS,
  PARAMS,
  PARAM_NAMES,
  createMusicEngine,
  getMood,
  moodNames,
} from 'game-music';

const DISTRICTS: District[] = [
  { name: 'Heavy industry', seed: 'heavy-industry', prompt: 'industrious, slightly uneasy, deep, ticking' },
  { name: 'Agriculture', seed: 'agriculture', mood: { calm: 0.6, cheerful: 0.4 }, overrides: { depth: 0.1 } },
  { name: 'Research', seed: 'research', prompt: 'sterile, a little wonder, slightly eerie, high', axes: { tension: 0.3 } },
];

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: Array<Node | string>): HTMLElementTagNameMap[K] => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const fmt = (name: ParamName, v: number): string => (name === 'pulse' ? Math.round(v) + ' bpm' : v.toFixed(2));

const seedInput = $<HTMLInputElement>('seed');
const engine = createMusicEngine({ seed: seedInput.value.trim() || 'facility' });

/** The glide the desk adds to messages; undefined leaves each message its own default. */
function glide(): { glide?: number } {
  const v = Number($<HTMLInputElement>('glide').value);
  return v < 0 ? {} : { glide: v };
}
const send = (message: Message): ReturnType<typeof engine.send> => engine.send(message);

// ---- transport ---------------------------------------------------------------------------------------

const go = $<HTMLButtonElement>('go');
go.addEventListener('click', () => {
  // audio only ever starts here, from a press
  if (engine.state.running) engine.stop();
  else if (!engine.start()) $('move').textContent = 'Could not start.';
});
engine.on('state', (s) => {
  go.textContent = s.running ? 'Stop' : 'Start';
  go.setAttribute('aria-pressed', String(s.running));
  if (s.running) $('log').textContent = '';
  if (s.running && s.audio === 'none') $('move').textContent = 'This browser has no Web Audio: composing silently.';
  showNow();
});

function showNow(): void {
  const s = engine.state;
  $('chord').textContent = s.chord ? s.chord.name : 'silent';
  if (!s.running) $('move').textContent = 'press Start';
  else if (s.audio === 'suspended') $('move').textContent = 'audio is suspended: press Stop, then Start';
  else if (s.chord && s.move) {
    const clash = s.chord.clash ? `  + ${s.chord.clash === 'semitone' ? 'semitone clash' : 'tritone'}` : '';
    $('move').textContent = (s.move.key ? `${s.move.label}: ${s.move.description}` : 'starting chord') + clash + `  ·  ${Math.round(s.bpm)} bpm`;
  }
  $('blend').textContent = s.running ? s.blends.join('  ·  ') : '';
}

engine.on('chord', (c) => {
  const text = `${c.name}   ${c.move ? 'by ' + c.moveLabel : 'start'}${c.sting ? '   (sting)' : ''}${c.clash ? '   + ' + c.clash : ''}`;
  const log = $('log');
  log.prepend(el('li', { textContent: text }));
  while (log.children.length > 10) log.lastChild!.remove();
  showNow();
});
engine.on('arpeggio', (a) => {
  $('move').textContent += `   · arpeggio (${a.notes.length} notes)`;
});
engine.on('drift', showNow);

// ---- the message log -----------------------------------------------------------------------------------

let sent = 0;
engine.on('message', (m) => {
  const log = $('messages');
  if (!sent++) log.textContent = '';
  log.prepend(el('li', { textContent: JSON.stringify(m) }));
  while (log.children.length > 12) log.lastChild!.remove();
  sync();
});

// ---- districts -----------------------------------------------------------------------------------------

for (const d of DISTRICTS) {
  $('districts').append(
    el('button', {
      textContent: d.name!,
      onclick: () => {
        showPrompt(send({ type: 'enter', district: d, ...glide() }));
        seedInput.value = engine.seed;
        $('districtData').textContent = JSON.stringify(d, null, 1).replace(/\n\s*/g, ' ');
      },
    }),
  );
}

// ---- axes ----------------------------------------------------------------------------------------------

const axisInputs = {} as Record<AxisName, { input: HTMLInputElement; val: HTMLElement }>;
for (const a of AXIS_NAMES) {
  const val = el('span', { className: 'val' });
  const input = el('input', { type: 'range', min: '0', max: '1', step: '0.01', id: 'axis-' + a });
  input.addEventListener('change', () => send({ type: 'steer', axes: { [a]: Number(input.value) }, ...glide() }));
  input.addEventListener('input', () => (val.textContent = Number(input.value).toFixed(2)));
  axisInputs[a] = { input, val };
  $('axes').append(
    el('label', { className: 'fader', htmlFor: input.id }, el('span', { className: 'row' }, el('span', { className: 'label', textContent: a }), val), input, el('span', { className: 'hint', textContent: AXIS_DOCS[a] })),
  );
}

// ---- moods ---------------------------------------------------------------------------------------------

const moodInputs = new Map<string, { box: HTMLElement; input: HTMLInputElement; w: HTMLElement }>();
function blendFromSliders(): MoodWeights {
  const weights: MoodWeights = {};
  for (const [name, m] of moodInputs) if (Number(m.input.value) > 0) weights[name] = Number(m.input.value);
  return weights;
}
for (const name of moodNames()) {
  const w = el('span', { className: 'w', textContent: '0' });
  const button = el('button', { title: getMood(name)?.description ?? '' }, el('span', { textContent: name }), w);
  const input = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: '0', ariaLabel: `Weight of ${name} in the blend` });
  button.addEventListener('click', () => send({ type: 'mood', mood: name, ...glide() }));
  input.addEventListener('change', () => send({ type: 'mood', mood: blendFromSliders(), ...glide() }));
  input.addEventListener('input', () => (w.textContent = Number(input.value).toFixed(2)));
  const box = el('div', { className: 'mood' }, button, input);
  moodInputs.set(name, { box, input, w });
  $('moods').append(box);
}

// ---- prompt --------------------------------------------------------------------------------------------

function showPrompt(result: ReturnType<typeof engine.send>): void {
  const out = $('promptResult');
  out.textContent = '';
  if (!result.understood && !result.ignored) return;
  for (const u of result.understood ?? []) out.append(el('dt', { textContent: u.phrase }), el('dd', { textContent: u.meaning }));
  if (result.ignored?.length) out.append(el('dt', { className: 'ignored', textContent: 'ignored' }), el('dd', { textContent: result.ignored.join(', ') }));
  if (!result.understood?.length) out.append(el('dt', { className: 'ignored', textContent: 'understood' }), el('dd', { textContent: 'nothing' }));
}
$<HTMLFormElement>('promptForm').addEventListener('submit', (e) => {
  e.preventDefault();
  showPrompt(send({ type: 'prompt', text: $<HTMLInputElement>('prompt').value, ...glide() }));
});

// ---- one-shots -----------------------------------------------------------------------------------------

const SHOT_DATA: Record<(typeof ONE_SHOTS)[number], { label: string; extra: { seconds?: number; amount?: number } }> = {
  sting: { label: 'Sting', extra: { amount: 0.8 } },
  arpeggio: { label: 'Arpeggio', extra: {} },
  swell: { label: 'Swell', extra: { seconds: 8 } },
  silence: { label: 'Silence 6 s', extra: { seconds: 6 } },
};
for (const event of ONE_SHOTS) {
  $('shots').append(
    el('button', {
      textContent: SHOT_DATA[event].label,
      onclick: () => {
        const r = send({ type: 'event', event, ...SHOT_DATA[event].extra });
        if (!r.ok) $('move').textContent = 'press Start first';
      },
    }),
  );
}

// ---- seed and glide ------------------------------------------------------------------------------------

seedInput.addEventListener('change', () => send({ type: 'seed', seed: seedInput.value.trim() || 'facility' }));
$<HTMLInputElement>('glide').addEventListener('input', (e) => {
  const v = Number((e.target as HTMLInputElement).value);
  $('glideV').textContent = v < 0 ? 'default' : v + ' s';
});

// ---- advanced: the low-level parameters ------------------------------------------------------------------

const paramInputs = {} as Record<ParamName, { box: HTMLElement; input: HTMLInputElement; val: HTMLElement; held: boolean }>;
for (const name of PARAM_NAMES) {
  const spec = PARAMS[name];
  const val = el('span', { className: 'val' });
  const input = el('input', { type: 'range', min: String(spec.min), max: String(spec.max), step: name === 'pulse' ? '1' : '0.01', id: 'param-' + name });
  const box = el('label', { className: 'fader', htmlFor: input.id }, el('span', { className: 'row' }, el('span', { className: 'label', textContent: name }), val), input, el('span', { className: 'hint', textContent: spec.doc }));
  const entry = { box, input, val, held: false };
  input.addEventListener('input', () => {
    entry.held = true;
    val.textContent = fmt(name, Number(input.value));
  });
  input.addEventListener('change', () => {
    entry.held = false;
    send({ type: 'set', params: { [name]: Number(input.value) }, ...glide() });
  });
  paramInputs[name] = entry;
  $('params').append(box);
}
$('release').addEventListener('click', () => {
  const pinned = Object.keys(engine.state.overrides) as ParamName[];
  if (pinned.length) send({ type: 'set', params: Object.fromEntries(pinned.map((k) => [k, null])), ...glide() });
});

// ---- keeping the desk in step with the engine --------------------------------------------------------------

/** After any message: put every control where the engine now is. */
function sync(): void {
  const s = engine.state;
  for (const a of AXIS_NAMES) {
    axisInputs[a].input.value = String(s.axes[a]);
    axisInputs[a].val.textContent = s.axes[a].toFixed(2);
  }
  for (const [name, m] of moodInputs) {
    const w = s.moods[name] ?? 0;
    m.input.value = String(w);
    m.w.textContent = w ? w.toFixed(2) : '0';
    m.box.classList.toggle('on', w > 0);
  }
  for (const name of PARAM_NAMES) {
    const p = paramInputs[name];
    p.box.classList.toggle('pinned', name in s.overrides);
    if (!p.held) p.input.value = String(s.target[name]);
  }
  showParams();
}
/** While a glide runs: show where each parameter is now and where it is going. */
function showParams(): void {
  if (!$<HTMLDetailsElement>('advanced').open) return;
  const s = engine.state;
  for (const name of PARAM_NAMES) {
    const p = paramInputs[name];
    if (p.held) continue;
    const now = fmt(name, s.params[name]);
    const to = fmt(name, s.target[name]);
    p.val.textContent = (now === to ? to : `${now} → ${to}`) + (name in s.overrides ? ' pinned' : '');
  }
}
$('advanced').addEventListener('toggle', showParams);
setInterval(() => {
  if (document.hidden) return;
  showParams();
  if (engine.state.running && engine.state.audio === 'suspended') showNow();
}, 500);

sync();
showNow();
