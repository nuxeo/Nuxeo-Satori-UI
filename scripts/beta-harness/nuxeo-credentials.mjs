/**
 * Nuxeo credentials for the Node-side harness and tooling — from the environment, with **no**
 * default.
 *
 * `.cursor/rules/security.mdc` forbids it outright: no hardcoded credentials, "NEVER use Basic
 * auth with hardcoded fallback defaults". The harness and tooling under `scripts/` and `tools/`
 * still wrote `process.env['NUXEO_USER'] ?? 'Administrator'` (and the same for `NUXEO_PASS`) in
 * the runner, the login helper, the preflight and the capture scripts, long after
 * `e2e-preflight.mjs`, `story-runner.mjs`, `phase-3-search.mjs` and `a11y/env.mjs` had each
 * removed theirs (NXSAT-649). Two reasons it matters beyond the rule:
 *
 * - It is a working Basic-auth pair compiled into the repository.
 * - Against any server that happens to accept it, a run with the variables unset silently
 *   measures as an administrator, and the evidence does not say so. Evidence of what an
 *   administrator sees is rarely the claim being made.
 *
 * So this module reads, reports and refuses; it never invents. It has no imports, so any
 * script in this repository can use it from a relative path — `helpers.mjs` wraps
 * `requireNuxeoCredentials` with its own `PreconditionError` for steps files, and the CLIs use
 * `nuxeoCredentialsOrExit`, which exits **2**: the `precondition-not-met` convention
 * `phase-runner.mjs` established — fix the environment, do not iterate on the code.
 *
 * An empty value counts as unset (`!value`, not `=== undefined`): `NUXEO_PASS=` in a shell
 * profile sets the variable to `''`, and sending that is a guaranteed 401 dressed as a pass/fail
 * question about the product.
 *
 * `checkNoNuxeoCredentialDefaults` in `scripts/review-guardrails.mjs` fails the common shapes of
 * a reintroduced fallback under `scripts/`, `tools/` and `a11y/`. That includes this file's own
 * reads through `NUXEO_USER_ENV` / `NUXEO_PASS_ENV`, which its selftest mutates to prove it; the
 * guardrail's docblock lists the shapes it does not see.
 */

export const NUXEO_USER_ENV = 'NUXEO_USER';
export const NUXEO_PASS_ENV = 'NUXEO_PASS';

/** The exit code a CLI uses when the credentials are missing — a precondition, not a defect. */
export const EXIT_PRECONDITION = 2;

/**
 * @typedef {{ username: string, password: string }} NuxeoCredentials
 */

/**
 * The pair, or `null` when either half is unset or empty. Never a default.
 *
 * @returns {NuxeoCredentials | null}
 */
export function readNuxeoCredentials() {
  const username = process.env[NUXEO_USER_ENV];
  const password = process.env[NUXEO_PASS_ENV];
  return username && password ? { username, password } : null;
}

/**
 * What to tell someone whose environment lacks the pair.
 *
 * Placeholders, not a worked example. Spelling the local dev value out as an assignment reads as
 * a hardcoded credential to both a reviewer and the secret scanner, and this repository gates
 * merges on the latter — the same choice `story-runner.mjs` made.
 *
 * @param {string} purpose completes "must both be set to …", e.g. `run the phase-6-a11y steps`
 */
export function missingNuxeoCredentialsMessage(purpose) {
  const missing = [
    ...(process.env[NUXEO_USER_ENV] ? [] : [NUXEO_USER_ENV]),
    ...(process.env[NUXEO_PASS_ENV] ? [] : [NUXEO_PASS_ENV]),
  ];
  return (
    `${NUXEO_USER_ENV} and ${NUXEO_PASS_ENV} must both be set to ${purpose}` +
    (missing.length ? ` (not set: ${missing.join(', ')}).` : '.') +
    '\n\n' +
    `    export ${NUXEO_USER_ENV}=<user> ${NUXEO_PASS_ENV}=<password>\n\n` +
    '  There is deliberately no default. A default that suits one instance is wrong on every\n' +
    '  other, it embeds a usable credential in the repository, and against a server that\n' +
    '  accepts it a run silently measures as the wrong identity. A local Nuxeo dev container\n' +
    '  uses its documented default administrator account.'
  );
}

/**
 * The pair, or a thrown error naming what is missing.
 *
 * @param {string} purpose see `missingNuxeoCredentialsMessage`
 * @param {{ errorClass?: new (message: string) => Error }} [options] the class to throw —
 *   `helpers.mjs` passes `PreconditionError`, so the runners record `precondition-not-met`
 *   rather than a defect
 * @returns {NuxeoCredentials}
 */
export function requireNuxeoCredentials(purpose, { errorClass = Error } = {}) {
  const credentials = readNuxeoCredentials();
  if (!credentials) throw new errorClass(missingNuxeoCredentialsMessage(purpose));
  return credentials;
}

/**
 * The pair, or — for a command-line entry point — the message on stderr and exit 2.
 *
 * Only for a script's own top level. A module other code imports should throw instead
 * (`requireNuxeoCredentials`), so its caller decides what a missing pair means.
 *
 * @param {string} purpose see `missingNuxeoCredentialsMessage`
 * @returns {NuxeoCredentials}
 */
export function nuxeoCredentialsOrExit(purpose) {
  const credentials = readNuxeoCredentials();
  if (credentials) return credentials;
  console.error(`\n${missingNuxeoCredentialsMessage(purpose)}\n`);
  process.exit(EXIT_PRECONDITION);
}

/**
 * The `Authorization` header value for a pair.
 *
 * @param {NuxeoCredentials} credentials
 */
export function basicAuthorization({ username, password }) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}
