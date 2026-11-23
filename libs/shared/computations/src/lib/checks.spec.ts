import { PACKAGED_CHECKS } from '@agentic-ui/shared/app-definition';
import { PACKAGED_CHECK_EVALUATORS, runCheck } from './checks';
import { evaluateValue } from './compute';
import { recordOf } from './record.testing';
import type { ComputationContext } from './types';

const notBefore = (other: unknown) => ({ type: 'core.notBefore', parameters: [other] });
const atMost = (other: unknown) => ({ type: 'core.atMost', parameters: [other] });

describe('the check evaluators and the registered checks', () => {
  it('have the same IDs, both ways', () => {
    expect(Object.keys(PACKAGED_CHECK_EVALUATORS).sort()).toEqual(
      Object.keys(PACKAGED_CHECKS).sort(),
    );
    expect(Object.keys(PACKAGED_CHECK_EVALUATORS).sort()).toEqual([
      'core.atMost',
      'core.notBefore',
    ]);
  });

  it('take the one parameter each signature gives', () => {
    for (const id of Object.keys(PACKAGED_CHECKS))
      expect(PACKAGED_CHECKS[id], id).toEqual({ parameters: ['value'] });
  });

  it('are frozen, so a page cannot register a check by writing to them', () => {
    expect(Object.isFrozen(PACKAGED_CHECK_EVALUATORS)).toBe(true);
  });
});

describe('core.notBefore', () => {
  const end = (value: unknown, start: unknown = '2026-03-10') =>
    runCheck(
      notBefore({ field: 'claim:start' }),
      'claim:end',
      recordOf({ 'claim:end': value, 'claim:start': start }),
    );

  it('passes an end after the start, or on the same day, and fails one before it', () => {
    expect(end('2026-03-11')).toEqual({ ok: true, value: true });
    expect(end('2026-03-10')).toEqual({ ok: true, value: true });
    expect(end('2026-03-09')).toEqual({ ok: true, value: false });
  });

  it('compares days, so a stored day and an instant later that day are the same day', () => {
    // A stored day is its UTC day; the start, written as Nuxeo stores a day-only write.
    expect(end('2026-03-10', '2026-03-10T00:00:00.000Z')).toEqual({ ok: true, value: true });
    expect(end('2026-03-09T00:00:00.000Z', '2026-03-10T00:00:00.000Z')).toEqual({
      ok: true,
      value: false,
    });
  });

  it('reads a picked day, a Date, as the day it names', () => {
    expect(end(new Date(2026, 2, 9))).toEqual({ ok: true, value: false });
    expect(end(new Date(2026, 2, 10))).toEqual({ ok: true, value: true });
  });

  it('takes a literal bound', () => {
    const result = runCheck(
      notBefore('2026-01-01'),
      'claim:end',
      recordOf({ 'claim:end': '2025-12-31' }),
    );
    expect(result).toEqual({ ok: true, value: false });
  });

  it('passes when either side is empty: that is required’s to refuse', () => {
    expect(end(null)).toEqual({ ok: true, value: true });
    expect(end(undefined)).toEqual({ ok: true, value: true });
    expect(end('')).toEqual({ ok: true, value: true });
    expect(end('2026-03-09', null)).toEqual({ ok: true, value: true });
  });

  it('refuses a value that is not a date, on either side, naming it', () => {
    expect(end('soon')).toEqual({ ok: false, reason: 'core.notBefore compares dates, not "soon"' });
    expect(end('2026-03-09', 12)).toEqual({
      ok: false,
      reason: 'core.notBefore compares dates, not 12',
    });
    // A day that does not exist is not a date, as src/lib/dates.ts reads one.
    expect(end('2023-02-29')).toEqual({
      ok: false,
      reason: 'core.notBefore compares dates, not "2023-02-29"',
    });
  });
});

describe('core.atMost', () => {
  const allowed = (value: unknown, billed: unknown = 1200) =>
    runCheck(
      atMost({ field: 'claim:billed' }),
      'var:allowed',
      recordOf({ 'var:allowed': value, 'claim:billed': billed }),
    );

  it('passes a number up to the bound, and fails one above it', () => {
    expect(allowed(1000)).toEqual({ ok: true, value: true });
    expect(allowed(1200)).toEqual({ ok: true, value: true });
    expect(allowed(1200.01)).toEqual({ ok: true, value: false });
  });

  it('reads a number written as text, as a stored value may be', () => {
    expect(allowed('1300', '1200.0')).toEqual({ ok: true, value: false });
  });

  it('passes when either side is empty', () => {
    expect(allowed(null)).toEqual({ ok: true, value: true });
    expect(allowed(1300, null)).toEqual({ ok: true, value: true });
  });

  it('refuses a value that is not a number, on either side', () => {
    expect(allowed('lots')).toEqual({
      ok: false,
      reason: 'core.atMost compares numbers, not "lots"',
    });
    expect(allowed(5, true)).toEqual({
      ok: false,
      reason: 'core.atMost compares numbers, not true',
    });
  });

  it('takes a computation as its bound', () => {
    const half = {
      computed: { type: 'core.sum', parameters: [{ field: 'claim:lines' }, 'amount'] },
    };
    const context = recordOf({
      'var:allowed': 70,
      'claim:lines': [{ amount: 40 }, { amount: 20 }],
    });
    expect(runCheck(atMost(half), 'var:allowed', context)).toEqual({ ok: true, value: false });
  });
});

describe('runCheck', () => {
  const context = recordOf({ 'claim:end': '2026-03-09' });

  it('refuses what is not a check', () => {
    for (const check of [null, 'core.atMost', { parameters: [1] }, { type: 3 }])
      expect(runCheck(check, 'claim:end', context)).toEqual({
        ok: false,
        reason: 'a check is { "type": <ID>, "parameters": [...] }',
      });
  });

  it('refuses a check this build does not register, an inherited name included', () => {
    expect(runCheck({ type: 'acme.check', parameters: [1] }, 'claim:end', context)).toEqual({
      ok: false,
      reason: 'the check "acme.check" is not registered',
    });
    expect(runCheck({ type: 'constructor', parameters: [1] }, 'claim:end', context)).toEqual({
      ok: false,
      reason: 'the check "constructor" is not registered',
    });
  });

  it('refuses any number of parameters but one, and parameters that are not a list', () => {
    expect(runCheck({ type: 'core.atMost' }, 'claim:end', context)).toEqual({
      ok: false,
      reason: 'the check "core.atMost" takes one parameter, not []',
    });
    expect(runCheck({ type: 'core.atMost', parameters: [1, 2] }, 'claim:end', context)).toEqual({
      ok: false,
      reason: 'the check "core.atMost" takes one parameter, not [1,2]',
    });
    expect(runCheck({ type: 'core.atMost', parameters: null }, 'claim:end', context)).toEqual({
      ok: false,
      reason: 'the check "core.atMost" takes one parameter, not null',
    });
  });

  it('passes on why a value could not be evaluated', () => {
    const result = runCheck(notBefore({ computed: { type: 'acme.nope' } }), 'claim:end', context);
    expect(result).toEqual({ ok: false, reason: 'the computation "acme.nope" is not registered' });
  });

  it('refuses a check whose evaluator throws, and never throws itself', () => {
    const throwing = {
      'acme.throws': () => {
        throw new Error('boom');
      },
    };
    expect(
      runCheck({ type: 'acme.throws', parameters: [1] }, 'claim:end', context, throwing),
    ).toEqual({
      ok: false,
      reason: 'the check "acme.throws" failed: boom',
    });
  });
});

describe('evaluateValue', () => {
  it('evaluates a literal, a property and a computation as a parameter is', () => {
    const context = recordOf({ 'claim:lines': [1, 2, 3], 'claim:end': '2026-03-09' });
    expect(evaluateValue(5, context)).toEqual({ ok: true, value: 5 });
    expect(evaluateValue({ field: 'claim:end' }, context)).toEqual({
      ok: true,
      value: '2026-03-09',
    });
    expect(
      evaluateValue(
        { computed: { type: 'core.count', parameters: [{ field: 'claim:lines' }] } },
        context,
      ),
    ).toEqual({ ok: true, value: 3 });
  });

  it('never throws: a context whose value throws is refused with what it threw', () => {
    const context: ComputationContext = {
      ...recordOf({}),
      value: () => {
        throw new Error('no access');
      },
    };
    expect(evaluateValue({ field: 'claim:end' }, context)).toEqual({
      ok: false,
      reason: 'the value could not be read: no access',
    });
  });
});
