#!/usr/bin/env node
/**
 * Controls for `extension-reference-drift.mjs`.
 *
 * ## Why this file exists, stated bluntly
 *
 * This gate had **six** review findings against it on PR #544, across four rounds, and every one
 * was found by a human reading the diff. Three of them were the same shape — the gate printing
 * *"every slot-state claim holds"* while checking nothing — and each fix closed the reported case
 * and left an adjacent one open:
 *
 * 1. `tableAfter()` scanned past its own section, so deleting a table latched onto a later one.
 * 2. It then discarded the first two pipe lines as header-and-separator without checking, so
 *    deleting those two promoted the first two DATA rows into their place.
 * 3. `slotClaims()` parsed rows with `matchAll`, which silently skips what it cannot match, so
 *    stripping the slot-name backticks left thirteen rows, zero claims and zero findings.
 * 4. The element column accepted any selector that existed anywhere, not the registered one.
 * 5. `selectorOf()` resolved a class name globally, and `SearchComponent` is declared twice — so
 *    it rejected the correct row and would have accepted the wrong one.
 * 6. `TSCONFIG_PATHS` was read from inside its own temporal dead zone, crashing the gate on any
 *    row whose component is imported through a path alias.
 *
 * The reason all six were found by eye is that the gate could only be run against the repository
 * it lives in, and that repository is correct. There was nothing to run it *against*. `--root`
 * fixes that, and this file is what it is for: every one of the six is a control below, and each
 * is **shown failing against the gate as it stood before the corresponding fix** is not possible
 * here — the fixes are already in — so each instead drives a miniature repository that is wrong
 * in exactly that way and requires the gate to go red for the stated reason.
 *
 * ## Shape
 *
 * A fixture is a miniature repository under `os.tmpdir()`: `docs/extension-reference.md`, a
 * `libs/shared/extensions/src/lib/extension-slots.ts` declaring the slots, a
 * `tools/satori-generators/.../generator.ts` declaring the placeable slot names, a
 * `tsconfig.base.json`, and whatever `libs/`/`apps/` sources a control needs. Nothing tracked is
 * touched, so this is safe to run beside anything and cannot leave the tree dirty.
 *
 * Usage:  node scripts/beta-harness/extension-reference-drift.selftest.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const here = import.meta.dirname;
const GATE = join(here, 'extension-reference-drift.mjs');
const workspace = mkdtempSync(join(tmpdir(), 'reference-drift-selftest-'));

const controls = [];
/** A negative control requires the gate NOT to pass; a positive one requires a correct fixture to stay green. */
const NEGATIVE = { negative: true };
const POSITIVE = { negative: false };

function control(name, { negative }, fn) {
  try {
    fn();
    controls.push({ name, ok: true, negative });
  } catch (error) {
    controls.push({ name, ok: false, negative, why: error.message });
  }
}
/** A positive control stated as "this specific non-violation must NOT be flagged". */
function falsePositive(name, fn) {
  control(name, POSITIVE, fn);
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

/* ── the fixture repository ──────────────────────────────────────────────────────────────────── */

/** The thirteen slots, as `EXTENSION_SLOTS` declares them. */
const SLOTS = [
  'navbar',
  'sidebar',
  'routes',
  'toolbar',
  'contextMenu',
  'rowActions',
  'bulk-actions',
  'tabs',
  'documentList',
  'documentView',
  'documentMetadata',
  'documentEdit',
  'documentCreate',
];

/** The slot-state table of section 2, one row per declared slot, every claim classifiable. */
const slotTable = (rows = SLOTS.map((s) => [`\`${s}\``, 'what it addresses', 'Resolves'])) =>
  [
    '| Slot | What it addresses | Status in Beta |',
    '| ---- | ----------------- | -------------- |',
    ...rows.map((cells) => `| ${cells.join(' | ')} |`),
  ].join('\n');

/**
 * A reference document the gate accepts.
 *
 * Every slot claims "Resolves", so the source fixture must `resolve()` each one and register into
 * none — that is the combination the three state rules accept.
 */
const referenceDoc = ({ section2 = slotTable(), section6b = [] } = {}) =>
  `# Extension reference

## 2. Slots

A slot is a named, ordered list of descriptors.

${section2}

Read the three states precisely, because they are different promises.

## 6b. \`nxs-\` components registered for a slot

<!-- satori:register:nxs-components -->

| Component ID | Element | For the slot |
| ------------ | ------- | ------------ |
${section6b.map((r) => `| ${r.join(' | ')} |\n`).join('')}
## 7. Something else

Nothing here.
`;

/** Source that resolves every slot and registers into none, so every "Resolves" claim holds. */
const slotSources = () => ({
  'libs/shared/extensions/src/lib/extension-slots.ts':
    'export const EXTENSION_SLOTS = {\n' +
    SLOTS.map((s) => (/^[a-z][a-zA-Z]*$/.test(s) ? `  ${s}: '${s}',` : `  '${s}': '${s}',`)).join(
      '\n',
    ) +
    '\n} as const;\n',
  'libs/shared/extensions/src/lib/host.ts':
    "import { EXTENSION_SLOTS } from './extension-slots';\n" +
    SLOTS.map((s) =>
      /^[a-z][a-zA-Z]*$/.test(s)
        ? `export const r${s} = resolve(EXTENSION_SLOTS.${s});`
        : `export const rBulk = resolve(EXTENSION_SLOTS['${s}']);`,
    ).join('\n') +
    '\n',
  'tools/satori-generators/src/satori-component/generator.ts':
    "export type SatoriComponentSlot = 'sidebar' | 'tabs' | 'documentView' | 'routes';\n" +
    "const SLOTS: readonly SatoriComponentSlot[] = ['sidebar', 'tabs', 'documentView', 'routes'];\n" +
    'export default SLOTS;\n',
});

let fixtureCount = 0;
/** Writes a fixture repository and returns its root. */
function fixture({ doc = referenceDoc(), sources = {}, tsconfig } = {}) {
  const root = join(workspace, `fx-${(fixtureCount += 1)}`);
  const write = (rel, body) => {
    const path = join(root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body, 'utf8');
  };
  write('docs/extension-reference.md', doc);
  /* Both source roots always exist. A root the gate cannot list is a reported gap — which is a
   * defect these controls found on their first run — so a fixture must supply both or it is
   * exercising that gap instead of the thing under test. */
  mkdirSync(join(root, 'libs'), { recursive: true });
  mkdirSync(join(root, 'apps'), { recursive: true });
  for (const [rel, body] of Object.entries({ ...slotSources(), ...sources })) write(rel, body);
  write(
    'tsconfig.base.json',
    tsconfig ??
      JSON.stringify(
        { compilerOptions: { paths: { '@fx/components': ['libs/fx/src/index.ts'] } } },
        null,
        2,
      ),
  );
  return root;
}

function run(root) {
  const proc = spawnSync(process.execPath, [GATE, '--root', root], { encoding: 'utf8' });
  return { ...proc, output: `${proc.stdout ?? ''}${proc.stderr ?? ''}` };
}

/** Asserts the exit code and that the declaration agrees with it. */
function expectExit(proc, expected, { negative }) {
  const isPass = expected === 0;
  if (negative === isPass) {
    throw new Error(`declared ${negative ? 'negative' : 'positive'} but requires exit ${expected}`);
  }
  expect(
    proc.status === expected,
    `exited ${proc.status}, expected ${expected}:\n${proc.output.slice(-700)}`,
  );
  expect(
    !/^\s+at /m.test(proc.output),
    `the gate threw a stack trace instead of reporting:\n${proc.output.slice(0, 500)}`,
  );
}

/* ── the baseline: a correct fixture must be green ───────────────────────────────────────────── */

control('a correct miniature repository passes', POSITIVE, () => {
  const proc = run(fixture());
  expectExit(proc, 0, POSITIVE);
  expect(
    /all 13 slot-state claim\(s\) hold and cover every slot EXTENSION_SLOTS declares/.test(
      proc.stdout,
    ),
    `the verdict does not report the coverage it checked:\n${proc.stdout}`,
  );
});

/* ── finding 1: the scan ran past its own section ────────────────────────────────────────────── */

control('FINDING 1: the slot table deleted, a later table present', NEGATIVE, () => {
  const doc = referenceDoc().replace(slotTable(), '');
  const proc = run(fixture({ doc }));
  expectExit(proc, 1, NEGATIVE);
  expect(
    /has no table between .* and (heading|a thematic break|setext)/.test(proc.output),
    `it did not report the absent table:\n${proc.output.slice(-500)}`,
  );
});

control('the anchor appearing twice is ambiguous, not a coin toss', NEGATIVE, () => {
  const doc = referenceDoc().replace(
    'A slot is a named, ordered list of descriptors.',
    'A slot is a named, ordered list of descriptors.\n\nA slot is a named, ordered list of descriptors.',
  );
  expectExit(run(fixture({ doc })), 1, NEGATIVE);
});

control('a table inside a code fence is not mistaken for the slot table', POSITIVE, () => {
  const doc = referenceDoc().replace(
    slotTable(),
    '```json\n| not | a | table |\n| --- | --- | --- |\n| x | y | z |\n```\n\n' + slotTable(),
  );
  const proc = run(fixture({ doc }));
  expectExit(proc, 0, POSITIVE);
  expect(/all 13 slot-state claim\(s\) hold/.test(proc.stdout), 'claims were lost to the fence');
});

/* ── finding 2: the header and separator were discarded unchecked ─────────────────────────────── */

for (const [what, mutate] of [
  ['header and separator', (t) => t.split('\n').slice(2).join('\n')],
  [
    'separator alone',
    (t) =>
      t
        .split('\n')
        .filter((_, i) => i !== 1)
        .join('\n'),
  ],
  ['header alone', (t) => t.split('\n').slice(1).join('\n')],
]) {
  control(`FINDING 2: the slot table's ${what} removed`, NEGATIVE, () => {
    const doc = referenceDoc().replace(slotTable(), mutate(slotTable()));
    const proc = run(fixture({ doc }));
    expectExit(proc, 1, NEGATIVE);
    expect(
      /second line is not a Markdown separator|has no table header/.test(proc.output),
      `it did not report the damaged header pair:\n${proc.output.slice(-500)}`,
    );
  });
}

control("a data row whose column count differs from the header's is reported", NEGATIVE, () => {
  const rows = SLOTS.map((s) => [`\`${s}\``, 'what it addresses', 'Resolves']);
  rows[0] = ['`navbar`', 'only two cells'];
  expectExit(run(fixture({ doc: referenceDoc({ section2: slotTable(rows) }) })), 1, NEGATIVE);
});

/* ── finding 3: rows the parser could not read were skipped in silence ───────────────────────── */

control('FINDING 3: the slot-name backticks stripped from every row', NEGATIVE, () => {
  const rows = SLOTS.map((s) => [s, 'what it addresses', 'Resolves']);
  const proc = run(fixture({ doc: referenceDoc({ section2: slotTable(rows) }) }));
  expectExit(proc, 1, NEGATIVE);
  expect(
    /first cell is not a backticked slot name/.test(proc.output),
    `an unreadable row was skipped rather than reported:\n${proc.output.slice(-500)}`,
  );
  expect(
    /has no readable state claim for it/.test(proc.output),
    'the coverage assertion did not fire, so vacuity was still possible',
  );
});

control('a state prose that classifies as none of the three states is reported', NEGATIVE, () => {
  const rows = SLOTS.map((s) => [`\`${s}\``, 'what it addresses', 'Resolves']);
  rows[0] = ['`navbar`', 'what it addresses', 'Implemented'];
  const proc = run(fixture({ doc: referenceDoc({ section2: slotTable(rows) }) }));
  expectExit(proc, 1, NEGATIVE);
  expect(/which is none of the three states/.test(proc.output), proc.output.slice(-400));
});

control('a slot declared in code with no row is reported', NEGATIVE, () => {
  const rows = SLOTS.slice(1).map((s) => [`\`${s}\``, 'what it addresses', 'Resolves']);
  const proc = run(fixture({ doc: referenceDoc({ section2: slotTable(rows) }) }));
  expectExit(proc, 1, NEGATIVE);
  expect(
    /`EXTENSION_SLOTS` declares the slot `navbar` and section 2 .* has no readable state claim/s.test(
      proc.output,
    ),
    proc.output.slice(-400),
  );
});

control('a row for a slot the code does not declare is reported', NEGATIVE, () => {
  const rows = [
    ...SLOTS.map((s) => [`\`${s}\``, 'what it addresses', 'Resolves']),
    ['`inventedSlot`', 'what it addresses', 'Resolves'],
  ];
  const proc = run(fixture({ doc: referenceDoc({ section2: slotTable(rows) }) }));
  expectExit(proc, 1, NEGATIVE);
  expect(/which `EXTENSION_SLOTS` does not declare/.test(proc.output), proc.output.slice(-400));
});

/* ── findings 4, 5 and 6: the element column and how a class is resolved ─────────────────────── */

/** A component declared in its own file, plus a barrel that re-exports it, plus a registrar. */
const componentSources = ({ selector = 'fx-card', importFrom = './card', extra = {} } = {}) => ({
  'libs/fx/src/card.ts':
    `import { Component } from '@angular/core';\n` +
    `@Component({ selector: '${selector}', template: '' })\n` +
    `export class FxCardComponent {}\n`,
  'libs/fx/src/index.ts': `export { FxCardComponent } from './card';\n`,
  'libs/fx/src/registrar.ts':
    `import { FxCardComponent } from '${importFrom}';\n` +
    `export const REG = { 'nxs.tabs.fxCard': FxCardComponent };\n`,
  ...extra,
});

control('FINDING 6: a 6b component imported through a path alias resolves', POSITIVE, () => {
  /* The temporal dead zone. `TSCONFIG_PATHS` was read from inside its own TDZ, so this exact
   * fixture crashed the gate with a ReferenceError and rejected a valid component.
   * `expectExit` also asserts no stack trace, which is what that failure looked like. */
  const proc = run(
    fixture({
      doc: referenceDoc({ section6b: [['`nxs.tabs.fxCard`', '`fx-card`', '`tabs`']] }),
      sources: componentSources({ importFrom: '@fx/components' }),
    }),
  );
  expectExit(proc, 0, POSITIVE);
  expect(/1 row\(s\) in section 6b/.test(proc.stdout), proc.stdout.slice(-300));
});

control('FINDING 4/5: a wrong element for the registered class is reported', NEGATIVE, () => {
  /* The element used to be checked against "does this selector exist anywhere", which accepted
   * any tag belonging to any component. `fx-other` is declared, and is not this class's. */
  const proc = run(
    fixture({
      doc: referenceDoc({ section6b: [['`nxs.tabs.fxCard`', '`fx-other`', '`tabs`']] }),
      sources: componentSources({
        extra: {
          'libs/fx/src/other.ts':
            "import { Component } from '@angular/core';\n" +
            "@Component({ selector: 'fx-other', template: '' })\n" +
            'export class FxOtherComponent {}\n',
        },
      }),
    }),
  );
  expectExit(proc, 1, NEGATIVE);
  expect(
    /declares `fx-card`/.test(proc.output),
    `it did not name the registered class's real selector:\n${proc.output.slice(-400)}`,
  );
});

control('FINDING 5: an ambiguous class name is refused, not guessed', NEGATIVE, () => {
  /* Two classes of the same name with different selectors, reached by an import the named-import
   * pattern cannot match — so resolution falls to the global search, which must refuse. */
  const proc = run(
    fixture({
      doc: referenceDoc({ section6b: [['`nxs.tabs.fxCard`', '`fx-card`', '`tabs`']] }),
      sources: {
        'libs/fx/src/card.ts':
          "import { Component } from '@angular/core';\n" +
          "@Component({ selector: 'fx-card', template: '' })\n" +
          'export class FxCardComponent {}\n',
        'apps/fx-app/src/card.ts':
          "import { Component } from '@angular/core';\n" +
          "@Component({ selector: 'app-card', template: '' })\n" +
          'export class FxCardComponent {}\n',
        'libs/fx/src/registrar.ts':
          "import FxCardComponent from './card';\n" +
          "export const REG = { 'nxs.tabs.fxCard': FxCardComponent };\n",
      },
    }),
  );
  expectExit(proc, 1, NEGATIVE);
  expect(
    /is declared in 2 non-spec files/.test(proc.output),
    `ambiguity was resolved by guessing rather than refused:\n${proc.output.slice(-500)}`,
  );
});

control('a 6b row naming an ID nothing registers is reported', NEGATIVE, () => {
  const proc = run(
    fixture({ doc: referenceDoc({ section6b: [['`nxs.tabs.ghost`', '`fx-card`', '`tabs`']] }) }),
  );
  expectExit(proc, 1, NEGATIVE);
  expect(/registers that ID to a component/.test(proc.output), proc.output.slice(-400));
});

control('a 6b row naming a slot that takes no component is reported', NEGATIVE, () => {
  const proc = run(
    fixture({
      doc: referenceDoc({ section6b: [['`nxs.tabs.fxCard`', '`fx-card`', '`navbar`']] }),
      sources: componentSources(),
    }),
  );
  expectExit(proc, 1, NEGATIVE);
  expect(
    /is not one of the slots whose descriptors name a component/.test(proc.output),
    proc.output.slice(-400),
  );
});

control('an unreadable tsconfig is reported when an alias needs it', NEGATIVE, () => {
  const proc = run(
    fixture({
      doc: referenceDoc({ section6b: [['`nxs.tabs.fxCard`', '`fx-card`', '`tabs`']] }),
      sources: componentSources({ importFrom: '@fx/components' }),
      tsconfig: '{ this is not json\n',
    }),
  );
  expectExit(proc, 1, NEGATIVE);
  expect(/Could not read `compilerOptions.paths`/.test(proc.output), proc.output.slice(-400));
});

/* ── reading nothing must not pass as finding nothing ────────────────────────────────────────── */

control('a slot declared with a double-quoted value is still in the expected set', NEGATIVE, () => {
  /* Carried across from PR #554's roster finding rather than waiting for it to be reported here.
   * The pattern required the slot's VALUE to be single-quoted, so `navbar: "navbar"` was invisible
   * — and this set is the whole anti-vacuity mechanism, so an invisible slot is one whose missing
   * documentation row goes unreported. Driven on a fixture before fixing: the gate exited 0
   * claiming it covered "every slot EXTENSION_SLOTS declares" while one was neither read nor
   * documented. Worse than the sibling's version of the same class, which only hid a row. */
  const sources = slotSources();
  const key = 'libs/shared/extensions/src/lib/extension-slots.ts';
  sources[key] = sources[key].replace("  navbar: 'navbar',", '  navbar: "navbar",');
  const rows = SLOTS.filter((s) => s !== 'navbar').map((s) => [
    `\`${s}\``,
    'what it addresses',
    'Resolves',
  ]);
  const proc = run(fixture({ doc: referenceDoc({ section2: slotTable(rows) }), sources }));
  expectExit(proc, 1, NEGATIVE);
  expect(
    /declares the slot `navbar` and section 2 .* has no readable state claim/s.test(proc.output),
    `the double-quoted slot was dropped from the expected set:\n${proc.output.slice(-400)}`,
  );
});

control('an EXTENSION_SLOTS entry no pattern can read is reported, not dropped', NEGATIVE, () => {
  /* The class behind the control above, closed by a count the name pattern cannot influence: the
   * entries of the object are counted separately, so a key shape nobody anticipated is a reported
   * partial read rather than a quietly smaller expected set. */
  const sources = slotSources();
  const key = 'libs/shared/extensions/src/lib/extension-slots.ts';
  sources[key] = sources[key].replace("  navbar: 'navbar',", "  navbar: ['nav', 'bar'].join(''),");
  const proc = run(fixture({ sources }));
  expectExit(proc, 1, NEGATIVE);
  expect(
    /member this gate cannot read as `key: 'value'`/.test(proc.output),
    proc.output.slice(-400),
  );
});

/**
 * Members no line pattern can see: a spread, a computed key, and two entries on one line.
 *
 * Reported on PR #555 against the *first* fix for this, which counted "entries" with a second
 * line-anchored regex and compared the two counts. That cross-check shared the first pattern's
 * blind spots, so a member neither could see was omitted from both counts, they agreed, and the
 * coverage claim was false again. `objectMembers()` splits on top-level commas instead, so each
 * of these is a member it finds and cannot read — a reported failure, not a silent omission.
 *
 * The documentation row for a slot is removed in each case, so a control that merely checked
 * "does it still pass" would be satisfied by the bug; these require the gate to say which member
 * it could not read.
 */
for (const [label, member, undocumented, alsoDocument] of [
  ['a spread member', '...OTHER_SLOTS', 'navbar', []],
  ['a computed key', "[SOME_KEY]: 'navbar'", 'navbar', []],
  /* Isolating the second-entry-on-a-line case took two attempts, and the first two were not
   * discriminating — worth recording, because a control that passes either way is the thing this
   * whole pull request is about.
   *
   * The old line-anchored reader sees the FIRST entry on a line and not the second. So: `extra`
   * is first and IS documented, `navbar` is second and is NOT. Under the old reader the expected
   * set holds `extra` (documented, fine) and never contains `navbar`, so its absent row goes
   * unreported and the gate passes. Under the structural walk both are members, `navbar` has no
   * row, and it fails. */
  ['two entries on one line', "extra: 'extra', navbar: 'navbar'", 'navbar', ['extra']],
]) {
  control(`an EXTENSION_SLOTS ${label} is reported, not omitted`, NEGATIVE, () => {
    const sources = slotSources();
    const key = 'libs/shared/extensions/src/lib/extension-slots.ts';
    sources[key] = sources[key].replace("  navbar: 'navbar',", `  ${member},`);
    const rows = [...SLOTS.filter((s) => s !== undocumented), ...alsoDocument].map((s) => [
      `\`${s}\``,
      'what it addresses',
      'Resolves',
    ]);
    const proc = run(fixture({ doc: referenceDoc({ section2: slotTable(rows) }), sources }));
    expectExit(proc, 1, NEGATIVE);
    expect(
      /member this gate cannot read as `key: 'value'`|has no readable state claim/.test(
        proc.output,
      ),
      `the member was omitted from the expected set in silence:\n${proc.output.slice(-500)}`,
    );
  });
}

// A double-quoted component selector must still match its row, not fall through to a refusal.
control('a double-quoted selector is matched against its row', POSITIVE, () => {
  const proc = run(
    fixture({
      doc: referenceDoc({ section6b: [['`nxs.tabs.fxCard`', '`fx-card`', '`tabs`']] }),
      sources: {
        ...componentSources(),
        'libs/fx/src/card.ts':
          "import { Component } from '@angular/core';\n" +
          '@Component({ selector: "fx-card", template: "" })\n' +
          'export class FxCardComponent {}\n',
      },
    }),
  );
  expectExit(proc, 0, POSITIVE);
});

control('a four-backtick fence containing ``` lines stays fenced', NEGATIVE, () => {
  /* Reported on PR #555. A boolean toggle treated the inner ``` as the outer fence's close, so
   * everything after it — including a worked example of a slot table — became visible to
   * `tableAfter()`. Driven with the real table deleted and only the fenced example left: the
   * committed gate exited 0 reporting "all 13 slot-state claim(s) hold" from inside a code block. */
  const fence4 = '`'.repeat(4);
  const fence3 = '`'.repeat(3);
  const example = [`${fence4}markdown`, fence3, slotTable(), fence3, fence4].join('\n');
  const doc = referenceDoc().replace(slotTable(), example);
  const proc = run(fixture({ doc }));
  expectExit(proc, 1, NEGATIVE);
  expect(
    /has no table between/.test(proc.output),
    `a fenced example satisfied the slot-state check:\n${proc.output.slice(-500)}`,
  );
});

control('a barrel aliasing the sought name elsewhere does not win the lookup', NEGATIVE, () => {
  /* Reported on PR #555. The barrel exposes `FxCardComponent` from `./b`, and separately aliases
   * a DIFFERENT `FxCardComponent` out of `./a` under another name. Matching `\bFxCardComponent\b`
   * inside the braces hit the aliased clause first and resolved `./a` — so the gate accepted the
   * wrong element and rejected the correct one, before ever reaching its ambiguity check.
   *
   * The row names `fx-card`, the selector of the class the barrel really exposes, so a correct
   * row must pass; this control asserts the wrong one is rejected, and the positive twin below
   * asserts the right one is accepted. */
  const proc = run(
    fixture({
      doc: referenceDoc({ section6b: [['`nxs.tabs.fxCard`', '`fx-other`', '`tabs`']] }),
      sources: {
        'libs/fx/src/a.ts':
          "import { Component } from '@angular/core';\n" +
          "@Component({ selector: 'fx-other', template: '' })\n" +
          'export class FxCardComponent {}\n',
        'libs/fx/src/b.ts':
          "import { Component } from '@angular/core';\n" +
          "@Component({ selector: 'fx-card', template: '' })\n" +
          'export class FxCardComponent {}\n',
        'libs/fx/src/index.ts':
          "export { FxCardComponent as AlternateCardComponent } from './a';\n" +
          "export { FxCardComponent } from './b';\n",
        'libs/fx/src/registrar.ts':
          "import { FxCardComponent } from './index';\n" +
          "export const REG = { 'nxs.tabs.fxCard': FxCardComponent };\n",
      },
    }),
  );
  expectExit(proc, 1, NEGATIVE);
  expect(
    /declares `fx-card`/.test(proc.output),
    `the aliased clause won the lookup:\n${proc.output.slice(-500)}`,
  );
});

falsePositive('the same barrel accepts the element of the class it really exposes', () => {
  const proc = run(
    fixture({
      doc: referenceDoc({ section6b: [['`nxs.tabs.fxCard`', '`fx-card`', '`tabs`']] }),
      sources: {
        'libs/fx/src/a.ts':
          "import { Component } from '@angular/core';\n" +
          "@Component({ selector: 'fx-other', template: '' })\n" +
          'export class FxCardComponent {}\n',
        'libs/fx/src/b.ts':
          "import { Component } from '@angular/core';\n" +
          "@Component({ selector: 'fx-card', template: '' })\n" +
          'export class FxCardComponent {}\n',
        'libs/fx/src/index.ts':
          "export { FxCardComponent as AlternateCardComponent } from './a';\n" +
          "export { FxCardComponent } from './b';\n",
        'libs/fx/src/registrar.ts':
          "import { FxCardComponent } from './index';\n" +
          "export const REG = { 'nxs.tabs.fxCard': FxCardComponent };\n",
      },
    }),
  );
  expectExit(proc, 0, POSITIVE);
});

control('a renamed re-export is followed, not resolved by global name', NEGATIVE, () => {
  /* Reported on PR #555. The barrel exposes `FxCardComponent` but the class is really
   * `OriginalCardComponent` in `./a`. Resolution used to look for `export class FxCardComponent`
   * in the target, find nothing, and fall back to a global search — accepting the selector of an
   * unrelated class that happened to carry that name. The unrelated class here declares
   * `fx-unrelated`, so accepting it would pass this row; following the binding reaches
   * `fx-original` and rejects it. */
  const proc = run(
    fixture({
      doc: referenceDoc({ section6b: [['`nxs.tabs.fxCard`', '`fx-unrelated`', '`tabs`']] }),
      sources: {
        'libs/fx/src/a.ts':
          "import { Component } from '@angular/core';\n" +
          "@Component({ selector: 'fx-original', template: '' })\n" +
          'export class OriginalCardComponent {}\n',
        'apps/fx-app/src/unrelated.ts':
          "import { Component } from '@angular/core';\n" +
          "@Component({ selector: 'fx-unrelated', template: '' })\n" +
          'export class FxCardComponent {}\n',
        'libs/fx/src/index.ts': "export { OriginalCardComponent as FxCardComponent } from './a';\n",
        'libs/fx/src/registrar.ts':
          "import { FxCardComponent } from './index';\n" +
          "export const REG = { 'nxs.tabs.fxCard': FxCardComponent };\n",
      },
    }),
  );
  expectExit(proc, 1, NEGATIVE);
  expect(
    /declares `fx-original`/.test(proc.output),
    `the unrelated global class was accepted as the identity:\n${proc.output.slice(-500)}`,
  );
});

/**
 * The unique-class fallback, in both directions.
 *
 * Reported on PR #555: this path is reached by a **default** import — which the named-import
 * matcher cannot see — of a class no other file declares, and the line that handles it still
 * called a closure the resolution rewrite had removed. It threw
 * `ReferenceError: readFrom is not defined` and rejected a valid component. The existing
 * ambiguity control only covered *multiple* matches, so nothing exercised the single-match side.
 *
 * `expectExit` asserts no stack trace, which is what that failure was.
 */
const DEFAULT_IMPORT_SOURCES = {
  'libs/fx/src/card.ts':
    "import { Component } from '@angular/core';\n" +
    "@Component({ selector: 'fx-card', template: '' })\n" +
    'export class FxUniqueCardComponent {}\n' +
    'export default FxUniqueCardComponent;\n',
  'libs/fx/src/registrar.ts':
    "import FxUniqueCardComponent from './card';\n" +
    "export const REG = { 'nxs.tabs.fxCard': FxUniqueCardComponent };\n",
};

falsePositive('the unique-class fallback resolves a default-imported component', () => {
  const proc = run(
    fixture({
      doc: referenceDoc({ section6b: [['`nxs.tabs.fxCard`', '`fx-card`', '`tabs`']] }),
      sources: DEFAULT_IMPORT_SOURCES,
    }),
  );
  expectExit(proc, 0, POSITIVE);
  expect(/1 row\(s\) in section 6b/.test(proc.stdout), proc.stdout.slice(-300));
});

control('the unique-class fallback still rejects a wrong element', NEGATIVE, () => {
  /* The negative twin. A fallback that resolved nothing would also "pass" the control above by
   * never disagreeing, so the fallback has to be shown disagreeing too. */
  const proc = run(
    fixture({
      doc: referenceDoc({ section6b: [['`nxs.tabs.fxCard`', '`fx-wrong`', '`tabs`']] }),
      sources: DEFAULT_IMPORT_SOURCES,
    }),
  );
  expectExit(proc, 1, NEGATIVE);
  expect(/declares `fx-card`/.test(proc.output), proc.output.slice(-400));
});

control('a binding whose module cannot be resolved is refused, not name-matched', NEGATIVE, () => {
  const proc = run(
    fixture({
      doc: referenceDoc({ section6b: [['`nxs.tabs.fxCard`', '`fx-card`', '`tabs`']] }),
      sources: {
        ...componentSources(),
        'libs/fx/src/registrar.ts':
          "import { FxCardComponent } from './nowhere-at-all';\n" +
          "export const REG = { 'nxs.tabs.fxCard': FxCardComponent };\n",
      },
    }),
  );
  expectExit(proc, 1, NEGATIVE);
  expect(
    /could not be resolved, so which component it refers to is unknown/.test(proc.output),
    proc.output.slice(-400),
  );
});

control('a fixture whose EXTENSION_SLOTS cannot be found is reported', NEGATIVE, () => {
  const root = fixture();
  rmSync(join(root, 'libs/shared/extensions/src/lib/extension-slots.ts'));
  const proc = run(root);
  expectExit(proc, 1, NEGATIVE);
  expect(
    /Could not find `extension-slots.ts`|checked against no expected set/.test(proc.output),
    proc.output.slice(-400),
  );
});

control('a source root that cannot be listed is reported, not skipped', NEGATIVE, () => {
  /* Found by these controls on their first run: `walk()` called `readdirSync` unconditionally, so
   * a repository without an `apps/` directory crashed the gate with an ENOENT stack trace.
   * Skipping the root would be worse than crashing — every registered ID lives under these roots,
   * so a root the gate cannot read makes its "all registered IDs are documented" verdict cover
   * less than it says. */
  const root = fixture();
  rmSync(join(root, 'apps'), { recursive: true, force: true });
  const proc = run(root);
  expectExit(proc, 1, NEGATIVE);
  expect(
    /apps\/ does not exist under .*so this gate cannot see the IDs registered there/s.test(
      proc.output,
    ),
    proc.output.slice(-400),
  );
});

control('--root is validated rather than crashing', NEGATIVE, () => {
  const proc = spawnSync(process.execPath, [GATE, '--root'], { encoding: 'utf8' });
  const output = `${proc.stdout}${proc.stderr}`;
  expect(proc.status === 1, `exited ${proc.status}, expected 1`);
  expect(/--root needs a directory/.test(output), output.slice(0, 300));
  expect(!/^\s+at /m.test(output), 'it threw a stack trace instead of refusing');
});

/* ── report ──────────────────────────────────────────────────────────────────────────────────── */

rmSync(workspace, { recursive: true, force: true });

for (const c of controls)
  console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.ok ? '' : `\n         ${c.why}`}`);
const failed = controls.filter((c) => !c.ok).length;
const negative = controls.filter((c) => c.negative).length;
console.log(
  failed
    ? `\nextension-reference-drift selftest: FAIL — ${failed} of ${controls.length} control(s) failed.`
    : `\nextension-reference-drift selftest: pass — ${controls.length} control(s), ${negative} ` +
        `negative (the gate must not pass) and ${controls.length - negative} positive. ` +
        'Six of them are the six findings PR #544 found by eye.',
);
process.exit(failed ? 1 : 0);
