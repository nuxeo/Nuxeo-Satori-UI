/**
 * Which Nuxeo server the tools read, and as whom: from the environment, and nowhere else.
 *
 * - `NUXEO_URL` is the server's origin, such as `http://localhost:8080`, as the harness's backend
 *   preflight reads it. Every request goes to `<origin>/nuxeo/api/v1/...` and to nothing else.
 *   Unset, it is the local Docker Nuxeo's.
 * - `NUXEO_USER` and `NUXEO_PASS` have no default (`scripts/beta-harness/nuxeo-credentials.mjs`
 *   says why). Without them the Nuxeo tools refuse, naming what is missing; `validate_package`
 *   needs neither, and still answers.
 *
 * Plain `http` is accepted for this machine only: Basic authentication over it to another host
 * would send the password in clear text.
 */

export const DEFAULT_NUXEO_URL = 'http://localhost:8080';
export const NUXEO_URL_ENV = 'NUXEO_URL';
export const NUXEO_USER_ENV = 'NUXEO_USER';
export const NUXEO_PASS_ENV = 'NUXEO_PASS';

export interface NuxeoTarget {
  /** The server's origin, with no path, such as `http://localhost:8080`. */
  readonly origin: string;
  readonly username: string;
  readonly password: string;
}

export type TargetOrProblem = { readonly target: NuxeoTarget } | { readonly problem: string };

type Environment = Readonly<Record<string, string | undefined>>;

/** The server and the account, or why the Nuxeo tools cannot read anything. Never a value. */
export function readTarget(env: Environment): TargetOrProblem {
  const origin = readOrigin(env[NUXEO_URL_ENV]);
  if (typeof origin !== 'string') return origin;
  const username = env[NUXEO_USER_ENV];
  const password = env[NUXEO_PASS_ENV];
  // An empty value is unset: `NUXEO_PASS=` sends '' and earns a 401 that reads like a defect.
  if (!username || !password) {
    const missing = [...(username ? [] : [NUXEO_USER_ENV]), ...(password ? [] : [NUXEO_PASS_ENV])];
    return {
      problem:
        `${NUXEO_USER_ENV} and ${NUXEO_PASS_ENV} must both be set in the server's environment` +
        ` (not set: ${missing.join(', ')}). There is deliberately no default; see the README` +
        ' for how to pass them when registering the server.',
    };
  }
  return { target: { origin, username, password } };
}

function readOrigin(value: string | undefined): string | { readonly problem: string } {
  const text = value === undefined || value === '' ? DEFAULT_NUXEO_URL : value;
  const refuse = (why: string) => ({
    problem: `${NUXEO_URL_ENV} ${why}. It is the server's origin, such as ${DEFAULT_NUXEO_URL}.`,
  });
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return refuse('is not a URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return refuse('is not http or https');
  if (url.username !== '' || url.password !== '')
    return refuse('holds credentials; they come from NUXEO_USER and NUXEO_PASS only');
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '')
    return refuse('has a path, a query or a fragment; the tools add /nuxeo/api/v1 themselves');
  if (url.protocol === 'http:' && !isThisMachine(url.hostname))
    return refuse(
      `uses http to ${url.hostname}, which would send the password in clear text; use https`,
    );
  return url.origin;
}

/**
 * Loopback only. Not `*.localhost`: whether such a name stays on this machine is the resolver's
 * choice, and not every resolver makes it.
 */
export function isThisMachine(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}
