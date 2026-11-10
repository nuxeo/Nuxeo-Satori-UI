#!/usr/bin/env node
/**
 * Negative controls for `stories-typecheck.mjs`.
 *
 * ## Why this gate needs them more than most
 *
 * `spec-types` arrived with 43 errors to clear, so its first run proved it worked. This gate
 * landed green: both `.storybook/tsconfig.json` files already type-checked clean, which is the
 * point of a prevention gate and also means **no run against this repository can tell it from a
 * check that returns pass unconditionally.** `CLAUDE.md` is blunt about what that is worth —
 * three gates in this programme were green while the thing they guarded was broken, among them
 * an evidence check comparing script `src` attributes instead of bundle bytes and a path check
 * that was tautological under the dev base href. So each control here builds a miniature
 * repository that is wrong on purpose under `os.tmpdir()`, points the gate at it with `--root`,
 * and requires the specific breakage to be named rather than merely some failure: a control that
 * goes red for an unrelated reason reads as a pass.
 *
 * Two of them pin safety properties a green run can never exercise, both inherited from
 * `spec-typecheck.mjs` as deliberate design rather than accident:
 *
 * - **No config found at all is a failure.** Its walk skips every entry starting with `.`, and
 *   the directory this gate looks for is `.storybook`; a copy of that walk finds nothing here and
 *   would have reported a serene pass over zero files.
 * - **A stories file no config covers is a failure.** Without it, this gate would be free to
 *   reproduce the hole it exists to close, one project over.
 *
 * The fixtures carry their own `compilerOptions` and `"types": []` rather than extending the
 * repository's tsconfigs: nothing Angular is loaded, so a control compiles in well under a
 * second, and a fixture cannot start passing or failing because a real config changed.
 *
 * `tsc` itself is resolved from this repository's `node_modules` by the gate, never from the
 * fixture — see `HARNESS_ROOT` there.
 *
 * Usage:  node scripts/beta-harness/stories-typecheck.selftest.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { ensureGeneratedInputs } from './generated-inputs.mjs';

const GATE = resolve(import.meta.dirname, 'stories-typecheck.mjs');
const workspace = mkdtempSync(join(tmpdir(), 'stories-typecheck-selftest-'));

/* ── harness ─────────────────────────────────────────────────────────────────────────────────── */

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

function run(root, extra = []) {
  const proc = spawnSync(process.execPath, [GATE, '--root', root, ...extra], { encoding: 'utf8' });
  return { ...proc, output: `${proc.stdout ?? ''}${proc.stderr ?? ''}` };
}

/** Asserts the exit code, and that the control's own declaration agrees with it. */
function expectExit(proc, expected, { negative }) {
  const isPass = expected === 0;
  if (negative === isPass) {
    throw new Error(`declared ${negative ? 'negative' : 'positive'} but requires exit ${expected}`);
  }
  expect(
    proc.status === expected,
    `exited ${proc.status}, expected ${expected}:\n${proc.output.slice(-900)}`,
  );
  expect(
    !/^\s+at /m.test(proc.output),
    `the gate threw a stack trace instead of reporting:\n${proc.output.slice(0, 600)}`,
  );
}

/* ── the fixture repository ──────────────────────────────────────────────────────────────────── */

let made = 0;

/**
 * A miniature repository.
 *
 * `projects` maps a path under `libs/` to `{ storybook, stories, preview, types }`:
 * - `storybook` false leaves the project without a `.storybook/tsconfig.json` at all
 * - `storybook` an object overrides the config's `include`
 * - `stories` maps a file name under `src/` to its body
 * - `preview` is the body of `.storybook/preview.ts`
 * - `types` overrides `compilerOptions.types`, which defaults to `[]` so nothing is loaded
 *
 * The stories are written whatever `storybook` says, so a project without a config still puts a
 * `*.stories.ts` on disk for the coverage check to find — and `libs/` exists either way, which is
 * what the gate's `--root` validation requires.
 */
function fixture(projects) {
  const root = join(workspace, `fixture-${made++}`);
  for (const [path, spec] of Object.entries(projects)) {
    const project = join(root, 'libs', path);
    for (const [name, body] of Object.entries(spec.stories ?? {})) {
      write(join(project, 'src', name), body);
    }
    if (spec.storybook === false) continue;
    write(
      join(project, '.storybook', 'preview.ts'),
      spec.preview ?? 'export const parameters = {};\n',
    );
    write(
      join(project, '.storybook', 'tsconfig.json'),
      `${JSON.stringify(
        {
          compilerOptions: {
            noEmit: true,
            strict: true,
            target: 'es2022',
            module: 'preserve',
            moduleResolution: 'bundler',
            skipLibCheck: true,
            types: spec.types ?? [],
          },
          include: spec.storybook?.include ?? ['../src/**/*.stories.ts', 'preview.ts'],
        },
        null,
        2,
      )}\n`,
    );
  }
  return root;
}

function write(path, body) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

/** A stories file that type-checks. */
const CLEAN_STORY = `export const Default = { args: { count: 1 } };\n`;
/** The classic stories type error: an arg of the wrong type for the input it feeds. */
const WRONG_ARG = `const count: number = 'three';\nexport const Default = { args: { count } };\n`;

/* ── controls: the type error itself ─────────────────────────────────────────────────────────── */

control('a type error in a stories file fails, naming the file and the line', NEGATIVE, () => {
  const proc = run(fixture({ widgets: { stories: { 'widget.stories.ts': WRONG_ARG } } }));
  expectExit(proc, 1, NEGATIVE);
  expect(
    /widgets[/\\]src[/\\]widget\.stories\.ts\(1,7\): error TS2322:/.test(proc.output),
    `the file and line were not named:\n${proc.output.slice(-600)}`,
  );
});

control('a type error in a .storybook support file fails too', NEGATIVE, () => {
  const proc = run(
    fixture({
      widgets: {
        stories: { 'widget.stories.ts': CLEAN_STORY },
        preview: `export const parameters: number = 'not a number';\n`,
      },
    }),
  );
  expectExit(proc, 1, NEGATIVE);
  expect(
    /preview\.ts\(1,14\): error TS2322:/.test(proc.output),
    `the support file was not named:\n${proc.output.slice(-600)}`,
  );
});

/* ── controls: the two safety properties a green run cannot exercise ─────────────────────────── */

control('no .storybook/tsconfig.json anywhere is a failure, not a serene pass', NEGATIVE, () => {
  const proc = run(
    fixture({ widgets: { storybook: false, stories: { 'widget.stories.ts': WRONG_ARG } } }),
  );
  expectExit(proc, 1, NEGATIVE);
  expect(
    /found no \.storybook\/tsconfig\.json at all/.test(proc.output) &&
      /That is not a pass/.test(proc.output),
    `it did not refuse an empty run:\n${proc.output.slice(-600)}`,
  );
  expect(
    /1 \*\.stories\.ts file\(s\) are present/.test(proc.output),
    `it did not say how many files went unchecked:\n${proc.output.slice(-600)}`,
  );
});

control('a stories file that no discovered config covers fails', NEGATIVE, () => {
  const proc = run(
    fixture({
      widgets: { stories: { 'widget.stories.ts': CLEAN_STORY } },
      // A second project with stories and no Storybook config of its own: the gate finds a config,
      // compiles it clean, and must still refuse — this file is checked by nothing.
      gadgets: { storybook: false, stories: { 'gadget.stories.ts': WRONG_ARG } },
    }),
  );
  expectExit(proc, 1, NEGATIVE);
  expect(
    /covered by no \.storybook\/tsconfig\.json/.test(proc.output),
    `it did not report the coverage gap:\n${proc.output.slice(-700)}`,
  );
  expect(
    /gadgets[/\\]src[/\\]gadget\.stories\.ts/.test(proc.output),
    `it did not name the uncovered file:\n${proc.output.slice(-700)}`,
  );
});

control('a stories file excluded from the config that should cover it fails', NEGATIVE, () => {
  const proc = run(
    fixture({
      widgets: {
        // `include` narrowed to one subdirectory, as a real one drifts: `legacy/old.stories.ts`
        // stays on disk and silently leaves the compile.
        storybook: { include: ['../src/current/**/*.stories.ts', 'preview.ts'] },
        stories: {
          'current/new.stories.ts': CLEAN_STORY,
          'legacy/old.stories.ts': WRONG_ARG,
        },
      },
    }),
  );
  expectExit(proc, 1, NEGATIVE);
  expect(
    /legacy[/\\]old\.stories\.ts/.test(proc.output),
    `the excluded file was not named:\n${proc.output.slice(-700)}`,
  );
});

/* `tsc` prints a handful of errors with NO leading `file(line,col):` prefix, so
 * `spec-typecheck.mjs`'s `/ error TS\d+:/` — which requires the space that prefix ends with —
 * matches zero lines on them and scores the config zero errors. The gate guards against that
 * twice over, and the next two controls pin one mechanism each. Measured by breaking them
 * separately (`/tmp` meta-control, 2026-11-09): either alone catches both cases, so without a
 * control per mechanism, dropping one would have gone unnoticed. */

control('an unresolvable config fails, and is reported as unresolvable', NEGATIVE, () => {
  // `error TS18003: No inputs were found` — the `include` has stopped matching anything, which is
  // how a renamed directory silently empties a compile. `--showConfig` refuses it too, which is
  // mechanism 1; asserting the wording pins that path rather than the compile's.
  const proc = run(fixture({ widgets: { storybook: { include: ['../src/**/*.stories.ts'] } } }));
  expectExit(proc, 1, NEGATIVE);
  expect(
    /TS18003/.test(proc.output),
    `an empty compile was not reported:\n${proc.output.slice(-700)}`,
  );
  expect(
    /tsc cannot resolve this config/.test(proc.output),
    `the --showConfig refusal did not fire:\n${proc.output.slice(-700)}`,
  );
});

control('a config naming a @types package that is not installed fails', NEGATIVE, () => {
  // `error TS2688: Cannot find type definition file for '...'`, also unprefixed — but
  // `--showConfig` exits 0 on it, so mechanism 1 cannot see this one at all. It is caught only by
  // trimming each line before matching, with the non-zero exit code as the backstop behind that.
  // Realistic: a `.storybook/tsconfig.json` keeps naming a `@types` package a dependency bump
  // dropped, and every stories file silently stops being checked.
  const proc = run(
    fixture({
      widgets: {
        types: ['a-type-package-that-is-not-installed'],
        stories: { 'widget.stories.ts': CLEAN_STORY },
      },
    }),
  );
  expectExit(proc, 1, NEGATIVE);
  expect(
    /TS2688/.test(proc.output),
    `a missing type package was not reported:\n${proc.output.slice(-700)}`,
  );
});

control('a --root with no apps/ or libs/ refuses instead of passing over nothing', NEGATIVE, () => {
  const empty = join(workspace, 'not-a-repository');
  mkdirSync(empty, { recursive: true });
  const proc = run(empty);
  expectExit(proc, 1, NEGATIVE);
  expect(
    /has no apps\/ or libs\//.test(proc.output),
    `it did not refuse the root:\n${proc.output.slice(-400)}`,
  );
});

/* ── controls: the gate must stay green on a correct tree ────────────────────────────────────── */

falsePositive('a clean fixture passes and reports the config it ran', () => {
  const proc = run(fixture({ widgets: { stories: { 'widget.stories.ts': CLEAN_STORY } } }));
  expectExit(proc, 0, POSITIVE);
  expect(
    /libs[/\\]widgets[/\\]\.storybook[/\\]tsconfig\.json/.test(proc.output),
    `it did not name the config it ran:\n${proc.output.slice(-600)}`,
  );
  expect(
    /1 stories file\(s\) type-checked through 1 \.storybook\/tsconfig\.json/.test(proc.output) &&
      /none uncovered/.test(proc.output),
    `it did not report what it covered:\n${proc.output.slice(-600)}`,
  );
});

falsePositive('a .storybook two directories deeper is discovered, not missed', () => {
  const proc = run(
    fixture({ 'shared/deeply/nested': { stories: { 'widget.stories.ts': CLEAN_STORY } } }),
  );
  expectExit(proc, 0, POSITIVE);
  expect(
    /shared[/\\]deeply[/\\]nested[/\\]\.storybook/.test(proc.output),
    `the nested config was not discovered:\n${proc.output.slice(-600)}`,
  );
});

falsePositive('--json reports the same verdict in a machine-readable shape', () => {
  const proc = run(fixture({ widgets: { stories: { 'widget.stories.ts': CLEAN_STORY } } }), [
    '--json',
  ]);
  expectExit(proc, 0, POSITIVE);
  const report = JSON.parse(proc.stdout);
  expect(report.ok === true, `ok was ${report.ok}`);
  expect(report.storiesFound === 1, `storiesFound was ${report.storiesFound}`);
  expect(report.storiesCovered === 1, `storiesCovered was ${report.storiesCovered}`);
  expect(report.configs.length === 1, `configs held ${report.configs.length}`);
});

/* ── controls: the generated-input prerequisite, in process ──────────────────────────────────── */

/* A missing `documentation.json` is the one failure that reads as something it is not: every file
 * reaching `.storybook/compodoc.ts` fails with TS2307, which looks like a type error in our
 * sources rather than a build step that never ran. It cost a red `beta:gate` on every fresh clone
 * once. The controls inject `runTool` rather than running `nx`, so they are instant and do not
 * depend on the real target succeeding. */

const PREREQ = [
  { target: 'fixture:generate', writes: 'generated.json', neededBy: ['libs/widgets/consumer.ts'] },
];

control('a prerequisite whose target fails refuses, and not as a type error', NEGATIVE, () => {
  const root = fixture({ widgets: { stories: { 'widget.stories.ts': CLEAN_STORY } } });
  write(join(root, 'libs', 'widgets', 'consumer.ts'), 'export const x = 1;\n');
  const result = ensureGeneratedInputs({
    root,
    gate: 'stories-typecheck',
    prerequisites: PREREQ,
    runTool: () => ({ status: 1, stdout: 'nx: target failed', stderr: '' }),
  });
  expect(result.ok === false, 'a failing prerequisite was accepted');
  expect(
    /could not produce generated\.json/.test(result.message) &&
      /TS2307/.test(result.message) &&
      /cannot speak for a project whose generated inputs are missing/.test(result.message),
    `the refusal did not explain itself:\n${result.message}`,
  );
});

control('a prerequisite that exits 0 without writing the file still refuses', NEGATIVE, () => {
  const root = fixture({ widgets: { stories: { 'widget.stories.ts': CLEAN_STORY } } });
  write(join(root, 'libs', 'widgets', 'consumer.ts'), 'export const x = 1;\n');
  const result = ensureGeneratedInputs({
    root,
    gate: 'stories-typecheck',
    prerequisites: PREREQ,
    runTool: () => ({ status: 0, stdout: 'cache hit, nothing written', stderr: '' }),
  });
  expect(result.ok === false, 'a green target that wrote nothing was accepted');
  expect(
    /and the file is still absent/.test(result.message),
    `it did not say the file was absent:\n${result.message}`,
  );
});

falsePositive('a prerequisite nothing under the root imports is skipped, not run', () => {
  // The fixture has no `libs/widgets/consumer.ts`, so there is nothing to generate for. This is
  // what lets the controls above point the gate at a tmpdir with no Nx workspace in it. It is not
  // the skip-on-presence trap `generated-inputs.mjs` warns about: the test is on the file that
  // *imports* the generated input, never on the generated input itself.
  const root = fixture({ widgets: { stories: { 'widget.stories.ts': CLEAN_STORY } } });
  let ran = 0;
  const result = ensureGeneratedInputs({
    root,
    gate: 'stories-typecheck',
    prerequisites: PREREQ,
    runTool: () => {
      ran += 1;
      return { status: 0, stdout: '', stderr: '' };
    },
  });
  expect(result.ok === true, `it refused a root with no consumer: ${result.message}`);
  expect(ran === 0, `it ran the target ${ran} time(s) with nothing to generate for`);
  expect(
    result.skipped.includes('fixture:generate'),
    `the skip was not reported: ${JSON.stringify(result)}`,
  );
});

falsePositive('a prerequisite whose output is present and imported is still run', () => {
  // Run unconditionally, never skipped because the file is already there: a stale
  // `documentation.json` from an older source tree type-checks against an API that no longer
  // exists, which is worse than a slow run.
  const root = fixture({ widgets: { stories: { 'widget.stories.ts': CLEAN_STORY } } });
  write(join(root, 'libs', 'widgets', 'consumer.ts'), 'export const x = 1;\n');
  write(join(root, 'generated.json'), '{"stale":true}\n');
  let ran = 0;
  const result = ensureGeneratedInputs({
    root,
    gate: 'stories-typecheck',
    prerequisites: PREREQ,
    runTool: () => {
      ran += 1;
      return { status: 0, stdout: '', stderr: '' };
    },
  });
  expect(result.ok === true, `it refused: ${result.message}`);
  expect(ran === 1, `it ran the target ${ran} time(s), expected exactly 1`);
});

/* ── report ──────────────────────────────────────────────────────────────────────────────────── */

rmSync(workspace, { recursive: true, force: true });

for (const c of controls) {
  console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.ok ? '' : `\n         ${c.why}`}`);
}
const failed = controls.filter((c) => !c.ok).length;
const negative = controls.filter((c) => c.negative).length;
console.log(
  failed
    ? `\nstories-typecheck selftest: FAIL — ${failed} of ${controls.length} control(s) failed.`
    : `\nstories-typecheck selftest: pass — ${controls.length} control(s), ${negative} negative ` +
        `(the gate must not pass) and ${controls.length - negative} positive. The two that matter ` +
        'most cannot be exercised by any run against this repository, which is green: no config ' +
        'found at all must fail, and a stories file no config covers must fail.',
);
process.exit(failed ? 1 : 0);
