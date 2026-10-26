import { filterEnabled, sortByOrder } from './extension-element';

/**
 * Parity with `@alfresco/adf-extensions@9.0.0`.
 *
 * Every expected value below is the output upstream produced for that input. The table ran
 * against upstream as well as ours until the dependency was dropped (NXSAT-308, commit
 * `dae2336ec`), so the values are frozen upstream output, not expectations written from intuition.
 */
type Entry = { readonly id: string; readonly disabled?: boolean; readonly order?: number };

/** For values a JSON manifest can hold and the descriptor type does not admit. */
const loose = (value: Record<string, unknown>): Entry => value as unknown as Entry;

describe('filterEnabled', () => {
  it.each([
    ['absent', loose({}), true],
    ['true', loose({ disabled: true }), false],
    ['false', loose({ disabled: false }), true],
    ['undefined', loose({ disabled: undefined }), true],
    ['null', loose({ disabled: null }), true],
    ['the string "false", which is truthy', loose({ disabled: 'false' }), false],
    ['the string "true"', loose({ disabled: 'true' }), false],
    ['an empty string', loose({ disabled: '' }), true],
    ['0', loose({ disabled: 0 }), true],
    ['1', loose({ disabled: 1 }), false],
    ['NaN', loose({ disabled: Number.NaN }), true],
    ['an empty object', loose({ disabled: {} }), false],
    ['an empty array', loose({ disabled: [] }), false],
  ])('disabled: %s, kept: %s', (_label, entry, kept) => {
    expect(filterEnabled(entry)).toBe(kept);
  });
});

describe('sortByOrder', () => {
  const MAX = Number.MAX_SAFE_INTEGER;

  it.each([
    ['lower first', loose({ order: 1 }), loose({ order: 2 }), -1],
    ['higher second', loose({ order: 2 }), loose({ order: 1 }), 1],
    ['equal', loose({ order: 5 }), loose({ order: 5 }), 0],
    ['negative', loose({ order: -10 }), loose({ order: 0 }), -10],
    ['absent against a number', loose({}), loose({ order: 5 }), MAX - 5],
    ['a number against absent', loose({ order: 5 }), loose({}), 5 - MAX],
    ['absent against absent', loose({}), loose({}), 0],
    ['explicit undefined is absent', loose({ order: undefined }), loose({}), 0],
    ['null is 0, not absent', loose({ order: null }), loose({ order: 5 }), -5],
    ['null against absent', loose({ order: null }), loose({}), -MAX],
    ['a numeric string is its number', loose({ order: '7' }), loose({ order: 5 }), 2],
    ['MAX_SAFE_INTEGER ties with absent', loose({ order: MAX }), loose({}), 0],
    ['Infinity sorts after absent', loose({ order: Infinity }), loose({}), Infinity],
    ['-Infinity', loose({ order: -Infinity }), loose({ order: 0 }), -Infinity],
    ['NaN compares as NaN', loose({ order: Number.NaN }), loose({ order: 1 }), Number.NaN],
    [
      'a non-numeric string compares as NaN',
      loose({ order: 'x' }),
      loose({ order: 1 }),
      Number.NaN,
    ],
  ])('%s', (_label, a, b, expected) => {
    expect(Object.is(sortByOrder(a, b), expected)).toBe(true);
  });

  it('sorts ascending, absent as MAX_SAFE_INTEGER (tied with it, before Infinity), ties stable', () => {
    const entries = [
      loose({ id: 'absent-1' }),
      loose({ id: 'twenty', order: 20 }),
      loose({ id: 'ten-a', order: 10 }),
      loose({ id: 'null', order: null }),
      loose({ id: 'absent-2' }),
      loose({ id: 'ten-b', order: 10 }),
      loose({ id: 'negative', order: -5 }),
      loose({ id: 'string-15', order: '15' }),
      loose({ id: 'max-safe', order: MAX }),
      loose({ id: 'infinity', order: Infinity }),
      loose({ id: 'zero', order: 0 }),
    ];

    expect([...entries].sort(sortByOrder).map((entry) => entry.id)).toEqual([
      'negative',
      'null',
      'zero',
      'ten-a',
      'ten-b',
      'string-15',
      'twenty',
      'absent-1',
      'absent-2',
      'max-safe',
      'infinity',
    ]);
  });

  it('keeps registration order among many equal keys', () => {
    // Long enough that V8's TimSort merges runs instead of insertion-sorting the whole array.
    const entries = Array.from({ length: 200 }, (_, i) =>
      loose({ id: `e${i}`, ...(i % 3 === 0 ? {} : { order: i % 2 }) }),
    );
    const ids = (predicate: (entry: Entry) => boolean) =>
      entries.filter(predicate).map((entry) => entry.id);

    expect([...entries].sort(sortByOrder).map((entry) => entry.id)).toEqual([
      ...ids((entry) => entry.order === 0),
      ...ids((entry) => entry.order === 1),
      ...ids((entry) => entry.order === undefined),
    ]);
  });
});
