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
 * would send the password in clear text. `DEV_SERVER_URL` is the dev server `preview_package`
 * serves to, and `BUILDER_PACKAGE_ROOTS` the folders the write tools may write a package in.
 */
import { lstatSync, realpathSync } from 'node:fs';
import { delimiter, isAbsolute, relative, resolve } from 'node:path';

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

export const DEFAULT_DEV_SERVER_URL = 'http://localhost:4200';
export const DEV_SERVER_URL_ENV = 'DEV_SERVER_URL';

/**
 * The development server `preview_package` serves to, `npx nx serve nuxeo-ui`: its origin, from
 * `DEV_SERVER_URL`, or why it cannot be asked. Unset, it is the one `nx serve` starts. It must be
 * on this machine, because the files `preview_package` checks there are the ones it wrote into this
 * checkout, and a URL elsewhere would send requests off the machine for nothing.
 */
export function readDevServer(env: Environment): string | { readonly problem: string } {
  const value = env[DEV_SERVER_URL_ENV];
  const text = value === undefined || value === '' ? DEFAULT_DEV_SERVER_URL : value;
  const refuse = (why: string) => ({
    problem: `${DEV_SERVER_URL_ENV} ${why}. It is the dev server's origin, such as ${DEFAULT_DEV_SERVER_URL}.`,
  });
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return refuse('is not a URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return refuse('is not http or https');
  if (url.username !== '' || url.password !== '') return refuse('holds credentials');
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '')
    return refuse('has a path, a query or a fragment');
  if (!isThisMachine(url.hostname))
    return refuse(`names ${url.hostname}, which is not this machine; the dev server runs here`);
  return url.origin;
}

/**
 * Loopback only. Not `*.localhost`: whether such a name stays on this machine is the resolver's
 * choice, and not every resolver makes it.
 */
export function isThisMachine(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

export const PACKAGE_ROOTS_ENV = 'BUILDER_PACKAGE_ROOTS';

/**
 * What a program needs of the environment to run, and nothing more: where its programs are, a
 * temporary directory, and the locale. The pipeline and the generators are given these alone
 * (`pipelineEnvironment`), so that no credential reaches them.
 */
export const RUN_ENVIRONMENT: readonly string[] = [
  'PATH',
  'Path',
  'PATHEXT',
  'SystemRoot',
  'TMPDIR',
  'TEMP',
  'TMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
];

/** The variables the server reads, each above: the only ones of a shell it is given. */
export const SERVER_ENVIRONMENT: readonly string[] = [
  NUXEO_URL_ENV,
  NUXEO_USER_ENV,
  NUXEO_PASS_ENV,
  DEV_SERVER_URL_ENV,
  PACKAGE_ROOTS_ENV,
];

/**
 * The environment `call.ts` starts the server with: what Node needs to run it ({@link
 * RUN_ENVIRONMENT}) and the variables it reads ({@link SERVER_ENVIRONMENT}), and nothing else of
 * the shell's, no other server's password, no token, no key. The vehicle kit's first client gave
 * the server its whole environment, a token among it, and the session's permission system refused
 * it (its README, "Phase 8 feedback", item 1).
 */
export function serverEnvironment(env: Environment): Record<string, string> {
  return Object.fromEntries(
    [...RUN_ENVIRONMENT, ...SERVER_ENVIRONMENT]
      .map((key) => [key, env[key]] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] !== undefined),
  );
}

/**
 * The folders the write tools may write a package in, from `BUILDER_PACKAGE_ROOTS`, or why there
 * are none. Unset, it is `business-apps/packages/` alone. Set, its folders replace that one: each
 * a path, absolute or from the repository's root, separated as `PATH` separates them (`:`, or `;`
 * on Windows). Each must be a folder that exists, and none may hold the repository itself, so
 * that a package is never the checkout or a folder above it, nor reach a folder of the
 * repository by another spelling or through a link, which would be judged as outside it.
 */
export function readPackageRoots(
  env: Environment,
  repository: string,
  fallback: string,
): readonly string[] | { readonly problem: string } {
  const value = env[PACKAGE_ROOTS_ENV];
  if (value === undefined || value.trim() === '') return [fallback];
  const roots: string[] = [];
  for (const given of value.split(delimiter).filter((part) => part.trim() !== '')) {
    const root = resolve(repository, given);
    const refuse = (why: string) => ({
      problem: `${PACKAGE_ROOTS_ENV}: ${given} ${why}. The write tools refuse until it is fixed.`,
    });
    if (!lstatSync(root, { throwIfNoEntry: false })?.isDirectory())
      return refuse('is not a folder, or is a link to one');
    // Compared as the file system resolves them, which follows links and, where case is ignored,
    // spells each name as it is stored.
    const real = realpathSync.native(root);
    const realRepository = realpathSync.native(repository);
    if (holds(real, realRepository))
      return refuse('holds the repository, so a package there could be the checkout itself');
    // A folder of the repository reached by another spelling, or through a link, would be judged
    // as outside it, and miss the checks a root inside it has (no link, no hidden folder).
    if (holds(realRepository, real) !== holds(repository, root))
      return refuse(
        'is a folder of the repository by another spelling, or through a link. Name it from the repository, as business-apps/packages is',
      );
    roots.push(root);
  }
  return roots;
}

/** Whether `folder` is `inner` or holds it. */
function holds(folder: string, inner: string): boolean {
  const from = relative(folder, inner);
  return from === '' || (!from.startsWith('..') && !isAbsolute(from));
}
