import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditPath } from './sanitizer-path.mjs';

test('native Windows paths match allowlist keys without changing filesystem paths', () => {
  const native = 'libs\\shared\\nuxeo-client\\src\\lib\\utils\\trust-object-url.ts';
  const canonical = 'libs/shared/nuxeo-client/src/lib/utils/trust-object-url.ts';
  const allowlist = new Map([[`${canonical}::trustObjectUrl`, true]]);
  assert.equal(allowlist.get(`${auditPath(native)}::trustObjectUrl`), true);
  assert.equal(auditPath(canonical), canonical);
  assert.ok(native.includes('\\'));
});

test('TypeScript declaration sites tolerate mixed Windows root separators and respect boundaries', () => {
  assert.equal(auditPath('C:/repo/libs/helper.ts', 'C:\\repo'), 'libs/helper.ts');
  assert.equal(auditPath('C:\\repo\\libs\\helper.ts', 'C:/repo'), 'libs/helper.ts');
  assert.equal(auditPath('C:/repository/helper.ts', 'C:\\repo'), 'C:/repository/helper.ts');
});
