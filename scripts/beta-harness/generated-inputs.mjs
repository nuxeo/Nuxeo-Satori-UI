/**
 * Produce the generated files a workspace-wide `tsc` gate is about to compile.
 *
 * ## Why this exists at all
 *
 * `spec-typecheck.mjs` and `stories-typecheck.mjs` discover their tsconfigs from disk and run
 * `tsc` over each. That is deliberate — a per-project Nx target has to be added to every new
 * project and silently covers nothing when it is forgotten, which is exactly how nineteen of
 * twenty-seven projects came to have no `typecheck` target. The cost of discovering from disk is
 * the one thing a project target would have got for free: Nx's `dependsOn`.
 *
 * `typecheck`, `test`, `storybook` and `build-storybook` all declare `dependsOn: ["compodoc"]`
 * in `satori-components/project.json`. A bare `tsc` runner outside the project graph has no way
 * to declare the same thing, and `.storybook/compodoc.ts` and `.storybook/preview.ts` both import
 * the **gitignored** `documentation.json` that `compodoc` writes.
 *
 * So on a fresh clone `npm run beta:gate` was red with
 * `compodoc.ts(1,27): error TS2307: Cannot find module '../documentation.json'`, and nothing in
 * the gate could have produced it: on `main` the `typecheck` gate was `nx affected`, which
 * matched nothing, so the target that would have pulled `compodoc` in never ran either. CI never
 * saw it because `windows-gate.yml` runs `satori-components:compodoc` as an explicit step before
 * the gate — a workaround whose reason was never written down, so it read as a cache warm-up.
 *
 * ## Why one module rather than a copy per gate
 *
 * The rationale above is worth more than the fifteen lines of code under it, and this repository
 * has paid three times for the same paragraph living in two places. `satori-components/project.json`
 * already carries a `$comment` saying its `compodoc` dependants are written down twice with
 * nothing keeping them in step; a second discovering gate would have made that three. Both gates
 * now read `PREREQUISITES` from here, so a new generated input is declared once.
 *
 * ## Run unconditionally, not when the file is missing
 *
 * `dependsOn` does not check for a file either: it runs the target, and Nx's cache makes a warm
 * run a few hundred milliseconds. Skipping on presence would accept a `documentation.json` left
 * over from an older source tree, which is a worse failure than a slow one — it type-checks
 * against a stale API.
 *
 * What *is* conditional is whether the prerequisite applies to the tree being checked at all:
 * a prerequisite whose consumers are all absent has nothing to produce for. That is what lets a
 * negative control point a gate at a miniature repository under `os.tmpdir()` without needing an
 * Nx workspace in it. It is not the skip-on-presence trap above — the test is on the files that
 * *import* the generated input, never on the generated input itself.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { spawnToolSync } from './package-command.mjs';

/**
 * The `log` to pass under `--json`, where a progress line on stdout would break the parse.
 *
 * Named rather than an inline `() => {}`, which the repository's `no-empty-function` rule rejects
 * as an error — and a no-op whose emptiness is the point reads better with a name on it anyway.
 */
export const NO_PROGRESS = () => undefined;

/**
 * Generated files a discovering `tsc` gate compiles, and the Nx target that writes each one.
 *
 * `neededBy` lists the files that import it. All paths are relative to the repository root.
 */
export const PREREQUISITES = [
  {
    target: 'satori-components:compodoc',
    writes: 'libs/shared/satori-components/documentation.json',
    neededBy: [
      'libs/shared/satori-components/.storybook/compodoc.ts',
      'libs/shared/satori-components/.storybook/preview.ts',
      'libs/shared/satori-components/.storybook/api-members.spec.ts',
    ],
  },
];

/**
 * Run every prerequisite that applies to `root`, and report rather than exit.
 *
 * Reports instead of calling `process.exit` so a control can drive it in process: the one failure
 * worth controlling here is the message, and a helper that exits cannot be asked what it would
 * have said.
 *
 * @param {object} options
 * @param {string} options.root          repository to check — the gate's `--root`
 * @param {string} options.gate          name used to prefix the refusal, e.g. `stories-typecheck`
 * @param {Array}  [options.prerequisites]
 * @param {(line: string) => void} [options.log]  progress sink; pass a no-op under `--json`
 * @param {Function} [options.runTool]     injected for the controls; defaults to a real `nx run`
 * @returns {{ok: boolean, ran: string[], skipped: string[], message?: string}}
 */
export function ensureGeneratedInputs({
  root,
  gate,
  prerequisites = PREREQUISITES,
  log = NO_PROGRESS,
  runTool = spawnToolSync,
}) {
  const ran = [];
  const skipped = [];

  for (const { target, writes, neededBy } of prerequisites) {
    const consumers = neededBy.filter((file) => existsSync(resolve(root, file)));
    if (consumers.length === 0) {
      skipped.push(target);
      log(`  skip  nx run ${target}  (nothing under this root imports ${writes})`);
      continue;
    }

    log(`  prep  nx run ${target}  (writes ${writes})`);
    const proc = runTool('npx', ['nx', 'run', target], { cwd: root, encoding: 'utf8' });
    const absent = !existsSync(resolve(root, writes));
    if (proc.status !== 0 || absent) {
      return {
        ok: false,
        ran,
        skipped,
        message:
          `${gate}: could not produce ${writes}.\n` +
          `  \`nx run ${target}\` exited ${proc.status}${absent ? ' and the file is still absent' : ''}.\n` +
          `  ${consumers[0]} imports it, so every file that reaches it would fail with TS2307 —\n` +
          '  which reads as a type error in our sources rather than a missing build step. Failing here\n' +
          '  instead, because this gate cannot speak for a project whose generated inputs are missing.\n' +
          `${proc.stdout ?? ''}${proc.stderr ?? ''}`,
      };
    }
    ran.push(target);
  }

  return { ok: true, ran, skipped };
}
