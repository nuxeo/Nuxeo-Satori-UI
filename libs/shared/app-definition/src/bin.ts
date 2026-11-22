/**
 * The command line's entry point, and nothing else. It runs unconditionally: a "was I started
 * directly?" guard is how another gate in this repository once exited 0 having checked nothing.
 * The logic, and its tests, are in `cli.ts`.
 */
import { main } from './cli';

process.exitCode = main(process.argv.slice(2), {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
});
