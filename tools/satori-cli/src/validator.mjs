/**
 * The app definition's validator, as the tool runs it: `libs/shared/app-definition/src/cli.ts`, the
 * same `main` that `bin.mjs` runs in this repository through the TypeScript hook, bundled here into
 * plain JavaScript by `tools/satori-cli/build.mjs`, so that it needs Node alone. The pipeline runs
 * it as a command, `validate`, `model` and `changes`, as it runs `bin.mjs`.
 *
 * It runs unconditionally, as `bin.mjs` does.
 */
import { main } from '../../../libs/shared/app-definition/src/cli.ts';

process.exitCode = main(process.argv.slice(2), {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
});
