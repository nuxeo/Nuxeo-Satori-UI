/**
 * Lets Node alone load this library's TypeScript, with no install and no transpiler: importing this
 * file registers the hook, and every `.ts` imported after it loads. The command line's entry point
 * (`bin.mjs`) imports it, and so does the upgrade check (`scripts/app-upgrade-check.mjs`), which
 * reads the version rules and the registries from here.
 *
 * Node 24 strips the types from TypeScript as it loads it. The library's imports leave out the
 * `.ts`, as the bundler the app is built with expects, so this hook adds it back when a relative
 * import names a file that exists only with that extension. Nothing else is resolved differently.
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
