import { compute } from './compute';
import { PACKAGED_COMPUTATION_EVALUATORS } from './evaluators';
import { recordOf } from './record.testing';
import { MAX_DEPTH, type ComputationContext, type ComputationEvaluator } from './types';

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

  it('is the ISO 8601 text of a Date, as a form’s date picker may hold one', () => {
    const context = recordOf({ 'member:birthDate': new Date('1990-11-24T00:00:00.000Z') });
    expect(compute(valueOf({ field: 'member:birthDate' }), context)).toEqual({
      ok: true,
      value: '1990-11-24T00:00:00.000Z',
    });
    expect(compute(age, context)).toEqual({ ok: true, value: 35 });
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
