import { AXIS_MAP, AXIS_NAMES, HOME_AXES, PARAMS, PARAM_NAMES } from './params.js';
import { getMood, moodNames, moodParams } from './moods.js';

const n = (v: number): string => (Math.abs(v) >= 10 ? String(Math.round(v)) : String(Math.round(v * 100) / 100));
const signed = (v: number): string => (v > 0 ? '+' : v < 0 ? '−' : '') + n(Math.abs(v));

/** The axes-to-parameters table as Markdown, made from the same data the engine uses. */
export function axesTable(): string {
  const head = ['parameter', 'base', ...AXIS_NAMES.map((a) => `${a} 0 … 1 (home ${HOME_AXES[a]})`)];
  const rows = PARAM_NAMES.map((k) => [
    '`' + k + '`',
    n(PARAMS[k].base),
    ...AXIS_NAMES.map((a) => {
      const pair = AXIS_MAP[a][k];
      return pair ? `${signed(pair[0])} … ${signed(pair[1])}` : '';
    }),
  ]);
  return [head, head.map(() => '---'), ...rows].map((r) => '| ' + r.join(' | ') + ' |').join('\n');
}

/** Each mood's axes, what it pins, and the low-level parameters it comes to, as Markdown. */
export function moodsTable(): string {
  const head = ['mood', ...AXIS_NAMES, 'pins', 'what it is'];
  const rows = moodNames().map((name) => {
    const def = getMood(name)!;
    const pins = Object.entries(def.params ?? {}).map(([k, v]) => `${k} ${n(v)}`).join(', ');
    return ['`' + name + '`', ...AXIS_NAMES.map((a) => n(def.axes[a])), pins, def.description];
  });
  return [head, head.map(() => '---'), ...rows].map((r) => '| ' + r.join(' | ') + ' |').join('\n');
}

/** Every low-level parameter each mood resolves to, as Markdown. */
export function moodParamsTable(): string {
  const names = moodNames();
  const head = ['parameter', ...names];
  const rows = PARAM_NAMES.map((k) => ['`' + k + '`', ...names.map((m) => n(moodParams(m)![k]))]);
  return [head, head.map(() => '---'), ...rows].map((r) => '| ' + r.join(' | ') + ' |').join('\n');
}

/** One line of documentation for each parameter, as Markdown. */
export function paramsTable(): string {
  const head = ['parameter', 'range', 'base', 'what it does'];
  const rows = PARAM_NAMES.map((k) => ['`' + k + '`', `${PARAMS[k].min} … ${PARAMS[k].max}${'unit' in PARAMS[k] ? ' bpm' : ''}`, n(PARAMS[k].base), PARAMS[k].doc]);
  return [head, head.map(() => '---'), ...rows].map((r) => '| ' + r.join(' | ') + ' |').join('\n');
}

