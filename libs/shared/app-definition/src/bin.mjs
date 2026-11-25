#!/usr/bin/env node
/**
 * The command line's entry point, for Node alone: no install and no transpiler, so that the
 * package pipeline can run it where only Node is, as version 1's `build.mjs` runs.
 *
 * `typescript-hook.mjs` lets Node load the library's TypeScript as it is. Imported statically, it
 * registers its hook before the import of `cli.ts` below runs.
 *
 * It runs unconditionally: a "was I started directly?" guard is how another gate in this
 * repository once exited 0 having checked nothing. The logic, and its tests, are in `cli.ts`.
 */
import './typescript-hook.mjs';

const { main } = await import('./cli.ts');
process.exitCode = main(process.argv.slice(2), {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
});
