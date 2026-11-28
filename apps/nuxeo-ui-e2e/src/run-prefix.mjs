/**
 * The prefix one CI run gives the titles of the documents it creates on a shared Nuxeo.
 *
 * The pull request smoke run (`.github/workflows/e2e-smoke.yml`) writes to the same hosted Nuxeo as
 * every other run of the suite. Its specs already give each document a random suffix
 * (`uniqueTitle` in `apps/nuxeo-ui-e2e/src/e2e-data.ts`) and delete it in their own `afterEach`. The
 * prefix adds two things: a document is named for the run that made it, so a leftover can be traced
 * to its run, and the run can find everything it made, whatever happened to its specs, and trash it
 * at the end (`scripts/beta-harness/e2e-sweep.mjs`).
 *
 * Here, in the suite, rather than beside the sweep in `scripts/`: the specs import it, and a spec may
 * import only its own project's files, while a script may import anything. One module, so the
 * titles and the sweep cannot disagree on its shape.
 *
 * The sweep queries `dc:title LIKE '<prefix>%'`, so the prefix is what stands between it and every
 * document on the server. Hence the shape is strict rather than merely non-empty: lower-case letters,
 * digits and hyphens, starting `e2e-`, at least two more segments, ending in a hyphen, and long
 * enough that no title a person types begins with it. Nothing in it is special to NXQL: no quote, no
 * `%` and no `_`, so it is a literal in a `LIKE` pattern as written.
 */

export const RUN_PREFIX_ENV = 'E2E_RUN_PREFIX';

const SHAPE = /^e2e-[a-z0-9]+(?:-[a-z0-9]+)+-$/;
const MIN_LENGTH = 16;
const MAX_LENGTH = 64;

/**
 * Why `value` cannot be a run prefix, or `null` when it can.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function runPrefixProblem(value) {
  if (typeof value !== 'string' || value === '') return 'it is empty';
  if (value.length < MIN_LENGTH)
    return `it is ${value.length} characters long, under ${MIN_LENGTH}, short enough to begin a title a person typed`;
  if (value.length > MAX_LENGTH) return `it is ${value.length} characters long, over ${MAX_LENGTH}`;
  if (!SHAPE.test(value))
    return 'it is not e2e-, then hyphen-separated lower-case letters and digits in two segments or more, then a hyphen';
  return null;
}

/**
 * The run's prefix from the environment: `''` when none is set, as on a developer's machine and in
 * the nightly run, and an error when one is set but malformed, so a run never writes documents its
 * own sweep cannot find.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function runPrefix(env = process.env) {
  const value = env[RUN_PREFIX_ENV];
  if (value === undefined || value === '') return '';
  const problem = runPrefixProblem(value);
  if (problem) throw new Error(`${RUN_PREFIX_ENV} is not a usable run prefix: ${problem}.`);
  return value;
}

/**
 * The NXQL that finds what a run left: live documents whose title starts with the prefix. Versions
 * and proxies are left alone, since trashing their live document is what removes them from view.
 *
 * @param {string} prefix
 * @returns {string}
 */
export function leftoverQuery(prefix) {
  const problem = runPrefixProblem(prefix);
  if (problem) throw new Error(`No sweep with that prefix: ${problem}.`);
  return (
    `SELECT * FROM Document WHERE dc:title LIKE '${prefix}%' ` +
    'AND ecm:isTrashed = 0 AND ecm:isVersion = 0 AND ecm:isProxy = 0'
  );
}
