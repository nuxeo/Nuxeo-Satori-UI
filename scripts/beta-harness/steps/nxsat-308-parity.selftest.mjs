#!/usr/bin/env node
/**
 * Controls for the permissions-save verdict in `nxsat-308-parity.mjs` step 11.
 *
 * `CLAUDE.md`: *a gate is not evidence until you have seen it fail on purpose.* The check
 * "parity-user's AddChildren survives the save" was green on the nxs surface while nothing was
 * ever saved — the option filter `/^\s*Everything\s*$/` matched no option (our label is "Manage
 * everything"), so no change was staged, no Save appeared, and the entry survived because the ACL
 * was never touched. A check that passes hardest when its subject does not happen is not evidence.
 *
 * These controls run the real `aclSaveVerdict` in process against the observations each situation
 * produces, and assert the verdict against the predicate the step used to carry
 * (`afterAcl.includes('parity-user:AddChildren')` on its own), so the difference is shown rather
 * than described. Control 1 is the one that matters: it is the situation on disk today, and it
 * must go from green under the old predicate to red under the new one.
 *
 * Control 4 is the inversion a previous proposal would have introduced — counting the Save control
 * *after* clicking it. On the happy path the button is gone by then, so that count is zero and the
 * verdict would be red exactly when the save worked. It is kept here so the mistake cannot be made
 * again without a red.
 *
 * The second group checks the root cause itself: the filter against the labels each surface
 * actually renders, read from `permissions.right.*` in `apps/nuxeo-ui/public/i18n/en.json` and
 * from upstream's own vocabulary. It does not prove the option list contains them — only a real
 * run against the panel can — but it does prove the pattern admits both and that the one it
 * replaced admitted neither of ours.
 *
 * Usage:  node scripts/beta-harness/steps/nxsat-308-parity.selftest.mjs
 */

import { aclSaveVerdict, PERMISSION_OPTION } from './nxsat-308-parity.mjs';

/** The predicate step 11 carried before this change, for the comparison controls 1 and 2 make. */
const oldPredicate = ({ afterAcl }) => afterAcl.includes('parity-user:AddChildren');

const POST = [{ method: 'POST', url: '/nuxeo/api/v1/automation/Document.ReplacePermission' }];
/** A write in the same window that is not the save — an unrelated one must not stand in for it. */
const UNRELATED_POST = [
  { method: 'POST', url: '/nuxeo/api/v1/automation/Document.AddToFavorites' },
];
const SEEDED_ACL = ['parity-user:AddChildren', 'members:ReadWrite'];
const SAVED_ACL = ['parity-user:AddChildren', 'members:Everything'];

const CONTROLS = [
  {
    name: '1. nothing matched the option filter, so nothing was staged and nothing saved',
    why: 'the state on disk today: the old predicate passes here, which is the defect',
    observed: { everythingOffered: 0, saveOffered: 0, writes: [], afterAcl: SEEDED_ACL },
    attempted: false,
    survives: false,
    oldVerdict: true,
  },
  {
    name: '2. the option was chosen, the save landed, and AddChildren is still there',
    why: 'the happy path — the only situation in which the claim may be made',
    observed: {
      everythingOffered: 1,
      saveOffered: 1,
      writes: POST,
      afterAcl: SAVED_ACL,
    },
    attempted: true,
    survives: true,
    oldVerdict: true,
  },
  {
    name: '3. the save landed and dropped the AddChildren entry',
    why: 'the defect the check exists to catch; it must still be caught',
    observed: {
      everythingOffered: 1,
      saveOffered: 1,
      writes: POST,
      afterAcl: ['members:Everything'],
    },
    attempted: true,
    survives: false,
    oldVerdict: false,
  },
  {
    name: '4. a save that landed, counted after the click so the button had gone',
    why: 'the inversion a previous proposal would have introduced: red exactly when the save worked',
    observed: { everythingOffered: 1, saveOffered: 0, writes: POST, afterAcl: SAVED_ACL },
    attempted: false,
    survives: false,
    oldVerdict: true,
  },
  {
    name: '5. a change was staged but no request ever reached the server',
    why: 'a click that did not land must not be read as a save',
    observed: { everythingOffered: 1, saveOffered: 1, writes: [], afterAcl: SEEDED_ACL },
    attempted: false,
    survives: false,
    oldVerdict: true,
  },
  {
    name: '6. a change was staged and the only write in the window was an unrelated one',
    why: 'the request window opens before the control is touched; a stray write must not stand in for the save',
    observed: {
      everythingOffered: 1,
      saveOffered: 1,
      writes: UNRELATED_POST,
      afterAcl: SEEDED_ACL,
    },
    attempted: false,
    survives: false,
    oldVerdict: true,
  },
];

const failures = [];
console.log('aclSaveVerdict controls\n');
for (const control of CONTROLS) {
  const verdict = aclSaveVerdict(control.observed);
  const old = oldPredicate(control.observed);
  const ok =
    verdict.attempted === control.attempted &&
    verdict.survives === control.survives &&
    old === control.oldVerdict;
  const colour = (value) => (value ? 'GREEN' : 'RED');
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${control.name}`);
  console.log(`       ${control.why}`);
  console.log(
    `       "AddChildren survives the save": was ${colour(old)}, now ${colour(verdict.survives)}` +
      ` (a save was attempted: ${verdict.attempted})`,
  );
  if (!ok) {
    failures.push(
      `${control.name} — expected attempted=${control.attempted} survives=${control.survives}` +
        ` old=${control.oldVerdict}, got attempted=${verdict.attempted}` +
        ` survives=${verdict.survives} old=${old}`,
    );
  }
}

/** The pattern step 11 filtered the option list with before this change. */
const OLD_EVERYTHING_FILTER = /^\s*Everything\s*$/;

/** `[label, matchedByTheNewPattern, matchedByTheOldOne]` — our labels first, then upstream's. */
const LABELS = [
  ['Manage everything', true, false],
  ['Everything', true, true],
  ['Edit', false, false],
  ['Read', false, false],
  ['Manage everything else', false, false],
];

console.log('\nPERMISSION_OPTION.Everything against the labels each surface renders\n');
for (const [label, expected, expectedOld] of LABELS) {
  const matched = PERMISSION_OPTION.Everything.test(label);
  const old = OLD_EVERYTHING_FILTER.test(label);
  const ok = matched === expected && old === expectedOld;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${JSON.stringify(label)}: now ${matched ? 'matches' : 'does not match'},` +
      ` ${OLD_EVERYTHING_FILTER} ${old ? 'matched' : 'did not match'}`,
  );
  if (!ok) {
    failures.push(
      `option filter on ${JSON.stringify(label)} — expected now=${expected} old=${expectedOld},` +
        ` got now=${matched} old=${old}`,
    );
  }
}

const flipped = CONTROLS.filter((c) => c.oldVerdict && !c.survives).length;
console.log();
const total = CONTROLS.length + LABELS.length;
if (failures.length === 0) {
  console.log(
    `nxsat-308-parity selftest: pass — ${CONTROLS.length} verdict control(s) and ${LABELS.length}` +
      ` option-label control(s); ${flipped} verdict control(s) passed the old predicate while no` +
      ` save had happened.`,
  );
  process.exit(0);
}
console.error(
  `nxsat-308-parity selftest: FAIL — ${failures.length} of ${total} control(s) did not behave as specified:`,
);
for (const f of failures) console.error(`  - ${f}`);
process.exit(1);
