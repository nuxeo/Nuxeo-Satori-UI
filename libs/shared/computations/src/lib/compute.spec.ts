import { compute } from './compute';
import { PACKAGED_COMPUTATION_EVALUATORS } from './evaluators';
import { recordOf } from './record.testing';
import {
  MAX_DEPTH,
  type ComputationContext,
  type ComputationEvaluator,
  type ComputationResult,
} from './types';

const record = recordOf({
  'member:birthDate': '1990-11-23T00:00:00.000Z',
  'claim:lines': [{ amount: 10 }, { amount: 2.5 }],
  'dc:subjects': ['art', 'law'],
  'dc:title': 'A title',
});

const age = { type: 'core.age', parameters: [{ field: 'member:birthDate' }] };
/** `core.choose` with a rule that passes, so the value is `parameter`'s. */
const valueOf = (parameter: unknown) => ({
  type: 'core.choose',
  parameters: [true, parameter, 'otherwise'],
});

describe('compute: the computation as a layout writes it', () => {
  it('evaluates a registered computation', () => {
    expect(compute(age, record)).toEqual({ ok: true, value: 36 });
  });

  it.each([
    ['null', null],
    ['a text', 'core.age'],
    ['a list', [age]],
    ['an object with no type', { parameters: [] }],
    ['a type that is not a text', { type: 3, parameters: [] }],
  ])('refuses %s', (_what, computation) => {
    expect(compute(computation, record)).toEqual({
      ok: false,
      reason: 'a computation is { "type": <ID>, "parameters": [...] }',
    });
  });

  it('refuses a type nobody registered, naming it', () => {
    expect(compute({ type: 'core.median', parameters: [] }, record)).toEqual({
      ok: false,
      reason: 'the computation "core.median" is not registered',
    });
  });

  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])(
    'does not take %s, an Object property, for a registered computation',
    (type) => {
      expect(compute({ type, parameters: [] }, record)).toEqual({
        ok: false,
        reason: `the computation "${type}" is not registered`,
      });
    },
  );

  it('refuses a key a computation does not have, rather than ignore what it might mean', () => {
    expect(compute({ ...age, format: 'short' }, record)).toEqual({
      ok: false,
      reason: 'the computation "core.age" has a key a computation does not have: "format"',
    });
  });

  it.each([
    ['null, which is malformed, not absent', null],
    ['a text', 'member:birthDate'],
    ['an object', { 0: { field: 'member:birthDate' } }],
  ])('refuses parameters written as %s', (_what, parameters) => {
    expect(compute({ type: 'core.age', parameters }, record)).toEqual({
      ok: false,
      reason: 'the computation "core.age" has parameters that are not a list',
    });
  });

  it('reads absent parameters as none, which core.age refuses by number', () => {
    expect(compute({ type: 'core.age' }, record)).toEqual({
      ok: false,
      reason: 'the computation "core.age" takes 1 parameter, not 0',
    });
  });
});

describe('compute: a parameter', () => {
  it.each([
    ['a text', 'text', 'text'],
    ['an empty text', '', ''],
    ['a number', 12.5, 12.5],
    ['a negative number', -3, -3],
    ['a boolean', false, false],
  ])('is %s, as written', (_what, parameter, expected) => {
    expect(compute(valueOf(parameter), record)).toEqual({ ok: true, value: expected });
  });

  it('is a property, through context.value', () => {
    const context = recordOf({ 'dc:title': 'A title' });
    expect(compute(valueOf({ field: 'dc:title' }), context)).toEqual({
      ok: true,
      value: 'A title',
    });
    expect(context.reads).toEqual(['dc:title']);
  });

  it('is null for a property the record does not have, or holds as null', () => {
    expect(compute(valueOf({ field: 'dc:nothing' }), record)).toEqual({ ok: true, value: null });
    expect(compute(valueOf({ field: 'dc:title' }), recordOf({ 'dc:title': null }))).toEqual({
      ok: true,
      value: null,
    });
  });

  it('is a Date’s local day, as a form’s date picker holds one at local midnight', () => {
    // Local midnight on 24 November 1990 is 1990-11-23T18:30:00.000Z in Asia/Calcutta: its UTC
    // day is the 23rd, the day before the one picked.
    const picked = recordOf({ 'member:birthDate': new Date(1990, 10, 24) });
    expect(compute(valueOf({ field: 'member:birthDate' }), picked)).toEqual({
      ok: true,
      value: '1990-11-24',
    });
    expect(compute(age, picked)).toEqual({ ok: true, value: 35 });
    // 23:00 on 23 November 1990 is 1990-11-24T04:00:00.000Z in America/New_York: its UTC day is
    // the 24th, the day after.
    const late = recordOf({ 'member:birthDate': new Date(1990, 10, 23, 23, 0) });
    expect(compute(valueOf({ field: 'member:birthDate' }), late)).toEqual({
      ok: true,
      value: '1990-11-23',
    });
    expect(compute(age, late)).toEqual({ ok: true, value: 36 });
  });

  it('is a computation, evaluated one level deeper', () => {
    expect(compute(valueOf({ computed: age }), record)).toEqual({ ok: true, value: 36 });
  });

  it.each([
    ['a list', 'dc:subjects', '["art","law"]'],
    ['a complex value', 'claim:line', '{"amount":10}'],
    ['an invalid Date', 'member:birthDate', 'an invalid Date'],
    ['a number that is not finite', 'claim:amount', 'NaN'],
  ])('refuses a property that holds %s, which is not one value', (_what, field, quoted) => {
    const context = recordOf({
      'dc:subjects': ['art', 'law'],
      'claim:line': { amount: 10 },
      'member:birthDate': new Date('not a date'),
      'claim:amount': Number.NaN,
    });
    expect(compute(valueOf({ field }), context)).toEqual({
      ok: false,
      reason: `the property "${field}" holds ${quoted}, not a text, a number or a boolean`,
    });
  });

  it.each([
    ['null', null, 'null'],
    ['a list', ['a'], '["a"]'],
    ['a number that is not finite', Number.POSITIVE_INFINITY, 'Infinity'],
    ['NaN', Number.NaN, 'NaN'],
    ['a property that is not <prefix>:<name>', { field: 'title' }, '{"field":"title"}'],
    [
      'a property with another key',
      { field: 'dc:title', widget: 'text' },
      '{"field":"dc:title","widget":"text"}',
    ],
    ['a computation with another key', { computed: age, id: 'age' }, `{"computed":`],
    ['an object that is neither', { value: 1 }, '{"value":1}'],
  ])('refuses %s', (_what, parameter, quoted) => {
    const result = compute(valueOf(parameter), record);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain(
      'a parameter is a text, a number, a boolean, { "field": "<prefix>:<name>" } or { "computed": {...} }, not ',
    );
    expect(result.reason).toContain(quoted);
  });

  it('quotes at most 60 characters of what it refuses', () => {
    const long = 'x'.repeat(200);
    expect(compute(valueOf({ value: long }), record)).toEqual({
      ok: false,
      reason: `a parameter is a text, a number, a boolean, { "field": "<prefix>:<name>" } or { "computed": {...} }, not ${`{"value":"${long}"}`.slice(0, 60)}…`,
    });
  });

  it('passes a nested refusal up as it is, naming the computation that refused', () => {
    expect(compute(valueOf({ computed: { type: 'core.median' } }), record)).toEqual({
      ok: false,
      reason: 'the computation "core.median" is not registered',
    });
  });
});

describe('compute: bounded work', () => {
  /** `core.count` at depth 1, inside `depth - 1` computations. */
  const nested = (depth: number): unknown =>
    depth === 1
      ? { type: 'core.count', parameters: [{ field: 'dc:subjects' }] }
      : { type: 'core.choose', parameters: [true, { computed: nested(depth - 1) }, 0] };

  it(`evaluates computations nested ${MAX_DEPTH} deep`, () => {
    expect(MAX_DEPTH).toBe(10);
    expect(compute(nested(MAX_DEPTH), record)).toEqual({ ok: true, value: 2 });
  });

  it(`refuses one nested ${MAX_DEPTH + 1} deep, naming the computation past the cap`, () => {
    expect(compute(nested(MAX_DEPTH + 1), record)).toEqual({
      ok: false,
      reason: 'the computation "core.count" is nested more than 10 deep',
    });
  });

  it('refuses a deep nest without evaluating its way down a thousand levels', () => {
    const context = recordOf({ 'dc:subjects': [] });
    expect(compute(nested(1000), context)).toEqual({
      ok: false,
      reason: 'the computation "core.choose" is nested more than 10 deep',
    });
    expect(context.rules).toHaveLength(MAX_DEPTH);
    expect(context.reads).toEqual([]);
  });

  it('starts at depth 0 unless it is told otherwise', () => {
    expect(compute(nested(MAX_DEPTH), record, undefined, 0)).toEqual({ ok: true, value: 2 });
  });

  it('continues a count its caller started', () => {
    expect(compute(nested(1), record, undefined, MAX_DEPTH - 1)).toEqual({ ok: true, value: 2 });
    expect(compute(nested(1), record, undefined, MAX_DEPTH)).toEqual({
      ok: false,
      reason: 'the computation "core.count" is nested more than 10 deep',
    });
    expect(compute(nested(3), record, undefined, 8)).toEqual({
      ok: false,
      reason: 'the computation "core.count" is nested more than 10 deep',
    });
  });

  it.each([
    [-1, '-1'],
    [1.5, '1.5'],
    [Number.NaN, 'NaN'],
    [Number.POSITIVE_INFINITY, 'Infinity'],
  ])('refuses to start at the depth %s, which would let the cap pass anything', (depth, quoted) => {
    expect(compute(age, record, undefined, depth)).toEqual({
      ok: false,
      reason: `a computation starts at a whole depth of 0 or more, not ${quoted}`,
    });
  });

  it('gives each rule the depth of the computation that asks it', () => {
    const depths: (number | undefined)[] = [];
    const context: ComputationContext = {
      ...recordOf({ 'dc:subjects': [] }),
      rule: (_rule, depth) => {
        depths.push(depth);
        return true;
      },
    };
    compute(nested(3), context);
    compute(nested(2), context, undefined, 5);
    expect(depths).toEqual([1, 2, 6]);
  });

  it('counts through a rule that evaluates a computation and passes its depth on', () => {
    // As app.rules.fieldIn will, with a { "computed" } parameter: each level's rule holds the next
    // level's computation, so the chain nests only through rules.
    const chain = (levels: number): unknown =>
      levels === 1
        ? { type: 'core.count', parameters: [{ field: 'dc:subjects' }] }
        : {
            type: 'core.choose',
            parameters: [
              { type: 'test.fieldIn', parameters: [{ computed: chain(levels - 1) }] },
              'a',
              'b',
            ],
          };
    const inner: ComputationResult[] = [];
    const context: ComputationContext = {
      ...recordOf({ 'dc:subjects': ['art'] }),
      rule: (rule, depth) => {
        const [parameter] = (rule as { parameters: [{ computed: unknown }] }).parameters;
        inner.push(compute(parameter.computed, context, undefined, depth));
        return true;
      },
    };
    compute(chain(31), context);
    expect(inner).toHaveLength(MAX_DEPTH);
    // The deepest rule's computation returns first: the 11th level, refused unevaluated.
    expect(inner[0]).toEqual({
      ok: false,
      reason: 'the computation "core.choose" is nested more than 10 deep',
    });
  });
});

describe('compute: it never throws', () => {
  const throwing = (thrown: unknown): ComputationContext => ({
    ...record,
    value: () => {
      throw thrown;
    },
    display: () => {
      throw thrown;
    },
    rule: () => {
      throw thrown;
    },
  });

  it('refuses when the context’s value throws, naming the computation', () => {
    expect(compute(age, throwing(new Error('the record is gone')))).toEqual({
      ok: false,
      reason: 'the computation "core.age" failed: the record is gone',
    });
  });

  it('refuses when the context’s display or rule throws', () => {
    const context = { ...throwing(new Error('no label')), value: () => 'x' };
    expect(compute({ type: 'core.template', parameters: ['{dc:title}'] }, context)).toEqual({
      ok: false,
      reason: 'the computation "core.template" failed: no label',
    });
    expect(compute(valueOf(1), throwing(new Error('no groups')))).toEqual({
      ok: false,
      reason: 'the computation "core.choose" failed: no groups',
    });
  });

  it('refuses when an evaluator throws something that is not an Error', () => {
    const evaluators = {
      'acme.broken': () => {
        throw 'out of order';
      },
    };
    expect(compute({ type: 'acme.broken' }, record, evaluators)).toEqual({
      ok: false,
      reason: 'the computation "acme.broken" failed: "out of order"',
    });
  });
});

describe('compute: the evaluators it is given', () => {
  const double: ComputationEvaluator = ([parameter], _context, evaluate) => {
    const given = evaluate(parameter);
    if (!given.ok || typeof given.value !== 'number') return given;
    return { ok: true, value: given.value * 2 };
  };

  it('uses the packaged ones by default', () => {
    expect(compute(age, record, PACKAGED_COMPUTATION_EVALUATORS)).toEqual(compute(age, record));
  });

  it('runs a customer’s own computation, registered in Layer 2 code, beside them', () => {
    const evaluators = { ...PACKAGED_COMPUTATION_EVALUATORS, 'acme.double': double };
    expect(
      compute({ type: 'acme.double', parameters: [{ computed: age }] }, record, evaluators),
    ).toEqual({ ok: true, value: 72 });
  });

  it('knows only the ones it is given', () => {
    expect(compute(age, record, { 'acme.double': double })).toEqual({
      ok: false,
      reason: 'the computation "core.age" is not registered',
    });
  });

  it('keeps the packaged registry as it is', () => {
    expect(Object.isFrozen(PACKAGED_COMPUTATION_EVALUATORS)).toBe(true);
  });
});

describe('compute: a reason quotes at most 60 characters of anything a file holds', () => {
  const long = 'x'.repeat(505);
  /** `long` as a reason quotes it: its JSON, cut at 60 characters. */
  const quoted = `"${'x'.repeat(59)}…`;

  it('quotes a type nobody registered', () => {
    const result = compute({ type: long }, record);
    expect(result).toEqual({ ok: false, reason: `the computation ${quoted} is not registered` });
    // 541 characters before every value a reason names went through quote().
    expect(!result.ok && result.reason.length).toBe(95);
  });

  it('quotes a type nested past the cap', () => {
    const deep = (levels: number): unknown =>
      levels === 1
        ? { type: long }
        : { type: 'core.choose', parameters: [true, { computed: deep(levels - 1) }, 0] };
    expect(compute(deep(MAX_DEPTH + 1), record)).toEqual({
      ok: false,
      reason: `the computation ${quoted} is nested more than 10 deep`,
    });
  });

  it('quotes a key a computation does not have', () => {
    expect(compute({ ...age, [long]: 1 }, record)).toEqual({
      ok: false,
      reason: `the computation "core.age" has a key a computation does not have: ${quoted}`,
    });
  });

  it('quotes the type of a computation with no list of parameters, or that failed', () => {
    const evaluators = {
      [long]: () => {
        throw new Error('e'.repeat(300));
      },
    };
    expect(compute({ type: long, parameters: null }, record, evaluators)).toEqual({
      ok: false,
      reason: `the computation ${quoted} has parameters that are not a list`,
    });
    expect(compute({ type: long }, record, evaluators)).toEqual({
      ok: false,
      reason: `the computation ${quoted} failed: ${'e'.repeat(60)}…`,
    });
  });

  it('quotes a property', () => {
    const field = `dc:${'a'.repeat(300)}`;
    expect(compute(valueOf({ field }), recordOf({ [field]: [1] }))).toEqual({
      ok: false,
      reason: `the property "dc:${'a'.repeat(56)}… holds [1], not a text, a number or a boolean`,
    });
  });
});
