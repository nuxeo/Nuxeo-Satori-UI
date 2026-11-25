#!/usr/bin/env node
/**
 * Module-boundary gate for the business apps tiers.
 *
 * docs/business-apps/architecture.md, sections 4 and 14: experiences may use modules, modules may
 * use engines, and modules never use each other. `eslint.config.mjs` states that as three
 * `depConstraints` (`scope:engine`, `scope:module`, `scope:experience`), and this gate is the
 * proof that they reject what they should.
 *
 * ## Why it exists
 *
 * The boundary rule in this repository was `error` for months and rejected nothing. Nx's
 * scaffolded `sourceTag: '*'` allowed every edge, and four violations accumulated unseen. A
 * constraint can be wrong in ways that leave lint green:
 *
 * - a misspelt tag;
 * - a tier listed in its own allow-list;
 * - the rule set to `warn`;
 * - the rule skipping itself, which it does, with only a warning, when it finds no project graph.
 *
 * And the tiers' rules have no forbidden import to fail on until phase 1 creates the first module.
 * The five engines so far, `libs/shared/computations`, `libs/shared/document-layouts`,
 * `libs/shared/home`, `libs/shared/notifications` and `libs/shared/queues`, import only shared code
 * and one another. So this
 * gate gives them projects now.
 *
 * ## What it does
 *
 * 1. Reads the rule's options from `eslint.config.mjs`. It refuses a rule set below `error`,
 *    because a boundary it reported would not fail lint.
 * 2. Builds a throwaway Nx workspace under `tmp/`. The directory is ignored by git, so the real
 *    workspace never sees it, and it is inside the checkout, so it resolves this repository's own
 *    nx, ESLint and Nx plugin. The workspace holds:
 *    - one probe project per tier, tagged as that tier's projects will be;
 *    - one file per control, importing one probe from another.
 * 3. Computes that workspace's project graph with nx, and checks nx sees exactly the probes.
 * 4. Lints the control files with the real `@nx/enforce-module-boundaries` and those options.
 *
 * Two probes stand for something other than a tier. `probe-publishable` is the published
 * package, `libs/platform`. `probe-spike` is decision 5's spike, `tools/plugin-spike`, which must be
 * reachable from no app, library or package, and must reach nothing itself: no rule lists
 * `type:spike`, and no rule has it as its source, which Nx reads as "may depend on nothing". That
 * probe stands for a project that exists, so before anything else the gate checks the project
 * still carries exactly the probe's tags (`realProjectMismatches`), and asks Nx for every target it
 * resolves for the project, the ones its plugins infer included, and fails on one that could build
 * it (`realProjectTargetProblems`).
 *
 * The rule is applied to the file types `eslint.config.mjs` gives it, which do not include `.mjs`.
 * The spike's own `.mjs` sources are held to importing nothing of the workspace by
 * `checkPluginSpikeIsolated` in `scripts/review-guardrails.mjs`, which also fails on any file
 * outside the spike, `.mjs` included, that names or links into it.
 *
 * Every forbidden import must be reported by that rule, and every allowed one must stay quiet.
 * The negative controls are what make a skipped or permissive rule fail here: a rule that reports
 * nothing passes every positive control and fails every negative one.
 *
 * Exit codes: 0 every control behaved; 1 a control did not, or the rule is not an error; 2 the
 * gate could not run. Set `MODULE_BOUNDARIES_KEEP=1` to keep the probe workspace for a look.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnToolSync } from './package-command.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RULE = '@nx/enforce-module-boundaries';

/** One probe per tier, tagged as the tier's projects are (eslint.config.mjs). */
export const PROBES = [
  {
    name: 'probe-engine',
    root: 'libs/shared/probe-engine',
    tags: ['scope:shared', 'scope:engine', 'type:data-access'],
  },
  {
    name: 'probe-foundation',
    root: 'libs/shared/probe-foundation',
    tags: ['scope:shared', 'type:util'],
  },
  { name: 'probe-module-a', root: 'libs/modules/probe-a', tags: ['scope:module', 'type:feature'] },
  { name: 'probe-module-b', root: 'libs/modules/probe-b', tags: ['scope:module', 'type:feature'] },
  { name: 'probe-feature', root: 'libs/features/probe', tags: ['scope:features', 'type:feature'] },
  {
    name: 'probe-experience',
    root: 'apps/probe-experience',
    tags: ['scope:experience', 'type:app'],
    application: true,
  },
  { name: 'probe-app', root: 'apps/probe-app', tags: ['scope:app', 'type:app'], application: true },
  // The published package, `libs/platform`: what a customer installs.
  {
    name: 'probe-publishable',
    root: 'libs/probe-publishable',
    tags: ['scope:shared', 'type:publishable'],
  },
  // Decision 5's spike (docs/business-apps/spikes/plugins-decision-5.md), a loader for code fetched
  // at run time that must stay out of every app and package. Unlike the tiers' probes, this one
  // stands for a project that exists today, so `realProject` names it and the gate refuses to run
  // unless that project carries exactly these tags: a probe with the right tags proves nothing
  // about a real project tagged otherwise.
  {
    name: 'probe-spike',
    root: 'tools/probe-spike',
    tags: ['type:spike'],
    realProject: 'tools/plugin-spike/project.json',
    // Every target Nx resolves for the real project, inferred ones included, by name and by what
    // it runs: tests, lint and the type check, and nothing that builds, serves or publishes it. A
    // target of an allowed name running anything else fails as well.
    allowedTargets: [
      { name: /^test$/, executor: '@nx/vitest:test' },
      { name: /^lint$/, executor: '@nx/eslint:lint' },
      { name: /^typecheck$/, executor: 'nx:run-commands', command: /^tsc -p \S+ --noEmit$/ },
      { name: /^eslint:lint$/, executor: 'nx:run-commands', command: /^eslint \.$/ },
      { name: /^vitest:test$/, executor: 'nx:run-commands', command: /^vitest run$/ },
      { name: /^test-ci$/, executor: 'nx:noop' },
      {
        name: /^test-ci--.+$/,
        executor: 'nx:run-commands',
        command: /^vitest run \S+ --coverage\.reportsDirectory=\S+$/,
      },
    ],
  },
];

/** A file in `from` importing `to`, and whether the rule must report it. */
export const CONTROLS = [
  {
    from: 'probe-module-a',
    to: 'probe-module-b',
    forbidden: true,
    why: 'modules never use each other',
  },
  {
    from: 'probe-module-a',
    to: 'probe-feature',
    forbidden: true,
    why: "a module does not use the current app's features",
  },
  {
    from: 'probe-engine',
    to: 'probe-module-a',
    forbidden: true,
    why: 'an engine does not reach up into a module',
  },
  {
    from: 'probe-foundation',
    to: 'probe-module-a',
    forbidden: true,
    why: 'shared code does not reach up into a module',
  },
  {
    from: 'probe-feature',
    to: 'probe-module-a',
    forbidden: true,
    why: "the current app's features do not use modules",
  },
  {
    from: 'probe-experience',
    to: 'probe-feature',
    forbidden: true,
    why: "an experience does not use the current app's features",
  },
  {
    from: 'probe-module-a',
    to: 'probe-engine',
    forbidden: false,
    why: 'a module uses the engines',
  },
  {
    from: 'probe-module-a',
    to: 'probe-foundation',
    forbidden: false,
    why: 'a module uses the foundations under the engines',
  },
  {
    from: 'probe-engine',
    to: 'probe-foundation',
    forbidden: false,
    why: 'an engine uses the foundations',
  },
  {
    from: 'probe-experience',
    to: 'probe-module-a',
    forbidden: false,
    why: 'an experience uses modules',
  },
  {
    from: 'probe-experience',
    to: 'probe-engine',
    forbidden: false,
    why: 'an experience uses engines',
  },
  {
    from: 'probe-app',
    to: 'probe-module-a',
    forbidden: false,
    why: "an app uses a module through the module's type tag",
  },
  {
    from: 'probe-publishable',
    to: 'probe-foundation',
    forbidden: false,
    why: 'the published package wraps the shared libraries',
  },
  // Nothing reaches the spike, and the spike reaches nothing.
  {
    from: 'probe-app',
    to: 'probe-spike',
    forbidden: true,
    why: 'an app, the shell or the template, does not load the plugin spike',
  },
  {
    from: 'probe-experience',
    to: 'probe-spike',
    forbidden: true,
    why: 'an experience does not load the plugin spike',
  },
  {
    from: 'probe-feature',
    to: 'probe-spike',
    forbidden: true,
    why: "the current app's features do not use the plugin spike",
  },
  {
    from: 'probe-module-a',
    to: 'probe-spike',
    forbidden: true,
    why: 'a module does not use the plugin spike',
  },
  {
    from: 'probe-engine',
    to: 'probe-spike',
    forbidden: true,
    why: 'an engine does not use the plugin spike',
  },
  {
    from: 'probe-foundation',
    to: 'probe-spike',
    forbidden: true,
    why: 'shared code does not use the plugin spike',
  },
  {
    from: 'probe-publishable',
    to: 'probe-spike',
    forbidden: true,
    why: 'the published package does not export the plugin spike',
  },
  {
    from: 'probe-spike',
    to: 'probe-foundation',
    forbidden: true,
    why: 'the plugin spike uses nothing of the workspace',
  },
];

/**
 * A probe that stands for a real project is proof about it only while the two carry the same tags.
 *
 * @returns {string[]} One problem per probe whose real project is missing or tagged otherwise.
 */
export function realProjectMismatches(root = ROOT) {
  const problems = [];
  for (const probe of PROBES.filter((candidate) => candidate.realProject)) {
    let project;
    try {
      project = JSON.parse(readFileSync(join(root, probe.realProject), 'utf8'));
    } catch (error) {
      problems.push(
        `${probe.name} stands for ${probe.realProject}, which cannot be read (${error.code ?? error.message}). ` +
          'If the project was removed, remove its probe and controls with it.',
      );
      continue;
    }
    const tags = Array.isArray(project.tags) ? [...project.tags].sort() : project.tags;
    if (JSON.stringify(tags) !== JSON.stringify([...probe.tags].sort())) {
      problems.push(
        `${probe.realProject} has tags ${JSON.stringify(project.tags)}, but ${probe.name}, which ` +
          `stands for it, has ${JSON.stringify(probe.tags)}: the controls would prove nothing about it`,
      );
    }
  }
  return problems;
}

/** Ends the run with an exit code and a reason, after the probe workspace is cleaned up. */
class GateStop extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function stop(code, message) {
  throw new GateStop(code, message);
}

/** The rule's severity and options, as this repository's ESLint config gives them. */
async function ruleFromConfig() {
  let config;
  try {
    ({ default: config } = await import(pathToFileURL(join(ROOT, 'eslint.config.mjs')).href));
  } catch (error) {
    stop(2, `cannot load eslint.config.mjs: ${error.message}`);
  }
  const blocks = (Array.isArray(config) ? config : []).filter(
    (block) => block?.rules && Object.hasOwn(block.rules, RULE),
  );
  if (blocks.length !== 1) {
    stop(
      2,
      `eslint.config.mjs sets ${RULE} in ${blocks.length} places; this gate reads exactly one`,
    );
  }
  const [block] = blocks;
  const [severity, options] = Array.isArray(block.rules[RULE])
    ? block.rules[RULE]
    : [block.rules[RULE]];
  if (severity !== 'error' && severity !== 2) {
    stop(
      1,
      `${RULE} is set to ${JSON.stringify(severity)}, not "error": a boundary it reported would not fail lint`,
    );
  }
  if (!Array.isArray(block.files) || !block.files.includes('**/*.ts')) {
    stop(1, `${RULE} is not applied to **/*.ts, so it does not reach the libraries' sources`);
  }
  if (!Array.isArray(options?.depConstraints) || options.depConstraints.length === 0) {
    stop(1, `${RULE} has no depConstraints, so it constrains nothing`);
  }
  return options;
}

const controlFile = (control, index) => {
  const probe = PROBES.find((candidate) => candidate.name === control.from);
  return `${probe.root}/src/control-${index + 1}-uses-${control.to}.ts`;
};

function writeProbeWorkspace(directory, options) {
  const write = (path, content) => {
    const full = join(directory, ...path.split('/'));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  };
  write('nx.json', '{}\n');
  write(
    'package.json',
    `${JSON.stringify({ name: 'module-boundaries-probe', private: true }, null, 2)}\n`,
  );
  const paths = Object.fromEntries(
    PROBES.filter((probe) => !probe.application).map((probe) => [
      `@probe/${probe.name}`,
      [`${probe.root}/src/index.ts`],
    ]),
  );
  write(
    'tsconfig.base.json',
    `${JSON.stringify({ compilerOptions: { baseUrl: '.', paths } }, null, 2)}\n`,
  );
  for (const probe of PROBES) {
    const project = {
      name: probe.name,
      projectType: probe.application ? 'application' : 'library',
      sourceRoot: `${probe.root}/src`,
      tags: probe.tags,
    };
    write(`${probe.root}/project.json`, `${JSON.stringify(project, null, 2)}\n`);
    write(`${probe.root}/src/index.ts`, `export const name = '${probe.name}';\n`);
  }
  CONTROLS.forEach((control, index) => {
    write(
      controlFile(control, index),
      `import { name } from '@probe/${control.to}';\n\nexport const uses = name;\n`,
    );
  });
  // The rule and its options exactly as this repository sets them, and nothing else.
  write(
    'eslint.config.mjs',
    [
      "import nx from '@nx/eslint-plugin';",
      "import tseslint from 'typescript-eslint';",
      '',
      'export default [',
      '  {',
      "    files: ['**/*.ts'],",
      '    languageOptions: { parser: tseslint.parser },',
      "    plugins: { '@nx': nx },",
      `    rules: { '${RULE}': ['error', ${JSON.stringify(options)}] },`,
      '  },',
      '];',
      '',
    ].join('\n'),
  );
}

/**
 * Every target Nx resolves for each real project a probe stands for that its `allowedTargets` does
 * not allow. Read from Nx rather than `project.json`, because a plugin in `nx.json` can infer a
 * target that no file declares.
 *
 * @returns {{ code: 0 | 1 | 2, problems: string[], checked: string[] }}
 */
function realProjectTargetProblems() {
  const problems = [];
  const checked = [];
  for (const probe of PROBES.filter(
    (candidate) => candidate.realProject && candidate.allowedTargets,
  )) {
    const { name } = JSON.parse(readFileSync(join(ROOT, probe.realProject), 'utf8'));
    const shown = spawnToolSync('nx', ['show', 'project', name, '--json'], {
      cwd: ROOT,
      env: { ...process.env, NX_DAEMON: 'false', NX_NO_CLOUD: 'true', NX_TUI: 'false' },
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    let targets;
    try {
      if (shown.status !== 0) throw new Error(shown.stderr || shown.error?.message);
      const json = shown.stdout.slice(shown.stdout.indexOf('{'), shown.stdout.lastIndexOf('}') + 1);
      targets = Object.entries(JSON.parse(json).targets ?? {});
    } catch (error) {
      return {
        code: 2,
        problems: [
          `nx could not show the project ${name}: ${String(error.message ?? error).trim()}`,
        ],
        checked,
      };
    }
    checked.push(`${name}'s ${targets.length} resolved targets`);
    if (targets.length === 0)
      problems.push(`nx resolves no target at all for ${name}, so none was checked`);
    for (const [target, config] of targets) {
      const command = config?.options?.command ?? '';
      const rule = probe.allowedTargets.find((candidate) => candidate.name.test(target));
      if (!rule) {
        problems.push(
          `nx resolves a \`${target}\` target for ${name} (${probe.realProject}), which only tests, ` +
            'lints and type-checks; something could build or publish it',
        );
      } else if (
        config?.executor !== rule.executor ||
        (rule.command && !rule.command.test(command))
      ) {
        problems.push(
          `nx resolves ${name}'s \`${target}\` target as ${JSON.stringify(config?.executor)}` +
            `${command ? ` (${JSON.stringify(command)})` : ''}, not ${rule.executor}` +
            `${rule.command ? ` with ${rule.command}` : ''}: a target of an allowed name could build it`,
        );
      }
    }
  }
  return { code: problems.length > 0 ? 1 : 0, problems, checked };
}

async function main() {
  const mismatches = realProjectMismatches();
  if (mismatches.length > 0) {
    console.error('module-boundaries: FAIL — a probe no longer stands for its real project:');
    for (const problem of mismatches) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }
  const targets = realProjectTargetProblems();
  if (targets.code !== 0) {
    console.error(
      'module-boundaries: FAIL — a real project a probe stands for has a target it may not:',
    );
    for (const problem of targets.problems) console.error(`  - ${problem}`);
    process.exitCode = targets.code;
    return;
  }
  let options;
  try {
    options = await ruleFromConfig();
  } catch (error) {
    if (!(error instanceof GateStop)) throw error;
    console.error(`module-boundaries: ${error.message}`);
    process.exitCode = error.code;
    return;
  }
  mkdirSync(join(ROOT, 'tmp'), { recursive: true });
  const probe = mkdtempSync(join(ROOT, 'tmp', 'module-boundaries-'));
  const env = {
    ...process.env,
    NX_DAEMON: 'false',
    NX_NO_CLOUD: 'true',
    NX_WORKSPACE_ROOT_PATH: probe,
    NX_TUI: 'false',
  };
  try {
    writeProbeWorkspace(probe, options);

    // The graph first. The rule reads a cached project graph, and without one it skips itself
    // with a warning; computing it here is what lets it run.
    const shown = spawnToolSync('nx', ['show', 'projects', '--json'], {
      cwd: probe,
      env,
      encoding: 'utf8',
    });
    if (shown.status !== 0) {
      stop(
        2,
        `nx could not read the probe workspace:\n${shown.stderr || shown.stdout || shown.error?.message}`,
      );
    }
    let projects;
    try {
      // The list, wherever nx puts it among anything else it prints.
      projects = JSON.parse(
        shown.stdout.slice(shown.stdout.indexOf('['), shown.stdout.lastIndexOf(']') + 1),
      );
    } catch {
      stop(2, `nx did not answer with a project list:\n${shown.stdout}`);
    }
    const expected = PROBES.map((p) => p.name).sort();
    if (JSON.stringify([...projects].sort()) !== JSON.stringify(expected)) {
      stop(
        2,
        `nx sees ${JSON.stringify([...projects].sort())} in the probe workspace, not ${JSON.stringify(expected)}`,
      );
    }

    const require = createRequire(join(ROOT, 'package.json'));
    const eslintManifest = require.resolve('eslint/package.json');
    const eslintBin = resolve(
      dirname(eslintManifest),
      JSON.parse(readFileSync(eslintManifest, 'utf8')).bin.eslint,
    );
    const files = CONTROLS.map(controlFile);
    const linted = spawnSync(process.execPath, [eslintBin, '--format', 'json', ...files], {
      cwd: probe,
      env,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    const output = linted.stdout ?? '';
    // The rule's own warning when it finds no graph: it then checks nothing, and lint is green.
    if (/No cached ProjectGraph is available/.test(`${output}\n${linted.stderr ?? ''}`)) {
      stop(1, `${RULE} skipped itself: it found no project graph, so it checked nothing`);
    }
    let results;
    try {
      results = JSON.parse(output.slice(output.indexOf('['), output.lastIndexOf(']') + 1));
    } catch {
      stop(
        2,
        `ESLint did not answer with results (exit ${linted.status}):\n${linted.stderr || output}`,
      );
    }

    const problems = [];
    CONTROLS.forEach((control, index) => {
      const file = resolve(probe, controlFile(control, index));
      const result = results.find((candidate) => resolve(candidate.filePath) === file);
      const subject = `${control.from} importing ${control.to} (${control.why})`;
      if (!result) {
        problems.push(`${subject}: ESLint did not lint it`);
        return;
      }
      const fatal = result.messages.filter((message) => message.fatal || message.ruleId === null);
      const reported = result.messages.filter((message) => message.ruleId === RULE);
      if (fatal.length > 0) problems.push(`${subject}: ${fatal.map((m) => m.message).join('; ')}`);
      else if (control.forbidden && reported.length === 0)
        problems.push(`${subject}: forbidden, and not reported`);
      else if (!control.forbidden && reported.length > 0) {
        problems.push(
          `${subject}: allowed, and reported: ${reported.map((m) => m.message).join('; ')}`,
        );
      }
    });

    const negative = CONTROLS.filter((control) => control.forbidden).length;
    const positive = CONTROLS.length - negative;
    if (problems.length > 0) {
      console.error(
        `module-boundaries: FAIL — ${problems.length} of ${CONTROLS.length} controls misbehaved:`,
      );
      for (const problem of problems) console.error(`  - ${problem}`);
      process.exitCode = 1;
      return;
    }
    const pluginVersion = JSON.parse(
      readFileSync(require.resolve('@nx/eslint-plugin/package.json'), 'utf8'),
    ).version;
    console.log(
      `module-boundaries: PASS — ${negative} forbidden imports reported and ${positive} allowed imports quiet, ` +
        `by ${RULE} (@nx/eslint-plugin ${pluginVersion}) with the ${options.depConstraints.length} depConstraints of eslint.config.mjs. ` +
        `Checked ${targets.checked.join(', ')}: tests, lint and type checks only.`,
    );
  } catch (error) {
    if (!(error instanceof GateStop)) throw error;
    console.error(`module-boundaries: ${error.message}`);
    process.exitCode = error.code;
  } finally {
    if (process.env.MODULE_BOUNDARIES_KEEP === '1')
      console.log(`module-boundaries: probe workspace kept at ${probe}`);
    else rmSync(probe, { recursive: true, force: true });
  }
}

await main();
