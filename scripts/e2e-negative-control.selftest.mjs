import assert from 'node:assert/strict';
import { test } from 'node:test';
import { minimumFailures, classifyFailures } from './e2e-negative-control.mjs';

test('a threshold cannot make the negative control unconditional', () => {
  assert.equal(minimumFailures(), 5);
  assert.equal(minimumFailures('7'), 7);
  for (const invalid of ['0', '-1', '', 'abc', '1.5', '9007199254740992'])
    assert.throws(() => minimumFailures(invalid));
});

test('setup failures never contribute to assertion sensitivity', () => {
  const report = {
    specs: [
      { title: 'real expect', failedAtAssertion: true },
      { title: 'setup', failedAtAssertion: false },
      { title: 'navigation' },
    ],
  };
  assert.deepEqual(
    classifyFailures(report).atAssertion.map((spec) => spec.title),
    ['real expect'],
  );
  assert.equal(classifyFailures(report).beforeAssertion.length, 2);
  assert.throws(() => classifyFailures({}), /no specs array/);
});
