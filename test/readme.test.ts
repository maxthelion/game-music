import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { axesTable, moodParamsTable, moodsTable, paramsTable } from '../src/docs.js';

// The tables in the README are made from the code. `npm run docs:table` rewrites them;
// `npm test` fails if they have fallen out of step.
const file = new URL('../README.md', import.meta.url);
const tables: Record<string, () => string> = { params: paramsTable, axes: axesTable, moods: moodsTable, 'mood-params': moodParamsTable };

describe('README', () => {
  for (const [name, make] of Object.entries(tables)) {
    it(`has the ${name} table the code produces`, () => {
      const open = `<!-- table:${name} -->`;
      const close = `<!-- /table:${name} -->`;
      let text = readFileSync(file, 'utf8');
      const a = text.indexOf(open);
      const b = text.indexOf(close);
      expect(a, `marker ${open}`).toBeGreaterThan(-1);
      expect(b).toBeGreaterThan(a);
      if (process.env.UPDATE_README) {
        text = text.slice(0, a + open.length) + '\n' + make() + '\n' + text.slice(b);
        writeFileSync(file, text);
      }
      expect(text.slice(a + open.length, text.indexOf(close)).trim()).toBe(make());
    });
  }
});
