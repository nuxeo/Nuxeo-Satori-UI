/**
 * Read the file list out of `tsc -p <config> --showConfig`.
 *
 * `--showConfig` prints the config with its `include` globs already expanded into `files`, without
 * compiling anything. `stories-typecheck.mjs` uses it to ask which files a `.storybook/tsconfig.json`
 * actually covers, so it can refuse a stories file that no config reaches.
 *
 * ## Why this is its own module
 *
 * The first version of this lived inside the gate and parsed `stdout + stderr` as JSON. That is
 * wrong for a reason no local run could show: on this machine `tsc`'s stderr is empty, so the
 * concatenation happened to be valid JSON and every control passed. On the CI runner it is not —
 * `npx` writes notices there — and the gate reported `--showConfig did not emit JSON` against
 * output that visibly began with JSON, failed both configs, and then declared all 65 stories files
 * uncovered. Found by CI on the first push, which is the only place it was observable.
 *
 * So the parse is a pure function in a module of its own, and its controls hand it a stderr that
 * is not empty. A gate whose logic can only be exercised by running the real `tsc` has logic
 * nothing can see fail.
 *
 * **stdout only.** stderr is a diagnostic channel; it is kept for the failure message and never
 * fed to `JSON.parse`.
 */

/**
 * @param {object} proc  the result of `spawnToolSync('npx', ['tsc', '-p', config, '--showConfig'])`
 * @param {number|null} proc.status
 * @param {string|null} [proc.stdout]
 * @param {string|null} [proc.stderr]
 * @returns {{ok: true, files: string[]} | {ok: false, why: string}}
 *   `files` are exactly as `tsc` prints them: relative to the config's own directory.
 */
export function parseShownConfig({ status, stdout, stderr }) {
  const out = stdout ?? '';
  const err = stderr ?? '';

  /* A non-zero exit means tsc could not resolve the config at all — `TS18003: No inputs were
   * found` is the one that matters, because an `include` that has stopped matching anything is how
   * a renamed directory silently empties a compile. Report whichever channel carried the reason. */
  if (status !== 0) {
    const said = [out.trim(), err.trim()].filter(Boolean).join('\n');
    return { ok: false, why: said || `tsc exited ${status} and said nothing` };
  }

  let parsed;
  try {
    /* `JSON.parse` tolerates surrounding whitespace but not a BOM, which tsc does not emit here
     * and `trim()` would not remove anyway — so a BOM would surface through the `why` below rather
     * than silently. */
    parsed = JSON.parse(out.trim());
  } catch (error) {
    return {
      ok: false,
      why:
        `--showConfig exited 0 but its stdout is not JSON (${error.message}).\n` +
        `  stdout: ${out.trim().slice(0, 300) || '(empty)'}\n` +
        `  stderr: ${err.trim().slice(0, 300) || '(empty)'}`,
    };
  }

  /* `files` is absent when the config resolves to nothing — which `tsc --noEmit` reports as
   * TS18003 and a non-zero exit, so the gate's compile catches it. An empty list here is a
   * truthful answer to "which files does this config cover", not an error. */
  return { ok: true, files: parsed.files ?? [] };
}
