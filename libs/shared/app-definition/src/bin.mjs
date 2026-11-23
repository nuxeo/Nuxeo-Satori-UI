#!/usr/bin/env node
/**
 * The command line's entry point, for Node alone: no install and no transpiler, so that the
 * package pipeline can run it where only Node is, as version 1's `build.mjs` runs.
 *
 * Node 24 strips the types from this library's TypeScript as it loads it. The library's imports
 * leave out the `.ts`, as the bundler the app is built with expects, so this hook adds it back when
 * a relative import names a file that exists only with that extension. Nothing else is resolved
 * differently.
 *
 * It runs unconditionally: a "was I started directly?" guard is how another gate in this
 * repository once exited 0 having checked nothing. The logic, and its tests, are in `cli.ts`.
 */
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(specifier, context, nextResolve) {
    let resolved;
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier) && context.parentURL) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) resolved = nextResolve(candidate.href, context);
    }
    resolved ??= nextResolve(specifier, context);
    // The library is ES modules, which the repository's package.json does not say, so Node is
    // told here rather than left to detect it file by file, with a warning each time.
    return resolved.url.endsWith('.ts') ? { ...resolved, format: 'module-typescript' } : resolved;
  },
});

const { main } = await import('./cli.ts');
process.exitCode = main(process.argv.slice(2), {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
});
