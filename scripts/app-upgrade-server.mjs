/**
 * The upgrade check's server half (docs/business-apps/package-pipeline.md, section 10, "On a
 * server, before the install"): given a running Nuxeo and a package about to be installed over the
 * version installed there, what the offline half cannot see. It is run by
 * `node scripts/app-upgrade-check.mjs <package> --server <address> [--previous <package>]`, which
 * imports this file and gives it the offline half's own findings.
 *
 * **Read only.** Every request is a `GET`, made by one function, {@link guardedFetch}, which
 * refuses any other method, a body, an address on another origin and any path that is not one of
 * {@link READS}; a redirect is never followed. Nothing here installs, starts, cancels, saves or
 * runs anything on the server. The report counts the reads it made, and `--json` lists each.
 *
 * **As whom.** `NUXEO_USER` and `NUXEO_PASS`, from the environment only, in an `Authorization`
 * header only, never printed. Plain HTTP only to this machine.
 *
 * **Which server.** It refuses to run, exit 2, against a server it cannot identify: one that does
 * not answer `/me` as that user (the identity guard), or answers as someone who is not an
 * administrator, since every count would then be of what they may read; one that is not a Nuxeo
 * with `nuxeo-agentic-ui`; one that has no version of the package installed, or whose installed
 * version cannot be read or is read two ways that disagree; and one whose installed version serves
 * layouts other than the package given as that version. The installed version is read where the
 * server says it:
 *
 * - **the package manager's listing,** `GET /nuxeo/site/connectClient/packages/local`, the page the
 *   platform's own Connect client serves an administrator, where a package in force is `running`.
 *   It is HTML, and its rows carry links that install and remove packages; this reads the page and
 *   follows nothing on it;
 * - **the app registry,** `GET /nuxeo/agentic-ui-apps/apps.json`, whose listing gives the app's
 *   `app.json`, and its `packageVersion`, to a person in one of the app's groups.
 *
 * `GET /nuxeo/api/v1/management/distribution` lists the package's bundle, which says it is there,
 * but at 0.0.0: Nuxeo reads a bundle's version from a Maven `pom.properties`, which a kit's jar does
 * not have.
 *
 * **What it checks,** each a finding with its severity, `error` or `warning`, and what an
 * administrator does:
 *
 * - **records** of a document type, a schema or a property the upgrade removes or changes, and of a
 *   type whose new lifecycle does not have their state, counted on the server;
 * - **page providers** the package changes, each still answering on the server with its aggregates;
 * - **workflows** still running on a route model the package replaces, which keep their old nodes;
 * - **the deployment layer:** each customer override of the app, live or a draft the layout
 *   designer saved, that the new version would no longer accept, or whose file the upgrade changes;
 * - **vocabularies** loaded from a CSV the new version changes, which the server does not load
 *   again into a vocabulary it has;
 * - **diagnostics:** what the server already reports wrong with the app, so that a new error after
 *   the upgrade can be told from an old one.
 *
 * An error makes the exit code 1, a warning leaves it alone, as the offline half's do.
 */
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import '../libs/shared/app-definition/src/typescript-hook.mjs';
import { judgeMe } from './beta-harness/identity-guard.mjs';
import {
  basicAuthorization,
  missingNuxeoCredentialsMessage,
  readNuxeoCredentials,
} from './beta-harness/nuxeo-credentials.mjs';
import { readServerModel, serverBase } from './nuxeo-content-model.mjs';
import {
  attribute,
  attributesOf,
  componentXmlOf,
  TAG,
  withoutCdata,
  withoutCommentsOrInstructions,
} from './verify-package-zip.mjs';

const REPO = resolve(import.meta.dirname, '..');
const LIBRARY = join(REPO, 'libs', 'shared', 'app-definition', 'src');
const { compareVersions, parseVersion } = await import(
  pathToFileURL(join(LIBRARY, 'lib', 'semver.ts')).href
);
const { validateDeploymentFile } = await import(
  pathToFileURL(join(LIBRARY, 'server-validator.ts')).href
);
// The Builder MCP server's readers of a page provider (tools/builder-mcp/src/page-providers.ts).
const { countParameters, isIndexed } = await import(
  pathToFileURL(join(REPO, 'tools', 'builder-mcp', 'src', 'page-providers.ts')).href
);

/** How long one read may take, and the most one may answer, as the Builder MCP server's. */
const READ_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
/** The most entries of one vocabulary read, a page of a thousand at a time. */
const VOCABULARY_PAGE = 1000;
const VOCABULARY_PAGES = 20;

/**
 * Every path this may read, below the server's address. Anything else is refused before it is
 * sent: the read-only guarantee is this list, the `GET` in {@link guardedFetch}, and nothing else.
 */
export const READS = [
  /^\/api\/v1\/me$/,
  /^\/api\/v1\/management\/distribution$/,
  /^\/api\/v1\/management\/page-providers$/,
  /^\/api\/v1\/management\/configuration$/,
  /^\/api\/v1\/config\/(?:types|facets|schemas)$/,
  /^\/api\/v1\/config\/schemas\/[^/]+$/,
  /^\/api\/v1\/search\/lang\/NXQL\/execute$/,
  /^\/api\/v1\/search\/pp\/[^/]+$/,
  /^\/api\/v1\/search\/pp\/[^/]+\/execute$/,
  /^\/api\/v1\/workflowModel$/,
  /^\/api\/v1\/directory\/[^/]+$/,
  /^\/agentic-ui-apps\/apps\.json$/,
  /^\/agentic-ui-apps\/layer\.json$/,
  /^\/agentic-ui-apps\/apps\/[a-z][a-z0-9-]{0,62}\/layer\.json$/,
  /^\/agentic-ui-apps\/apps\/[a-z][a-z0-9-]{0,62}\/layer\/(?:layouts\/[^/]+\/[^/]+\.layout\.json|queues\/[^/]+\.json)$/,
  /^\/agentic-ui-config\/layouts\.json$/,
  /^\/agentic-ui-config\/layouts\/[^/]+\/[^/]+\.layout\.json$/,
  /^\/site\/connectClient\/packages\/local$/,
];

/** What the platform's core bundle is called, which `nuxeo-agentic-ui` installs. */
const PLATFORM_BUNDLE = 'org.nuxeo.agentic.core';
/** A name this puts into NXQL: a type, a schema's prefix or property, a facet, a state. */
const NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
/** The files a deployment layer holds (`LayerPaths` in nuxeo-agentic-core), and how each is named. */
const LAYER_FILES = [
  [
    /^layouts\/([^/]+)\/(view|edit|create)\.layout\.json$/,
    (match) => `layout ${match[1]}/${match[2]}`,
  ],
  [/^queues\/([^/]+)\.json$/, (match) => `queue ${match[1]}`],
];

/** A run that cannot be made against this server: exit 2, as the offline half's command errors. */
export class Refusal extends Error {
  constructor(message) {
    super(message);
    this.name = 'Refusal';
  }
}

/**
 * The server half, for one package. `kit` is the package about to be installed and `given` the
 * package as installed, `--previous`, or `null`, as `readKit` in app-upgrade-check.mjs reads them;
 * `offline(before)` is the offline half's result for the upgrade from `before` to `kit`. Returns the
 * exit code, having printed the report.
 */
export async function serverCheck({
  server,
  kit,
  given,
  offline,
  asJson = false,
  fetchImpl = (url, init) => fetch(url, init),
}) {
  const where = serverBase(server);
  if (where.problem) throw new Refusal(`--server: ${where.problem}.`);
  // Node's fetch sends through the environment's proxy when told to: the Basic header would then
  // go to the proxy too, in clear over HTTP, whatever the address's own rule says.
  const proxied =
    !['', '0'].includes(process.env.NODE_USE_ENV_PROXY ?? '') ||
    [...process.execArgv, ...(process.env.NODE_OPTIONS ?? '').split(/\s+/)].includes(
      '--use-env-proxy',
    );
  if (proxied)
    throw new Refusal(
      "Node is told to send requests through the environment's proxy (NODE_USE_ENV_PROXY or --use-env-proxy), " +
        'which would carry the credentials there too: unset it for this command.',
    );
  const credentials = readNuxeoCredentials();
  if (!credentials)
    throw new Refusal(missingNuxeoCredentialsMessage('read the server the upgrade is checked on'));
  const reads = [];
  const nuxeo = reader(where.base, credentials, reads, fetchImpl);
  const kitModel = packageModel(kit);

  const found = await identify(nuxeo, kit, kitModel, credentials.username);
  const before = await heldTo(nuxeo, found, kit, kitModel, given);
  const beforeModel = before === kit ? kitModel : packageModel(before);
  const offlineResult = offline(before);
  // The platform's side is not compared here: what the package names of the platform is held, as
  // it was and as it is, by the offline half in CI, given --previous-platform.
  const result = {
    ...offlineResult,
    said: offlineResult.said.filter((line) => !line.startsWith('no platform as it was was given')),
  };

  const findings = [];
  const said = [
    'what the package names of the platform is held by the offline half, in CI, with --previous-platform: it is not compared here.',
  ];
  const context = {
    nuxeo,
    kit,
    before,
    kitModel,
    beforeModel,
    server: found,
    findings,
    said,
    result,
  };
  context.model = await readServerModel(where.base, credentials, { fetch: nuxeo.fetch }).catch(
    (error) => {
      if (error instanceof Refusal) throw error;
      throw new Refusal(`the server's content model could not be read: ${error.message}`);
    },
  );
  await records(context);
  await pageProviders(context);
  await workflows(context);
  await deploymentLayer(context);
  await vocabularies(context);
  diagnostics(context);
  said.push(
    `${reads.length} reads of ${where.base}, each a GET: ${[...new Set(reads.map((read) => read.path.split('?')[0]))].length} addresses.`,
  );
  return report({ where, server: found, kit, before, result, findings, said, reads }, asJson);
}

// --- Reading the server -------------------------------------------------------------------------

/**
 * The one function that sends anything to the server. A `GET` of a path {@link READS} holds, on the
 * server's own origin and below its address, with the credentials in the header and no body; a
 * redirect comes back as it is, never followed. Anything else throws before a byte is sent.
 *
 * The path is held to the list as the URL parser leaves it, which reads `..` and `%2e%2e` as moves
 * up. A percent-encoded slash, backslash or dot, or a `;`, is refused outright: Tomcat refuses an
 * encoded slash, but a proxy in front of it that decodes the path would turn it into a move up, out
 * of the addresses on the list, to one such as the Connect client's install link, which is a `GET`
 * that changes the server.
 */
export function guardedFetch(base, credentials, reads, fetchImpl) {
  const root = new URL(base);
  const authorization = basicAuthorization(credentials);
  return async (input, init = {}) => {
    const url = new URL(String(input));
    const method = String(init.method ?? 'GET').toUpperCase();
    const rest = url.pathname.startsWith(`${root.pathname}/`)
      ? url.pathname.slice(root.pathname.length)
      : null;
    if (method !== 'GET' || init.body !== undefined)
      throw new Refusal(`a ${method} with a body was about to be sent; this check only reads.`);
    if (
      url.origin !== root.origin ||
      rest === null ||
      /%(?:2f|5c|2e|3b)|;/i.test(url.pathname) ||
      !READS.some((path) => path.test(rest))
    )
      throw new Refusal(
        `${url.origin}${url.pathname} is not one of the addresses this check reads.`,
      );
    const headers = new Headers(init.headers ?? {});
    headers.set('authorization', authorization);
    if (!headers.has('accept')) headers.set('accept', 'application/json');
    reads.push({ method: 'GET', path: `${rest}${url.search}` });
    return fetchImpl(url.href, {
      method: 'GET',
      headers,
      redirect: 'manual',
      signal: init.signal ?? AbortSignal.timeout(READ_TIMEOUT_MS),
    });
  };
}

function reader(base, credentials, reads, fetchImpl) {
  const guarded = guardedFetch(base, credentials, reads, fetchImpl);
  /**
   * `GET <base><path>`: the status and the body, JSON when it parses. A read that does not answer,
   * a redirect, or an answer over the limit is a refusal: the check is not made on half a reading.
   */
  const get = async (path, { query = {}, headers = {} } = {}) => {
    const url = new URL(`${base}${path}`);
    for (const [key, value] of Object.entries(query))
      for (const each of Array.isArray(value) ? value : [value])
        if (each !== undefined) url.searchParams.append(key, String(each));
    const shown = path;
    let response;
    try {
      response = await guarded(url.href, { headers });
    } catch (error) {
      if (error instanceof Refusal) throw error;
      throw new Refusal(`GET ${shown} could not be read from ${base}: ${reason(error)}.`);
    }
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      await response.body?.cancel();
      throw new Refusal(
        `GET ${shown} answered ${response.status}, a redirect, which is not followed: only ${base} is read.`,
      );
    }
    const text = await bounded(response, shown);
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    return { status: response.status, text, body };
  };
  /** A read that must answer 200 with JSON, or the check refuses. */
  const json = async (path, options) => {
    const answer = await get(path, options);
    if (answer.status !== 200 || answer.body === null)
      throw new Refusal(
        `GET ${path} answered ${answer.status}${nuxeoMessage(answer.body)}${answer.body === null && answer.status === 200 ? ', not JSON' : ''}.`,
      );
    return answer.body;
  };
  return { base, get, json, fetch: guarded };
}

async function bounded(response, shown) {
  const tooLarge = () =>
    new Refusal(`GET ${shown} answered more than ${MAX_RESPONSE_BYTES} bytes; nothing was read.`);
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw tooLarge();
  }
  if (!response.body) return '';
  const chunks = [];
  let size = 0;
  const body = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await body.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await body.cancel();
        throw tooLarge();
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof Refusal) throw error;
    throw new Refusal(`GET ${shown} was not read whole: ${reason(error)}.`);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** The number of records an NXQL query matches, as the server counts them. */
async function count(nuxeo, nxql) {
  const answer = await nuxeo.get('/api/v1/search/lang/NXQL/execute', {
    query: { query: nxql, pageSize: 1, currentPageIndex: 0 },
    headers: { properties: 'common' },
  });
  const total = answer.body?.resultsCount;
  if (answer.status !== 200 || typeof total !== 'number' || total < 0)
    throw new Refusal(
      `the server could not count ${nxql}: it answered ${answer.status}${nuxeoMessage(answer.body)}.`,
    );
  const limit = answer.body.resultsCountLimit;
  return { count: total, atLeast: typeof limit === 'number' && limit > 0 && total >= limit };
}

const counted = ({ count: total, atLeast }) => `${atLeast ? 'at least ' : ''}${total}`;

// --- Which server, and which version is installed --------------------------------------------------

async function identify(nuxeo, kit, kitModel, username) {
  // Who the requests run as, judged by the harness's identity guard before anything else is read.
  const me = await nuxeo.get('/api/v1/me');
  const { problem } = judgeMe(
    {
      status: me.status,
      body: me.body,
      ...(me.status === 200 ? {} : { error: nuxeoMessage(me.body).slice(2) }),
    },
    username,
  );
  if (problem)
    throw new Refusal(
      `${nuxeo.base} is not identified: ${problem}. Check NUXEO_USER and NUXEO_PASS.`,
    );
  if (me.body.isAdministrator !== true)
    throw new Refusal(
      `${username} is not an administrator of ${nuxeo.base}, so every count would be of the records ` +
        'they may read, and the deployment layer and the page providers are not theirs to read. Run it as an administrator.',
    );

  const distribution = await nuxeo.json('/api/v1/management/distribution');
  const bundles = new Set(
    (Array.isArray(distribution.bundles) ? distribution.bundles : [])
      .map((bundle) => (isRecord(bundle) ? bundle.name : undefined))
      .filter((name) => typeof name === 'string'),
  );
  if (distribution['entity-type'] !== 'serverInfo' || bundles.size === 0)
    throw new Refusal(
      `${nuxeo.base}'s /management/distribution is not a Nuxeo's: it lists no bundles.`,
    );
  const nuxeoVersion =
    text(distribution.distributionVersion) ?? text(distribution.applicationVersion);
  if (!bundles.has(PLATFORM_BUNDLE))
    throw new Refusal(
      `${nuxeo.base} is Nuxeo ${nuxeoVersion ?? '(no version)'} with no ${PLATFORM_BUNDLE}: nuxeo-agentic-ui is not installed there.`,
    );
  if (kitModel.bundle === null)
    throw new Refusal(`${kit.shown}: bundle/META-INF/MANIFEST.MF names no Bundle-SymbolicName.`);
  if (!bundles.has(kitModel.bundle))
    throw new Refusal(
      `${nuxeo.base} has no bundle ${kitModel.bundle}: ${kit.name} is not installed there, so there is no ` +
        'installed version to check an upgrade from. A first install keeps every configuration: it needs no check.',
    );

  // The installed version, from the package manager and from the app registry.
  const sources = [];
  const problems = [];
  // Asked for the package's own type: with none, the page applies the filter an administrator last
  // chose in the Admin Center, which could hide the kit's row. The parameter is read, not stored.
  const listing = await nuxeo.get('/site/connectClient/packages/local', {
    query: { type: kitModel.type ?? undefined },
    headers: { accept: 'text/html', 'accept-language': 'en' },
  });
  if (listing.status !== 200 || !/<tr\b/.test(listing.text))
    problems.push(
      `the package manager's listing, /site/connectClient/packages/local, answered ${listing.status}`,
    );
  else {
    const rows = packageRows(listing.text, kit.name);
    const unknown = rows.filter((row) => row.state === null);
    if (unknown.length > 0)
      throw new Refusal(
        `the package manager lists ${kit.name} ${list(unknown.map((row) => row.version))} in a state this does not know, ` +
          'such as an install in progress: check the upgrade once the server says it is running.',
      );
    const running = rows.filter((row) => row.state === 'running' || row.state === 'started');
    const waiting = rows.filter((row) => row.state === 'installed');
    if (running.length === 1)
      sources.push({ from: 'the package manager', version: running[0].version });
    else if (running.length > 1)
      throw new Refusal(
        `the package manager lists ${list(running.map((row) => row.version))} of ${kit.name} running at once, so which is installed is not known.`,
      );
    else if (waiting.length > 0)
      throw new Refusal(
        `the package manager lists ${kit.name} ${list(waiting.map((row) => row.version))} installed, waiting for a restart: ` +
          'the server does not run it yet. Restart it, then check the upgrade.',
      );
    else problems.push(`the package manager lists no ${kit.name} running`);
  }
  const app = text(kit.files.get('app.json')?.id);
  const listed = await nuxeo.get('/agentic-ui-apps/apps.json');
  const registry =
    listed.status === 200 && isRecord(listed.body) ? listed.body : { apps: [], diagnostics: [] };
  const entry = (Array.isArray(registry.apps) ? registry.apps : []).find(
    (each) => isRecord(each) && each.id === app,
  );
  if (listed.status !== 200)
    problems.push(`the app registry, /agentic-ui-apps/apps.json, answered ${listed.status}`);
  else if (app === undefined)
    problems.push(`${kit.shown} has no app.json, so the app registry was not asked`);
  else if (entry === undefined)
    problems.push(
      `the app registry lists no app ${app} to ${username}, who is in none of its groups, or it is not served`,
    );
  else if (entry.bundle !== kitModel.bundle)
    problems.push(
      `the app registry serves ${app} from ${entry.bundle}, not from ${kitModel.bundle}`,
    );
  else if (typeof entry.content?.packageVersion === 'string')
    sources.push({ from: 'the app registry', version: entry.content.packageVersion });
  if (sources.length === 0)
    throw new Refusal(
      `the version of ${kit.name} installed on ${nuxeo.base} cannot be read: ${problems.join('; ')}.`,
    );
  const versions = [...new Set(sources.map((source) => source.version))];
  if (versions.length > 1)
    throw new Refusal(
      `${sources.map((source) => `${source.from} says ${source.version}`).join(' and ')}: which version of ${kit.name} ` +
        'is installed is not known. A server not restarted since an install, or another package that contributes the app, does this.',
    );
  if (!parseVersion(versions[0]))
    throw new Refusal(
      `the version of ${kit.name} installed, ${versions[0]}, is not a semantic version.`,
    );
  return {
    user: me.body.id,
    nuxeo: nuxeoVersion,
    errors: (Array.isArray(distribution.errors) ? distribution.errors : [])
      .map((error) => (isRecord(error) ? text(error.message) : text(error)))
      .filter(Boolean),
    installed: versions[0],
    from: sources.map((source) => source.from),
    unread: problems,
    app,
    registry,
    registryRead: listed.status === 200 && isRecord(listed.body),
  };
}

/**
 * The rows of the package manager's listing for one package: its versions and their states, as
 * `simpleListing.ftl` writes them, `row_<id>` and a cell with the state. A package in force is
 * `running` there, in any language; the other states are English with `accept-language: en`.
 */
function packageRows(html, name) {
  const rows = [];
  for (const [, id, row] of html.matchAll(/<tr\b[^>]*\bid="row_([^"]+)"[^>]*>([\s\S]*?)<\/tr>/g)) {
    if (!id.startsWith(`${name}-`)) continue;
    const version = id.slice(name.length + 1);
    if (!parseVersion(version)) continue;
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(([, cell]) =>
      cell
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .trim()
        .toLowerCase(),
    );
    const state = cells.find((cell) =>
      [
        'running',
        'started',
        'installed',
        'installing',
        'downloaded',
        'downloading',
        'remote',
        'unknown',
      ].includes(cell),
    );
    rows.push({ version, state: state ?? null });
  }
  return rows;
}

/**
 * The package the upgrade is held to: `--previous` when it is given, which must be the version
 * installed; the package itself when it is that version; otherwise a refusal, since what was
 * installed cannot be compared with. Then what the server serves of it must be that package.
 */
async function heldTo(nuxeo, server, kit, kitModel, given) {
  const installed = server.installed;
  let before;
  if (given !== null) {
    if (given.name !== kit.name)
      throw new Refusal(`--previous is ${given.name}, and the package is ${kit.name}.`);
    if (given.version !== installed)
      throw new Refusal(
        `--previous is ${kit.name} ${given.version}, and the server has ${installed} installed: give the package as installed.`,
      );
    before = given;
  } else if (kit.version === installed) before = kit;
  else
    throw new Refusal(
      `the server has ${kit.name} ${installed} installed, and the package is ${kit.version}: give the package ` +
        `as installed with --previous, such as the kit at its tag app-package/${kit.name}/${installed}, so that ` +
        'what the upgrade changes can be known.',
    );
  const order = compareVersions(parseVersion(kit.version), parseVersion(installed));
  if (order < 0)
    throw new Refusal(
      `${kit.name} ${kit.version} is older than the ${installed} installed: this checks an upgrade, not a downgrade.`,
    );

  // What the server serves of the installed version must be the package it is held to: a layout
  // of its bundle that differs says the server runs another build of that version.
  const index = await nuxeo.json('/agentic-ui-config/layouts.json');
  const theirs = (Array.isArray(index.layouts) ? index.layouts : []).filter(
    (layout) => isRecord(layout) && layout.bundle === kitModel.bundle,
  );
  const another = (what) =>
    new Refusal(
      `the server's ${kit.name} ${installed} ${what}, so it is another build of ${installed} than ${before.shown}, ` +
        'the package the upgrade is held to. ' +
        (before === kit
          ? 'nuxeoctl mp-install skips a version already installed as unchanged: remove it first (administrator guide, section 5). '
          : '') +
        'Give --previous the package as it was built and installed.',
    );
  for (const layout of theirs) {
    if (!NAME.test(layout.type ?? '') || !NAME.test(layout.mode ?? ''))
      throw new Refusal(
        `/agentic-ui-config/layouts.json names a layout "${layout.type}/${layout.mode}", which this does not ask for.`,
      );
    // The file the layout was read from, as the server says it, below the package's
    // agentic-ui-config/; otherwise the place the pipeline gives a layout.
    const path =
      typeof layout.source === 'string' && layout.source.startsWith('agentic-ui-config/')
        ? layout.source.slice('agentic-ui-config/'.length)
        : `layouts/${layout.type}/${layout.mode}.layout.json`;
    if (!before.files.has(path))
      throw another(
        `serves the ${layout.mode} layout of ${layout.type} records from ${path}, which the package does not have`,
      );
    const served = await nuxeo.json(
      `/agentic-ui-config/layouts/${segment(layout.type)}/${segment(layout.mode)}.layout.json`,
    );
    if (canonical(served.content) !== canonical(before.files.get(path)))
      throw another(`serves ${path} otherwise than the package does`);
  }
  return before;
}

// --- Records -------------------------------------------------------------------------------------

/**
 * Records of a type, a schema or a property the upgrade removes or changes, and of a type whose new
 * lifecycle does not have their state, counted on the server.
 */
async function records({ nuxeo, kit, kitModel, beforeModel, model, findings, said, result }) {
  const noteFor = (item) => {
    const note = result.covered.find((each) => each.item === item)?.note;
    return note ? ` The kit's note for ${item}, at ${note.version}: ${note.note}` : '';
  };
  const add = (item, found, what, steps) => {
    if (found.count === 0) {
      said.push(`no record holds ${item}, which the upgrade ${what}.`);
      return;
    }
    findings.push({
      severity: 'error',
      check: 'records',
      item,
      what: `${counted(found)} record(s) on the server ${steps.what}`,
      steps: `${steps.do}${noteFor(item)}`,
    });
  };
  const serverSchemas = new Map(
    (model.schemas ?? []).filter(isRecord).map((schema) => [schema.name, schema]),
  );
  const carriers = (schema) => ({
    types: Object.entries(model.doctypes ?? {})
      .filter(
        ([, type]) =>
          isRecord(type) && Array.isArray(type.schemas) && type.schemas.includes(schema),
      )
      .map(([name]) => name),
    facets: (model.facets ?? [])
      .filter(
        (facet) =>
          isRecord(facet) &&
          Array.isArray(facet.schemas) &&
          facet.schemas.some((each) => (isRecord(each) ? each.name : each) === schema),
      )
      .map((facet) => facet.name),
  });
  // A type the package appends to, a platform's such as File, is not the package's to remove.
  const removedTypes = [...beforeModel.doctypes]
    .filter(([type, was]) => !was.append && !kitModel.doctypes.has(type))
    .map(([type]) => type);

  for (const type of removedTypes)
    add(
      `type ${type}`,
      await count(nuxeo, `SELECT * FROM Document WHERE ecm:primaryType = ${quoted(type)}`),
      'removes',
      {
        what: `are of the type ${type}, which ${kit.name} ${kit.version} no longer has: once it is gone they cannot be read, and they break the folders and the searches that hold them. Versions and trashed records are counted.`,
        do: `Before installing, copy what they hold into records of a type the new version has, then delete them and empty them from the trash (administrator guide, section 6).`,
      },
    );

  for (const [name, schema] of beforeModel.schemas) {
    const now = kitModel.schemas.get(name);
    if (now === undefined) {
      const { types, facets } = carriers(name);
      const live = types.filter((type) => !removedTypes.includes(type));
      if (live.length === 0 && facets.length === 0) {
        said.push(
          `no type or facet on the server carries the schema ${name}, which the upgrade removes.`,
        );
        continue;
      }
      add(
        `schema ${name}`,
        await count(
          nuxeo,
          `SELECT * FROM Document WHERE ${anyOf('ecm:primaryType', live, 'ecm:mixinType', facets)}`,
        ),
        'removes',
        {
          what: `carry the schema ${name}, which ${kit.name} ${kit.version} no longer has: what its properties hold stays in the repository, read by nothing.`,
          do: `Before installing, copy what they hold of ${schema.prefix}: into properties the new version has, if it is wanted.`,
        },
      );
      continue;
    }
    if (schema.properties === null || now.properties === null) continue;
    const fields = isRecord(serverSchemas.get(name)?.fields) ? serverSchemas.get(name).fields : {};
    for (const [property, was] of schema.properties) {
      const xpath = `${schema.prefix}:${property}`;
      const is = now.properties.get(property);
      if (is !== undefined && is.text === was.text) continue;
      if (!Object.hasOwn(fields, property)) {
        said.push(`the server's schema ${name} has no ${xpath}, so no record holds a value of it.`);
        continue;
      }
      const operand = valueOf(xpath, fields[property]);
      if (operand === null) {
        said.push(`${xpath} is a complex property, whose values are not counted.`);
        continue;
      }
      if (is === undefined || is.base !== was.base) {
        add(
          `property ${xpath}`,
          await count(nuxeo, `SELECT * FROM Document WHERE ${operand} IS NOT NULL`),
          is === undefined ? 'removes' : 'changes',
          {
            what:
              is === undefined
                ? `hold a value of ${xpath}, which the new version's schema ${name} no longer has: the value stays in the repository, read by no layout, queue or search.`
                : `hold a value of ${xpath}, whose type changes from ${was.base} to ${is.base}: a value the new type cannot hold fails to load.`,
            do:
              is === undefined
                ? 'Before installing, copy each value into a property the new version has, if it is wanted.'
                : 'Before installing, convert each value to one the new type holds, or clear it.',
          },
        );
        continue;
      }
      // The same type with other constraints: only an enumeration that no longer allows a value is
      // counted, and it is a warning, since the value still loads.
      const gone =
        was.values === null ? null : was.values.filter((value) => !is.values?.includes(value));
      if (is.values === null || (gone !== null && gone.length === 0)) {
        said.push(
          `${xpath}'s constraints change, and no enumeration is narrowed: nothing is counted.`,
        );
        continue;
      }
      if (![...is.values, ...(gone ?? [])].every((value) => LITERAL.test(value))) {
        said.push(
          `${xpath}'s enumeration holds a value NXQL is not given here, so it is not counted.`,
        );
        continue;
      }
      const narrowed = {
        held:
          gone === null
            ? `${operand} IS NOT NULL AND ${operand} NOT IN (${is.values.map((value) => `'${value}'`).join(', ')})`
            : `${operand} IN (${gone.map((value) => `'${value}'`).join(', ')})`,
        gone,
      };
      const outside = await count(nuxeo, `SELECT * FROM Document WHERE ${narrowed.held}`);
      if (outside.count === 0) {
        said.push(
          `no record holds a value of ${xpath} the new version's enumeration no longer allows.`,
        );
        continue;
      }
      findings.push({
        severity: 'warning',
        check: 'records',
        item: `property ${xpath}`,
        what:
          `${counted(outside)} record(s) on the server hold a value of ${xpath} the new version's enumeration no longer allows` +
          `${narrowed.gone ? ` (${list(narrowed.gone)})` : ` (it allows ${list(is.values)})`}: the value still loads, and is no longer one the schema allows.`,
        steps: `Change each to a value the new version allows, before or after installing.${noteFor(`property ${xpath}`)}`,
      });
    }
  }

  // A type that keeps its name and loses a schema leaves that schema's values behind; so does a
  // platform's type the package stops appending a schema to.
  for (const [type, was] of beforeModel.doctypes) {
    const is = kitModel.doctypes.get(type) ?? (was.append ? { schemas: [] } : undefined);
    if (is === undefined) continue;
    // A schema the package removes outright is said once, above, with every type that carries it.
    for (const schema of was.schemas.filter(
      (each) =>
        !is.schemas.includes(each) &&
        !(beforeModel.schemas.has(each) && !kitModel.schemas.has(each)),
    )) {
      add(
        `type ${type}`,
        await count(nuxeo, `SELECT * FROM Document WHERE ecm:primaryType = ${quoted(type)}`),
        'changes',
        {
          what: `are of the type ${type}, which no longer carries the schema ${schema}: what they hold there stays in the repository, read by nothing.`,
          do: `Before installing, copy what they hold of ${schema} into properties the new version's ${type} has, if it is wanted.`,
        },
      );
    }
  }

  // A lifecycle the new version gives a type: a record in a state it does not have has no way out,
  // and one in a state it keeps only as a way in waits there until someone follows its transition.
  for (const [type, policy] of kitModel.lifecycleOf) {
    const lifecycle = kitModel.lifecycles.get(policy);
    if (
      lifecycle === undefined ||
      !kitModel.doctypes.has(type) ||
      kitModel.doctypes.get(type).append
    )
      continue;
    const states = [...lifecycle.states.keys()];
    const outside = await count(
      nuxeo,
      `SELECT * FROM Document WHERE ecm:primaryType = ${quoted(type)} AND ecm:currentLifeCycleState NOT IN (${states.map(quoted).join(', ')})`,
    );
    if (outside.count > 0)
      findings.push({
        severity: 'error',
        check: 'records',
        item: `lifecycle ${type}`,
        what: `${counted(outside)} record(s) of the type ${type} are in a state the lifecycle ${policy} of ${kit.name} ${kit.version} does not have (${list(states)}): no transition leads them out of it.`,
        steps: `Before installing, follow a transition that brings each into one of those states, or give the lifecycle the state they are in.${noteFor(`type ${type}`)}`,
      });
    else said.push(`every record of the type ${type} is in a state the lifecycle ${policy} has.`);
    for (const [state, { initial, out }] of lifecycle.states) {
      if (initial || lifecycle.destinations.has(state)) continue;
      const waiting = await count(
        nuxeo,
        `SELECT * FROM Document WHERE ecm:primaryType = ${quoted(type)} AND ecm:currentLifeCycleState = ${quoted(state)}`,
      );
      if (waiting.count === 0) continue;
      findings.push({
        severity: 'warning',
        check: 'records',
        item: `lifecycle ${type}/${state}`,
        what: `${counted(waiting)} record(s) of the type ${type} are in ${state}, which the lifecycle ${policy} keeps only as a way in: no transition leads to it, and none starts there. They wait until someone follows ${list(out, 'a transition', 'or')}.`,
        steps: `Follow ${list(out, 'its transition', 'or')} for each, as the kit's README says for records made before the lifecycle.`,
      });
    }
  }
}

/**
 * What NXQL compares for a value of `xpath`, given the field as the server describes it, `"string[]"`
 * or, read with `fetch-schema: fields`, `{ "type": "string[]", ... }`: the property, each item of a
 * list, a blob's data; `null` for a complex property, whose values are not counted.
 */
function valueOf(xpath, field) {
  const parts = xpath.split(':');
  if (parts.length !== 2 || !NAME.test(parts[0]) || !NAME.test(parts[1]))
    throw new Refusal(`${xpath} is not a name NXQL is given here.`);
  const type = isRecord(field) ? field.type : field;
  if (typeof type !== 'string' || type.startsWith('complex')) return null;
  if (type === 'blob') return `${xpath}/data`;
  if (type === 'blob[]') return `${xpath}/*/data`;
  return type.endsWith('[]') ? `${xpath}/*` : xpath;
}

/** An enumeration's value this puts into NXQL, between quotes. */
const LITERAL = /^[A-Za-z0-9 _.:@/+-]*$/;

function anyOf(typeField, types, facetField, facets) {
  const parts = [];
  if (types.length > 0) parts.push(`${typeField} IN (${types.map(quoted).join(', ')})`);
  if (facets.length > 0) parts.push(`${facetField} IN (${facets.map(quoted).join(', ')})`);
  return parts.length === 1 ? parts[0] : `(${parts.join(' OR ')})`;
}

function quoted(name) {
  if (!NAME.test(name)) throw new Refusal(`"${name}" is not a name NXQL is given here.`);
  return `'${name}'`;
}

// --- Page providers ---------------------------------------------------------------------------------

/** Each page provider the package changes, still answering on the server with its aggregates. */
async function pageProviders({ nuxeo, kit, kitModel, beforeModel, findings, said }) {
  const changed = [...kitModel.pageProviders].filter(([name, provider]) => {
    const was = beforeModel.pageProviders.get(name);
    return was !== undefined && was.xml !== provider.xml;
  });
  if (changed.length === 0) {
    said.push('the upgrade changes no page provider the server has.');
    return;
  }
  // Which search client answers each: a help for the finding's text, not what is checked.
  const listing = await nuxeo.get('/api/v1/management/page-providers');
  if (listing.status !== 200)
    said.push(
      `/api/v1/management/page-providers answered ${listing.status}: which search client answers each page provider is not said.`,
    );
  const indexed = new Map(
    (Array.isArray(listing.body) ? listing.body : [])
      .filter((entry) => isRecord(entry) && typeof entry.name === 'string')
      .map((entry) => [entry.name, isIndexed(entry)]),
  );
  const named = namedProviders(kit);
  for (const [name, provider] of changed) {
    const item = `page-provider ${name}`;
    const definition = await nuxeo.get(`/api/v1/search/pp/${segment(name)}`);
    // Nuxeo 2025 answers a name it does not have 200 with the body null (the Builder MCP server's
    // describePageProvider says so); any other failure is a read not made.
    if (definition.status === 404 || (definition.status === 200 && definition.body === null)) {
      said.push(
        `the server has no page provider ${name} yet, so it is answered only after the upgrade.`,
      );
      continue;
    }
    if (definition.status !== 200 || !isRecord(definition.body))
      throw new Refusal(
        `/api/v1/search/pp/${name} answered ${definition.status}${nuxeoMessage(definition.body)}.`,
      );
    const theirs = new Set(
      (Array.isArray(definition.body.aggregates) ? definition.body.aggregates : [])
        .filter(isRecord)
        .map((aggregate) => aggregate.id),
    );
    const query = definition.body.whereClause?.fixedPart ?? definition.body.pattern ?? '';
    const wanted = countParameters(typeof query === 'string' ? query : '');
    const by = named.get(name);
    const parameters = by?.parameters ?? [];
    // Only parameters a queue or a home figure gives as they are: one a related list fills from
    // its record, `{...}`, or that is not text, has no value here, and would shift the others.
    if (by?.literal === false) {
      said.push(`${name} is given a parameter filled from a record, so it was not run.`);
      continue;
    }
    if (wanted > parameters.length) {
      said.push(
        `${name} takes ${wanted} parameter(s), and no queue or home figure of the package gives them, so it was not run.`,
      );
      continue;
    }
    const run = await nuxeo.get(`/api/v1/search/pp/${segment(name)}/execute`, {
      query: { pageSize: 1, currentPageIndex: 0, queryParams: parameters },
      headers: { properties: 'common' },
    });
    const from = by ? ` ${list([...by.files])} read${by.files.size === 1 ? 's' : ''} it.` : '';
    if (run.status !== 200 || !isRecord(run.body)) {
      findings.push({
        severity: 'error',
        check: 'page-providers',
        item,
        what: `The server does not answer ${name}: ${run.status}${nuxeoMessage(run.body)}.${from}`,
        steps: `Before installing, find why the server refuses it, in server.log: after the upgrade its queues and home figures show nothing either.`,
      });
      continue;
    }
    const answered = isRecord(run.body.aggregations) ? run.body.aggregations : {};
    if (provider.aggregates.length === 0)
      said.push(`the server answers ${name}, which has no aggregate.`);
    // A new version that moves the page provider to another class, such as the search index's,
    // answers its aggregates only once it is installed.
    const moves = (beforeModel.pageProviders.get(name)?.class ?? null) !== provider.class;
    for (const aggregate of provider.aggregates) {
      if (!theirs.has(aggregate.id)) {
        said.push(
          `${name}'s aggregate ${aggregate.id} is new in ${kit.version}: the server answers it only after the upgrade.`,
        );
        continue;
      }
      if (isRecord(answered[aggregate.id])) continue;
      const repository = indexed.get(name) === false;
      if (moves) {
        said.push(
          `the server answers ${name} without its aggregate ${aggregate.id}, and ${kit.version} gives it the class ${provider.class ?? '(none)'}: it is answered as the new version says only after the upgrade.`,
        );
        continue;
      }
      findings.push({
        severity: 'error',
        check: 'page-providers',
        item,
        what:
          `The server answers ${name} without its aggregate ${aggregate.id}${repository ? ': it is answered by the repository, which answers no aggregate' : ''}, ` +
          `so the facets and home figures that read it show nothing.${from}`,
        steps:
          "Aggregates come from the search index: answer the page provider from it, as the kit's own are (a SearchServicePageProvider with the index as its search client), before installing.",
      });
    }
  }
}

/** Each page provider the package's files name, with the parameters a queue or a figure gives it. */
function namedProviders(kit) {
  const named = new Map();
  for (const [place, content] of kit.files)
    walk(content, (value) => {
      if (!isRecord(value) || typeof value.pageProvider !== 'string') return;
      const entry = named.get(value.pageProvider) ?? {
        files: new Set(),
        parameters: undefined,
        literal: true,
      };
      entry.files.add(`bundle/agentic-ui-config/${place}`);
      if (entry.parameters === undefined && Array.isArray(value.parameters)) {
        entry.parameters = value.parameters;
        entry.literal = value.parameters.every(
          (each) => typeof each === 'string' && !each.includes('{'),
        );
      }
      named.set(value.pageProvider, entry);
    });
  return named;
}

// --- Workflows ------------------------------------------------------------------------------------

/** Workflows still running on a route model the package replaces, which keep their old nodes. */
async function workflows({ nuxeo, kit, kitModel, beforeModel, findings, said }) {
  const replaced = [...kitModel.routeModels].filter(([id, digest]) => {
    const was = beforeModel.routeModels.get(id);
    return was !== undefined && was !== digest;
  });
  if (replaced.length === 0) {
    said.push('the upgrade replaces no route model.');
    return;
  }
  const listed = await nuxeo.json('/api/v1/workflowModel');
  const models = (Array.isArray(listed.entries) ? listed.entries : []).filter(isRecord);
  for (const [id] of replaced) {
    const model = models.find((each) => each.name === id);
    if (model === undefined || typeof model.id !== 'string' || !UUID.test(model.id)) {
      said.push(
        `the server has no route model ${id}: it is imported at the next start, with nothing running on it.`,
      );
      continue;
    }
    const running = await count(
      nuxeo,
      `SELECT * FROM DocumentRoute WHERE docri:modelId = '${model.id}' AND ecm:currentLifeCycleState NOT IN ('done', 'canceled') AND ecm:isVersion = 0`,
    );
    if (running.count === 0) {
      said.push(`no workflow runs on the route model ${id}, which the upgrade replaces.`);
      continue;
    }
    findings.push({
      severity: 'error',
      check: 'workflows',
      item: `route-model ${id}`,
      what:
        `${counted(running)} workflow(s) of ${id} are running on the model the server has. ${kit.name} ${kit.version} replaces it, ` +
        'and a workflow keeps the nodes it was started with: what the new version changes in its steps does not reach them, as Payers ' +
        "0.6.1's supervisor step's variables facet did not reach a workflow started under 0.6.0.",
      steps:
        `Before installing, let them finish; or, as an administrator, cancel each, DELETE /nuxeo/api/v1/workflow/<id> for those ` +
        `GET /nuxeo/api/v1/workflow?workflowModelName=${id} lists, and start them again after the upgrade. The kit's README says which, for its version.`,
    });
  }
}

// --- The deployment layer -------------------------------------------------------------------------

/**
 * Each override of the app's files in the server's deployment layer, live or a draft the layout
 * designer saved: one the new version would no longer accept, and one whose file the upgrade
 * changes, which the override keeps winning over.
 */
async function deploymentLayer({
  nuxeo,
  kit,
  kitModel,
  beforeModel,
  model,
  server,
  findings,
  said,
}) {
  const exported = await nuxeo.get('/agentic-ui-apps/layer.json');
  if (exported.status === 404 && exported.body?.error === 'not-found') {
    said.push(
      `the deployment layer is switched off on this server: no override of ${server.app ?? 'the app'} to hold to the new version.`,
    );
    return;
  }
  if (
    exported.status !== 200 ||
    exported.body?.format !== 'nuxeo-agentic-ui-layer/1' ||
    !Array.isArray(exported.body.apps)
  )
    throw new Refusal(
      `the deployment layer's export, /agentic-ui-apps/layer.json, answered ${exported.status}${nuxeoMessage(exported.body)}.`,
    );
  if (server.app === undefined) {
    said.push('the package has no app, so no layer of one is read.');
    return;
  }
  // The export lists the files whose override is in force; the app's summary also lists those
  // with only a draft, which the layout designer saved and nobody has published.
  const app = exported.body.apps.find((each) => isRecord(each) && each.id === server.app);
  const versions = new Map(
    (Array.isArray(app?.files) ? app.files.filter(isRecord) : []).map((file) => [
      file.path,
      file.version,
    ]),
  );
  const summary = await nuxeo.get(`/agentic-ui-apps/apps/${segment(server.app)}/layer.json`);
  if (summary.status === 200 && Array.isArray(summary.body?.files)) {
    for (const file of summary.body.files.filter(isRecord))
      if (!versions.has(file.path) && (file.draft !== null || Number(file.live) > 0))
        versions.set(file.path, Number(file.live) > 0 ? Number(file.live) : null);
  } else if (!(summary.status === 404 && summary.body?.error === 'not-found'))
    throw new Refusal(
      `the app's deployment layer, /agentic-ui-apps/apps/${server.app}/layer.json, answered ${summary.status}${nuxeoMessage(summary.body)}.`,
    );
  if (versions.size === 0) {
    said.push(
      `the deployment layer overrides none of ${server.app}'s files, and holds no draft of one.`,
    );
    return;
  }
  // The content model the server has after the upgrade, and what the deployment registers in code:
  // the validator is given both, as the server gives them (NashornDeploymentValidator).
  const after = modelAfter(model, beforeModel, kitModel);
  const registered = await registeredIds(nuxeo);
  const definition = {
    app: kit.files.get('app.json') ?? null,
    actions: kit.files.get('actions.json') ?? null,
    registered,
  };
  for (const [path, version] of versions) {
    const name = layerItem(path);
    if (name === undefined)
      throw new Refusal(
        `the deployment layer names ${JSON.stringify(path)}, which is no file of a layer.`,
      );
    const file = { path, version };
    const state = await nuxeo.json(
      `/agentic-ui-apps/apps/${segment(server.app)}/layer/${path.split('/').map(segment).join('/')}`,
    );
    const ours = kit.files.get(file.path);
    const packaged = isRecord(state.package) ? state.package.content : undefined;
    const inForce = isRecord(state.live);
    if (canonical(packaged) !== canonical(ours))
      findings.push({
        severity: 'warning',
        check: 'layer',
        item: name,
        what:
          `${kit.name} ${kit.version} ${packaged === undefined ? 'adds' : ours === undefined ? 'removes' : 'changes'} ${file.path}, which this server's ` +
          (inForce
            ? `deployment layer overrides at version ${state.live.version ?? file.version}. The override keeps winning, so ${server.app}'s people see none of the kit's change.`
            : "deployment layer holds a draft of, which does not have the kit's change: approved after the upgrade, it replaces the package's file with one that lacks it."),
        steps: !inForce
          ? ours === undefined
            ? 'The package no longer has the file: approved after the upgrade, the draft would be its only version. Discard it, or approve it knowing that.'
            : "After the upgrade, take the kit's change into the draft in the layout designer before it is approved, or discard it."
          : ours === undefined
            ? 'After the upgrade the override is the only version of the file: keep it, or roll it back to drop it.'
            : "After the upgrade, open the file in the layout designer and take the kit's change into a new draft, or roll the override back to the package's version.",
      });
    if (state.packageChanged === true)
      findings.push({
        severity: 'warning',
        check: 'layer',
        item: name,
        what: `The override of ${file.path} was made on another version of the kit's file than the one in force now: it may undo what an upgrade before this one brought.`,
        steps:
          "Compare the override with the package's file in the layout designer, before or after the upgrade.",
      });
    for (const [which, version] of [
      ['live', isRecord(state.live) ? state.live : null],
      ['draft', isRecord(state.draft) ? state.draft : null],
    ]) {
      if (version === null || version.content === undefined) continue;
      const answer = validateDeploymentFile({
        path: file.path,
        content: version.content,
        model: after,
        ...definition,
      });
      const problems =
        'refused' in answer
          ? [answer.refused]
          : answer.findings.map((each) => `${each.path || '(the file)'}: ${each.message}`);
      if (problems.length === 0) continue;
      findings.push(
        which === 'live'
          ? {
              severity: 'error',
              check: 'layer',
              item: name,
              what:
                `The override of ${file.path} in force, version ${version.version ?? file.version}, does not fit ${kit.name} ${kit.version}: ${problems.slice(0, 3).join('; ')}` +
                `${problems.length > 3 ? `, and ${problems.length - 3} more` : ''}. After the upgrade the registry no longer serves it, and serves the package's file instead.`,
              steps:
                "Before installing, change the override so that it fits the new version, in the layout designer, or roll it back to the package's file.",
            }
          : {
              severity: 'warning',
              check: 'layer',
              item: name,
              what:
                `The draft of ${file.path}${typeof version.savedBy === 'string' ? `, saved by ${version.savedBy}` : ''}, does not fit ${kit.name} ${kit.version}: ` +
                `${problems.slice(0, 3).join('; ')}${problems.length > 3 ? `, and ${problems.length - 3} more` : ''}. It cannot be approved as it is after the upgrade.`,
              steps: 'Mend the draft in the layout designer after the upgrade, or discard it.',
            },
      );
    }
  }
}

/** How a finding names a layer's file, or `undefined` for a path that is not one. */
function layerItem(path) {
  if (typeof path !== 'string') return undefined;
  for (const [pattern, name] of LAYER_FILES) {
    const match = pattern.exec(path);
    if (match) return name(match);
  }
  return undefined;
}

/**
 * The content model the server has once the upgrade is installed, `{ doctypes, facets, schemas }`
 * as `/api/v1/config` answers it: the server's own, less the types and schemas the package as
 * installed has and the new one has not, less the properties the new one drops from a schema it
 * keeps and the schemas it drops from a type it keeps, with the new package's stand-in model, its
 * `content-model.json`, over it when it ships one.
 */
function modelAfter(server, beforeModel, kitModel) {
  const goneTypes = new Set(
    [...beforeModel.doctypes]
      .filter(([name, type]) => !type.append && !kitModel.doctypes.has(name))
      .map(([name]) => name),
  );
  const goneSchemas = new Set(
    [...beforeModel.schemas.keys()].filter((name) => !kitModel.schemas.has(name)),
  );
  const doctypes = {};
  for (const [name, type] of Object.entries(server.doctypes ?? {})) {
    if (goneTypes.has(name) || !isRecord(type)) continue;
    const dropped = new Set([
      ...goneSchemas,
      ...(beforeModel.doctypes.get(name)?.schemas ?? []).filter(
        (schema) => !(kitModel.doctypes.get(name)?.schemas ?? []).includes(schema),
      ),
    ]);
    doctypes[name] = {
      ...type,
      schemas: (Array.isArray(type.schemas) ? type.schemas : []).filter(
        (schema) => !dropped.has(schema),
      ),
    };
  }
  const schemas = (server.schemas ?? [])
    .filter((schema) => !isRecord(schema) || !goneSchemas.has(schema.name))
    .map((schema) => {
      const was = isRecord(schema) ? beforeModel.schemas.get(schema.name) : undefined;
      const is = isRecord(schema) ? kitModel.schemas.get(schema.name) : undefined;
      if (!was?.properties || !is?.properties || !isRecord(schema.fields)) return schema;
      const fields = Object.fromEntries(
        Object.entries(schema.fields).filter(
          ([field]) => !was.properties.has(field) || is.properties.has(field),
        ),
      );
      return { ...schema, fields };
    });
  const facets = (server.facets ?? []).map((facet) =>
    isRecord(facet) && Array.isArray(facet.schemas)
      ? {
          ...facet,
          schemas: facet.schemas.filter(
            (schema) => !goneSchemas.has(isRecord(schema) ? schema.name : schema),
          ),
        }
      : facet,
  );
  const own = kitModel.contentModel;
  if (!isRecord(own)) return { doctypes, facets, schemas };
  const byName = (mine, theirs) => {
    const names = new Set(mine.filter(isRecord).map((each) => each.name));
    return [...theirs.filter((each) => !isRecord(each) || !names.has(each.name)), ...mine];
  };
  return {
    doctypes: { ...doctypes, ...(isRecord(own.doctypes) ? own.doctypes : {}) },
    facets: byName(Array.isArray(own.facets) ? own.facets : [], facets),
    schemas: byName(Array.isArray(own.schemas) ? own.schemas : [], schemas),
  };
}

/**
 * What the deployment registers in code for its layer's files, `nuxeo.agentic.ui.layer.registered.*`
 * (`LayerSettings` in nuxeo-agentic-core), which the server's validator is given: read from the
 * management API's configuration, of which nothing else is kept, said or printed.
 */
async function registeredIds(nuxeo) {
  const answer = await nuxeo.get('/api/v1/management/configuration');
  // Its shape read from Nuxeo 2025.10.18: `runtimeProperties` and `configuredProperties`, objects.
  if (
    answer.status !== 200 ||
    !isRecord(answer.body) ||
    !(isRecord(answer.body.runtimeProperties) || isRecord(answer.body.configuredProperties))
  )
    throw new Refusal(
      `/api/v1/management/configuration answered ${answer.status}${answer.status === 200 ? ' with no runtimeProperties or configuredProperties' : ''}, ` +
        "so the ids the deployment registers for its layer, which the server's validator is given, cannot be read, " +
        'and an override cannot be held to the new version as the server would hold it.',
    );
  const property = (name) => {
    for (const group of ['runtimeProperties', 'configuredProperties']) {
      const value = isRecord(answer.body[group]) ? answer.body[group][name] : undefined;
      if (typeof value === 'string') return value;
    }
    return '';
  };
  const ids = (kind) =>
    property(`nuxeo.agentic.ui.layer.registered.${kind}`)
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
  return { rules: ids('rules'), rowActions: ids('rowActions'), bulkActions: ids('bulkActions') };
}

// --- Vocabularies ---------------------------------------------------------------------------------

/**
 * A vocabulary loaded from a CSV the upgrade changes: Nuxeo loads the file when it creates the
 * directory, and again at each start only with `createTablePolicy` `always`, which drops what an
 * administrator added. Otherwise a new entry of the file never reaches a server that has the
 * vocabulary.
 */
async function vocabularies({ nuxeo, kit, kitModel, beforeModel, findings, said }) {
  const changed = [...kitModel.directories].filter(([name, directory]) => {
    const was = beforeModel.directories.get(name);
    return was === undefined || canonical(was.ids) !== canonical(directory.ids);
  });
  if (changed.length === 0) {
    said.push(
      kitModel.directories.size === 0
        ? 'the package loads no vocabulary from a CSV.'
        : `the upgrade changes no vocabulary's CSV: ${list([...kitModel.directories.keys()])}.`,
    );
    return;
  }
  for (const [name, directory] of changed) {
    if (!NAME.test(name))
      throw new Refusal(`the vocabulary "${name}" is not a name this asks the server for.`);
    const ids = new Set();
    let found = true;
    let whole = false;
    for (let page = 0; page < VOCABULARY_PAGES; page++) {
      const answer = await nuxeo.get(`/api/v1/directory/${segment(name)}`, {
        query: { pageSize: VOCABULARY_PAGE, currentPageIndex: page },
      });
      if (answer.status === 404) {
        found = false;
        break;
      }
      if (answer.status !== 200 || !Array.isArray(answer.body?.entries))
        throw new Refusal(
          `/api/v1/directory/${name} answered ${answer.status}${nuxeoMessage(answer.body)}.`,
        );
      for (const entry of answer.body.entries) {
        const id = isRecord(entry) ? (entry.id ?? entry.properties?.id) : undefined;
        if (typeof id === 'string' || typeof id === 'number') ids.add(String(id));
      }
      if (answer.body.isNextPageAvailable !== true) {
        whole = true;
        break;
      }
    }
    // A vocabulary read in part would make every entry past the part look missing.
    if (found && !whole)
      throw new Refusal(
        `the server's vocabulary ${name} has more than ${VOCABULARY_PAGE * VOCABULARY_PAGES} entries, more than this reads.`,
      );
    if (!found) {
      said.push(
        `the server has no vocabulary ${name}: it is made from ${directory.file} at the next start.`,
      );
      continue;
    }
    const missing = directory.ids.filter((id) => !ids.has(id));
    const extra = [...ids].filter((id) => !directory.ids.includes(id));
    const always = directory.policy === 'always';
    if (missing.length > 0 && !always)
      findings.push({
        severity: 'error',
        check: 'vocabularies',
        item: `vocabulary ${name}`,
        what:
          `${missing.length} entr${missing.length === 1 ? 'y' : 'ies'} of ${kit.version}'s ${directory.file}, ${list(missing.slice(0, 5))}${missing.length > 5 ? ', …' : ''}, ` +
          `are not in the server's ${name}, and with createTablePolicy ${directory.policy ?? "the template's"} Nuxeo does not load the file into a vocabulary it has: ` +
          'what offers them offers nothing.',
        steps: `Add them to ${name} as an administrator, before or after the upgrade, with the ids and labels the file gives.`,
      });
    if (extra.length > 0 && always)
      findings.push({
        severity: 'warning',
        check: 'vocabularies',
        item: `vocabulary ${name}`,
        what:
          `The server's ${name} has ${extra.length} entr${extra.length === 1 ? 'y' : 'ies'} ${directory.file} does not, ${list(extra.slice(0, 5))}${extra.length > 5 ? ', …' : ''}, ` +
          'and with createTablePolicy always Nuxeo loads the file again at the next start, which drops them.',
        steps: `Note them before installing, and add them again after, or add them to ${directory.file}.`,
      });
    if ((missing.length === 0 || always) && (extra.length === 0 || !always))
      said.push(
        `the server's vocabulary ${name} answers as ${kit.version}'s ${directory.file} expects.`,
      );
  }
}

// --- What the server already says ------------------------------------------------------------------

/** What the server reports wrong with the app before the upgrade: a new error can then be told. */
function diagnostics({ server, kitModel, findings, said }) {
  const ofApp = (
    Array.isArray(server.registry.diagnostics) ? server.registry.diagnostics : []
  ).filter(
    (each) =>
      isRecord(each) &&
      each.level === 'error' &&
      (each.app === server.app || each.bundle === kitModel.bundle) &&
      typeof each.message === 'string',
  );
  for (const message of new Set(ofApp.map((each) => each.message)))
    findings.push({
      severity: 'warning',
      check: 'diagnostics',
      item: `app ${server.app}`,
      what: `The server reports, before the upgrade: ${message}`,
      steps: "Note it: after the upgrade, an error that was not here is the upgrade's.",
    });
  for (const message of new Set(server.errors))
    findings.push({
      severity: 'warning',
      check: 'diagnostics',
      item: 'runtime',
      what: `The server's runtime reports an error, before the upgrade: ${message}`,
      steps: "Note it: after the upgrade, an error that was not here is the upgrade's.",
    });
  if (!server.registryRead)
    said.push(
      'the app registry was not read, so what it reports about the app before the upgrade is not known.',
    );
  else if (ofApp.length === 0 && server.errors.length === 0)
    said.push(`the server reports no error for ${server.app ?? 'the app'}, and its runtime none.`);
}

// --- What the package holds, beyond what the offline half reads -------------------------------------

/**
 * What this needs of a package that `readKit` does not read: its bundle's name; its document types,
 * with their schemas; its schemas' properties, with each one's type as the XSD writes it; its
 * lifecycles and which type follows which; its page providers, as written, with their aggregates;
 * its route models' zips; its vocabularies' CSV files; and its stand-in content model.
 */
export function packageModel(kit) {
  const bundle = resolve(kit.directory, 'bundle');
  const inBundle = (path) => {
    const file = resolve(bundle, path);
    return !isAbsolute(path) && file.startsWith(bundle + sep) && isFile(file) ? file : null;
  };
  const manifest = inBundle('META-INF/MANIFEST.MF');
  const symbolic = manifest
    ? /^Bundle-SymbolicName:[ \t]*([^;\s]+)/im.exec(
        readFileSync(manifest, 'utf8').replace(/\r?\n[ \t]/g, ''),
      )?.[1]
    : undefined;
  const descriptor = join(kit.directory, 'package', 'package.xml');
  const model = {
    bundle: symbolic ?? null,
    // The package's type, `addon` for a kit, which the package manager's listing is asked for.
    type: isFile(descriptor)
      ? attribute(
          withoutCommentsOrInstructions(readFileSync(descriptor, 'utf8')),
          'package',
          'type',
        )
      : null,
    doctypes: new Map(),
    schemas: new Map(),
    lifecycles: new Map(),
    lifecycleOf: new Map(),
    pageProviders: new Map(),
    routeModels: new Map(),
    directories: new Map(),
    contentModel: undefined,
  };
  for (const component of kit.components) {
    const file = inBundle(component.path);
    if (file === null) continue;
    const source = readFileSync(file, 'utf8');
    const xml = componentXmlOf(source);
    // A page provider as written, its CDATA kept: componentXmlOf blanks CDATA, where an NXQL
    // query is often written, and a change there is a change of the page provider.
    const written = new Map();
    for (const kind of ['coreQueryPageProvider', 'genericPageProvider'])
      for (const { attributes, whole } of elements(withoutCommentsOrInstructions(source), kind))
        if (attributes.name) written.set(attributes.name, whole.replace(/\s+/g, ' ').trim());
    for (const [, tag, body] of xml.matchAll(
      new RegExp(`<extension${TAG}([\\s\\S]*?)</extension[ \\t\\r\\n]*>`, 'g'),
    )) {
      const { target = '', point = '' } = attributesOf(tag);
      if (point === 'schema')
        for (const [, schemaTag] of body.matchAll(new RegExp(`<schema${TAG}`, 'g'))) {
          const { name, prefix, src } = attributesOf(schemaTag);
          if (!name || !src) continue;
          const xsd = inBundle(src);
          model.schemas.set(name, {
            prefix: prefix || name,
            properties: xsd === null ? null : xsdProperties(readFileSync(xsd, 'utf8')),
          });
        }
      if (point === 'doctype')
        for (const { attributes, inner } of elements(body, 'doctype')) {
          if (!attributes.name) continue;
          model.doctypes.set(attributes.name, {
            // `append` adds to a type of the platform's, such as File, which the package does not own.
            append: attributes.append === 'true',
            schemas: [...inner.matchAll(new RegExp(`<schema${TAG}`, 'g'))]
              .map(([, each]) => attributesOf(each).name)
              .filter(Boolean),
          });
        }
      if (point === 'lifecycle')
        for (const { attributes, inner } of elements(body, 'lifecycle')) {
          if (!attributes.name) continue;
          const destinations = new Set(
            [...inner.matchAll(new RegExp(`<transition${TAG}`, 'g'))]
              .map(([, each]) => attributesOf(each).destinationState)
              .filter(Boolean),
          );
          const states = new Map();
          for (const state of elements(inner, 'state'))
            if (state.attributes.name)
              states.set(state.attributes.name, {
                initial:
                  state.attributes.initial === 'true' ||
                  state.attributes.name === attributes.defaultInitial,
                out: [
                  ...state.inner.matchAll(/<transition[ \t\r\n]*>([^<]*)<\/transition[ \t\r\n]*>/g),
                ].map(([, each]) => each.trim()),
              });
          model.lifecycles.set(attributes.name, { states, destinations });
        }
      if (point === 'types' && target.endsWith('LifeCycleService'))
        for (const [, typeTag, policy] of body.matchAll(
          new RegExp(`<type${TAG}([^<]*)</type[ \\t\\r\\n]*>`, 'g'),
        )) {
          const { name } = attributesOf(typeTag);
          if (name && policy.trim()) model.lifecycleOf.set(name, policy.trim());
        }
      if (point === 'providers')
        for (const kind of ['coreQueryPageProvider', 'genericPageProvider'])
          for (const { attributes, whole, inner } of elements(body, kind)) {
            if (!attributes.name) continue;
            model.pageProviders.set(attributes.name, {
              xml: written.get(attributes.name) ?? whole.replace(/\s+/g, ' ').trim(),
              class: attributes.class ?? null,
              aggregates: [...inner.matchAll(new RegExp(`<aggregate${TAG}`, 'g'))]
                .map(([, each]) => attributesOf(each))
                .filter((each) => each.id)
                .map((each) => ({ id: each.id, field: each.parameter ?? null })),
            });
          }
      if (point === 'routeModelImporter')
        for (const [, resource] of body.matchAll(new RegExp(`<template-resource${TAG}`, 'g'))) {
          const { id, path } = attributesOf(resource);
          const zip = id && path ? inBundle(path) : null;
          if (zip !== null)
            model.routeModels.set(id, createHash('sha256').update(readFileSync(zip)).digest('hex'));
        }
      if (point === 'directories')
        for (const { attributes, inner } of elements(body, 'directory')) {
          const dataFile = /<dataFile[ \t\r\n]*>([^<]*)<\/dataFile/.exec(inner)?.[1]?.trim();
          const csv = attributes.name && dataFile ? inBundle(dataFile) : null;
          if (csv === null) continue;
          model.directories.set(attributes.name, {
            file: dataFile,
            policy:
              /<createTablePolicy[ \t\r\n]*>([^<]*)<\/createTablePolicy/.exec(inner)?.[1]?.trim() ??
              null,
            ids: csvIds(readFileSync(csv, 'utf8')),
          });
        }
    }
  }
  const own = join(kit.directory, 'content-model.json');
  if (isFile(own))
    try {
      model.contentModel = JSON.parse(readFileSync(own, 'utf8').replace(/^\uFEFF/, ''));
    } catch {
      model.contentModel = undefined;
    }
  return model;
}

/** Each `<name ...>...</name>` or `<name .../>` of `xml`, not nested in another of the same name. */
function elements(xml, name) {
  const found = [];
  const open = new RegExp(`<${name}${TAG}`, 'g');
  let match;
  while ((match = open.exec(xml)) !== null) {
    const start = match.index;
    const attributes = attributesOf(match[1]);
    if (match[1].trimEnd().endsWith('/')) {
      found.push({ attributes, inner: '', whole: match[0] });
      continue;
    }
    const close = new RegExp(`<(/)?${name}${TAG}`, 'g');
    close.lastIndex = open.lastIndex;
    let depth = 1;
    let end = -1;
    let inner;
    while ((inner = close.exec(xml)) !== null) {
      if (inner[1]) depth--;
      else if (!inner[2].trimEnd().endsWith('/')) depth++;
      if (depth === 0) {
        end = inner.index;
        break;
      }
    }
    if (end === -1) break;
    found.push({
      attributes,
      inner: xml.slice(open.lastIndex, end),
      whole: xml.slice(start, close.lastIndex),
    });
    open.lastIndex = close.lastIndex;
  }
  return found;
}

/**
 * A schema's properties, the elements directly under `<xs:schema>`, each with what it holds:
 * `base`, its type with the constraints set aside (`xs:string`, `list of xs:string`, `complex`),
 * whether it names the type, defines it inline or names a type the schema defines; `values`, the
 * enumeration a restriction allows, or `null`; and `text`, everything written about its type, so
 * that a change of a constraint alone is seen too.
 */
function xsdProperties(source) {
  const xml = withoutCdata(withoutCommentsOrInstructions(source));
  const prefix = /<([\w.-]+:)?schema\b/.exec(xml)?.[1] ?? '';
  const written = xsdTypes(source);
  const simple = (inner) => {
    const list = new RegExp(`<${prefix}list${TAG}`).exec(inner);
    if (list)
      return {
        base: `list of ${attributesOf(list[1]).itemType ?? 'an inline type'}`,
        values: null,
      };
    const restriction = new RegExp(`<${prefix}restriction${TAG}`).exec(inner);
    const values = [...inner.matchAll(new RegExp(`<${prefix}enumeration${TAG}`, 'g'))]
      .map(([, tag]) => attributesOf(tag).value)
      .filter((value) => value !== undefined);
    return {
      base: attributesOf(restriction?.[1] ?? '').base ?? 'a simple type',
      values: values.length > 0 ? values : null,
    };
  };
  // Nuxeo's other way to write a list of scalars: a complex type whose sequence holds one element
  // that may repeat. Its items' type is its type; any other complex type is `complex`.
  const complex = (inner) => {
    const items = [...inner.matchAll(new RegExp(`<${prefix}element${TAG}`, 'g'))].map(([, tag]) =>
      attributesOf(tag),
    );
    return items.length === 1 && items[0].maxOccurs === 'unbounded' && items[0].type
      ? { base: `list of ${items[0].type}`, values: null }
      : { base: 'complex', values: null };
  };
  const properties = new Map();
  for (const [name, { type, inner, named }] of written) {
    let held;
    if (named !== undefined)
      held = named.kind === 'complexType' ? complex(named.inner) : simple(named.inner);
    else if (type !== undefined) held = { base: type, values: null };
    else if (new RegExp(`<${prefix}complexType\\b`).test(inner)) held = complex(inner);
    else held = simple(inner);
    properties.set(name, {
      ...held,
      text: `${type ?? ''} ${named?.whole ?? inner}`.replace(/\s+/g, ' ').trim(),
    });
  }
  return properties;
}

/** Each top-level element of a schema: its `type`, what it holds inline, and the type it names. */
function xsdTypes(source) {
  const xml = withoutCdata(withoutCommentsOrInstructions(source));
  const schema =
    /<(?:[\w.-]+:)?schema\b[^>]*>([\s\S]*)<\/(?:[\w.-]+:)?schema[ \t\r\n]*>/.exec(xml)?.[1] ?? '';
  const prefix = /<([\w.-]+:)?schema\b/.exec(xml)?.[1] ?? '';
  const top = [];
  for (const kind of ['element', 'simpleType', 'complexType'])
    for (const each of elements(schema, `${prefix}${kind}`)) top.push({ kind, ...each });
  // Only those not inside another top-level one: an inline type's own elements are not properties.
  const nested = (candidate) =>
    top.some(
      (other) =>
        other !== candidate &&
        other.whole.includes(candidate.whole) &&
        other.whole.length > candidate.whole.length,
    );
  const named = new Map(
    top
      .filter((each) => each.kind !== 'element' && each.attributes.name && !nested(each))
      .map((each) => [each.attributes.name, each]),
  );
  const elementsOf = new Map();
  for (const element of top.filter(
    (each) => each.kind === 'element' && each.attributes.name && !nested(each),
  )) {
    const type = element.attributes.type;
    // A type of the schema's own namespace, not one of XML Schema's, such as xs:string.
    const own =
      type !== undefined && !type.startsWith(prefix || '\0')
        ? named.get(type.slice(type.indexOf(':') + 1))
        : undefined;
    elementsOf.set(element.attributes.name, { type, inner: element.inner, named: own });
  }
  return elementsOf;
}

/** The `id` column of a CSV file, as Nuxeo reads a directory's data file. */
function csvIds(source) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const text = source.replace(/^\uFEFF/, '');
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index++;
      row.push(cell);
      if (row.some((each) => each !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += character;
  }
  row.push(cell);
  if (row.some((each) => each !== '')) rows.push(row);
  const column = (rows[0] ?? []).findIndex((name) => name.trim() === 'id');
  return column === -1
    ? []
    : rows
        .slice(1)
        .map((each) => (each[column] ?? '').trim())
        .filter(Boolean);
}

// --- Output ---------------------------------------------------------------------------------------

function report({ where, server, kit, before, result, findings, said, reads }, asJson) {
  const errors = findings.filter((finding) => finding.severity === 'error');
  const refused = result.findings.length > 0 || errors.length > 0;
  const facts = {
    address: where.base,
    nuxeo: server.nuxeo,
    user: server.user,
    installed: server.installed,
    readFrom: server.from,
    notReadFrom: server.unread,
    heldTo: before === kit ? `${kit.shown}, the version installed` : before.shown,
  };
  if (asJson) {
    process.stdout.write(
      `${JSON.stringify({ kept: !refused, server: facts, packages: [result], findings, said, reads }, null, 2)}\n`,
    );
    return refused ? 1 : 0;
  }
  const out = refused ? console.error : console.log;
  const count = result.findings.length + errors.length;
  out(
    `${result.directory}: ${kit.name} ${kit.version}, over ${server.installed} installed on ${where.base} ` +
      `(Nuxeo ${server.nuxeo ?? '(no version)'}, read as ${server.user}, the version read from ${list(server.from)}): ` +
      (refused
        ? `refused, ${count} finding(s):`
        : `every configuration is kept, and nothing on the server needs doing first${findings.length > 0 ? `, ${findings.length} warning(s)` : ''}.`),
  );
  for (const finding of result.findings)
    out(`  - ${finding.side}, ${finding.item}: ${finding.what}`);
  for (const finding of errors)
    out(
      `  - server, ${finding.check}, ${finding.item}: ${finding.what} What to do: ${finding.steps}`,
    );
  for (const each of result.covered)
    console.log(`  kept by the note for ${each.item}, at ${each.note.version}: ${each.note.note}`);
  for (const warning of result.warnings) console.log(`  warning: ${warning.item}: ${warning.what}`);
  for (const finding of findings.filter((each) => each.severity === 'warning'))
    console.log(
      `  warning: server, ${finding.check}, ${finding.item}: ${finding.what} What to do: ${finding.steps}`,
    );
  for (const problem of server.unread)
    console.log(`  note: the version was not read there: ${problem}.`);
  for (const line of [...result.said, ...said]) console.log(`  note: ${line}`);
  return refused ? 1 : 0;
}

// --- Small things -----------------------------------------------------------------------------------

/** JSON with every object's keys sorted and a file's top-level `$schema` left out, as the server serves it. */
function canonical(value) {
  const sorted = (each) =>
    Array.isArray(each)
      ? each.map(sorted)
      : isRecord(each)
        ? Object.fromEntries(
            Object.keys(each)
              .sort()
              .map((key) => [key, sorted(each[key])]),
          )
        : each;
  if (value === undefined) return 'undefined';
  const top = isRecord(value)
    ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== '$schema'))
    : value;
  return JSON.stringify(sorted(top));
}

function walk(value, visit) {
  visit(value);
  if (Array.isArray(value)) for (const item of value) walk(item, visit);
  else if (isRecord(value)) for (const item of Object.values(value)) walk(item, visit);
}

/**
 * One path segment: letters, digits, `_`, `.` and `-`, and not `.` or `..`, which a URL parser
 * reads as moves up the path. Anything else, a slash or a percent sign above all, is refused rather
 * than encoded, so that no name from a package or from an answer can reshape an address.
 */
function segment(value) {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9_.-]+$/.test(value) ||
    value === '.' ||
    value === '..'
  )
    throw new Refusal(`${JSON.stringify(value)} is not a name this asks the server for.`);
  return value;
}

function nuxeoMessage(body) {
  return isRecord(body) && typeof body.message === 'string' ? `: ${body.message}` : '';
}

function reason(error) {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  if (!(cause instanceof Error)) return error.message;
  const code = typeof cause.code === 'string' ? cause.code : '';
  return `${error.message} (${[code, cause.message].filter(Boolean).join(' ') || cause.name})`;
}

function isFile(path) {
  return lstatSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function list(items, none = 'nothing', and = 'and') {
  const all = [...items];
  if (all.length === 0) return none;
  if (all.length === 1) return all[0];
  return `${all.slice(0, -1).join(', ')} ${and} ${all[all.length - 1]}`;
}
