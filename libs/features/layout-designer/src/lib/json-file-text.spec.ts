/**
 * The designer's JSON writer, held to the repository's Prettier itself: for any value, what it
 * writes is what `prettier.format(JSON.stringify(value), …)` writes with `.prettierrc` as it is.
 * Held on every JSON file of every kit's app definition, on a corpus of generated values, and on
 * the cases the layout turns on, each named.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as prettier from 'prettier';

import { jsonFileText } from './json-file-text';
import { kitText, kits, REPOSITORY } from './kit-files.testing';

/** Prettier's layout of `value`, as the repository formats a JSON file of the designer's. */
async function prettierOf(value: unknown): Promise<string> {
  const filepath = join(REPOSITORY, 'business-apps/packages/any/queues/any.json');
  const config = await prettier.resolveConfig(filepath);
  return prettier.format(JSON.stringify(value), { ...config, filepath });
}

/** Every JSON file of a kit's app definition, its labels and actions included, by path. */
function definitionFiles(): [string, string][] {
  const walk = (kit: string, folder: string): [string, string][] =>
    readdirSync(join(REPOSITORY, 'business-apps/packages', kit, folder), {
      withFileTypes: true,
    }).flatMap((entry): [string, string][] => {
      const path = `${folder}/${entry.name}`;
      if (entry.isDirectory()) return walk(kit, path);
      const text = entry.name.endsWith('.json') ? kitText(kit, path) : null;
      return text === null ? [] : [[`${kit}/${path}`, text]];
    });
  return kits().flatMap((kit) => walk(kit, 'bundle/agentic-ui-config'));
}

/** A value of every kind JSON has, from a seed, deep and wide enough to break lines of each kind. */
function corpus(count: number, seed: number): unknown[] {
  let state = seed;
  const random = (): number => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)];
  const CHARACTERS = [...'abcdefghij klmnop:._-', 'é', '漢', 'Ａ', '한', 'ع', 'ẞ', '"', '\\', '\n'];
  const text = (most: number): string =>
    Array.from({ length: Math.floor(random() * most) }, () => pick(CHARACTERS)).join('');
  const KEYS = ['field', 'widget', 'labelKey', 'parameters', 'id', 'type', 'x'.repeat(30), '2'];
  const number = (): number =>
    pick([
      () => Math.floor(random() * 100),
      () => Math.floor(random() * 1e6) - 5e5,
      () => random() * 10,
      () => 1e21 * random(),
      () => 1e-7 * random(),
    ])();
  const value = (depth: number): unknown => {
    const kind = random();
    if (depth > 4 || kind < 0.3)
      return pick([() => text(40), number, () => random() < 0.5, () => null])();
    if (kind < 0.45) return Array.from({ length: Math.floor(random() * 30) }, number);
    if (kind < 0.7) return Array.from({ length: Math.floor(random() * 5) }, () => value(depth + 1));
    const object: Record<string, unknown> = {};
    for (let keys = Math.floor(random() * 6); keys > 0; keys--)
      object[pick(KEYS) + (random() < 0.3 ? text(8) : '')] = value(depth + 1);
    return object;
  };
  return Array.from({ length: count }, () => value(0));
}

describe('jsonFileText', () => {
  it.each(definitionFiles())("writes %s as the repository's Prettier does", async (_, text) => {
    const value: unknown = JSON.parse(text);
    expect(jsonFileText(value)).toBe(await prettierOf(value));
  });

  it("writes 1500 generated values as the repository's Prettier does", async () => {
    const differ: string[] = [];
    for (const value of corpus(1500, 6)) {
      if (jsonFileText(value) !== (await prettierOf(value))) differ.push(JSON.stringify(value));
    }
    expect(differ).toEqual([]);
  });

  describe('the cases its layout turns on', () => {
    it.each<[string, unknown]>([
      ['a short file, on one line', { version: 2, cards: [] }],
      ['an empty object and list', { a: {}, b: [] }],
      ['a line of exactly 100 columns', { a: 'x'.repeat(91) }],
      ['a line of 101 columns', { a: 'x'.repeat(92) }],
      ['a value whose comma takes it over', { a: ['y'.repeat(92)], b: 1 }],
      ['a long text, never split', { label: 'x'.repeat(150) }],
      [
        'two objects of two keys each, one a line whatever the width',
        [
          { a: 1, b: 2 },
          { a: 1, b: 2 },
        ],
      ],
      ['an object of one key among them, all on a line', [{ a: 1 }, { a: 1, b: 2 }]],
      [
        'two lists of two, one a line, and what holds them',
        {
          x: [
            [1, 2],
            [3, 4],
          ],
        },
      ],
      [
        'numbers filled as many on a line as fit',
        { list: Array.from({ length: 40 }, (_, i) => i * 1000) },
      ],
      ['numbers as Prettier prints them', { a: 1e21, b: 1.5e-7, c: -0.5, d: 100000 }],
      ['texts JSON escapes', { a: 'a "quoted" \\ back\nslash\u0007' }],
      ['wide characters, two columns each', { label: '漢'.repeat(46), b: 1 }],
      ['keys in the order they were written', { z: 1, a: 2, m: { y: 1, b: 2 } }],
      ['a key whose value is undefined, left out as JSON leaves it', { a: 1, b: undefined }],
    ])('%s', async (_, value) => {
      expect(jsonFileText(value)).toBe(await prettierOf(value));
    });

    it('ends the file with one newline, and writes what JSON.stringify writes', () => {
      expect(jsonFileText({ a: 1 })).toBe('{ "a": 1 }\n');
      expect(JSON.parse(jsonFileText({ a: [1, { b: 'c' }] }))).toEqual({ a: [1, { b: 'c' }] });
    });
  });
});
