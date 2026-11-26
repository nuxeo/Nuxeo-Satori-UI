#!/usr/bin/env node
/**
 * Controls for the upgrade check's server half, `app-upgrade-check.mjs --server`
 * (`app-upgrade-server.mjs`; docs/business-apps/package-pipeline.md, section 10, "On a server,
 * before the install").
 *
 * A stand-in Nuxeo, an HTTP server on this machine, answers what the check reads, as a Nuxeo 2025
 * with the demo kit installed answers it: who `/me` is, the distribution's bundles, the package
 * manager's listing, the app registry, the layouts served, the content model, NXQL counts, page
 * providers, route models, a vocabulary and the deployment layer. Each control changes the demo
 * kit, as installed or as about to be installed, or what the stand-in answers, in one way, and the
 * check, run as a command as an administrator runs it, must say so for its own reason:
 *
 * - each finding, with its severity and its exit code: records of a type, a schema or a property
 *   removed or changed, and of a state a lifecycle does not have or keeps only as a way in; a page
 *   provider that answers without its aggregate, or not at all; workflows running on a route model
 *   replaced; an override in force, or a draft, that no longer fits, and one whose file changes; a
 *   vocabulary's new entries; what the server already reports;
 * - each refusal, exit 2: a guest, not an administrator, a redirect, no credential, an address
 *   holding one or in clear text to another machine, the kit not installed, its version unread,
 *   read two ways, waiting for a restart, older than the version installed, or served otherwise
 *   than the package held to;
 * - sound upgrades, exit 0: the version installed checked against itself, and an upgrade that
 *   changes a page provider, a route model, a vocabulary and a file an override replaces, with
 *   nothing on the server they leave behind.
 *
 * After every run, every request the stand-in saw must be a `GET` carrying the credentials, and
 * the password must appear nowhere in what the check printed. The read-only guard itself is also
 * called directly: a `POST`, a body, another origin and an address it does not read are refused
 * before anything is sent.
 *
 * Usage: node scripts/app-upgrade-server.selftest.mjs
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(REPO, 'scripts', 'app-upgrade-check.mjs');
const DEMO = join(REPO, 'business-apps', 'packages', 'payers-claims-demo');
const { guardedFetch } = await import('./app-upgrade-server.mjs');

const VERSION = /version="([^"]+)">/.exec(
  readFileSync(join(DEMO, 'package', 'package.xml'), 'utf8'),
)[1];
const MINOR = VERSION.replace(
  /^(\d+)\.(\d+)\.\d+.*$/,
  (_, major, minor) => `${major}.${Number(minor) + 1}.0`,
);
const OLDER = VERSION.replace(/^(\d+)\.(\d+)\.(\d+).*$/, (_, major, minor, patch) =>
  Number(patch) > 0
    ? `${major}.${minor}.${Number(patch) - 1}`
    : `${major}.${Math.max(0, Number(minor) - 1)}.9`,
);
const NAME = 'payers-claims-demo';
const BUNDLE = 'nuxeo.config.payers-claims-demo';
const APP = 'payers-claims';
const USER = 'upgrade-check-admin';
// Made here, at each run, so that no credential is written in the repository.
const PASSWORD = randomBytes(18).toString('base64url');
const ENCODED = Buffer.from(`${USER}:${PASSWORD}`).toString('base64');
/**
 * What a read-only check of an upgrade may ask the stand-in for, written here from the addresses
 * the docs list, apart from the module's own list: a request for anything else fails the control.
 */
const ALLOWED = [
  '/api/v1/me',
  '/api/v1/management/distribution',
  '/api/v1/management/page-providers',
  '/api/v1/management/configuration',
  '/api/v1/config/types',
  '/api/v1/config/facets',
  '/api/v1/config/schemas',
  /\/api\/v1\/config\/schemas\/[A-Za-z0-9_.-]+/,
  '/api/v1/search/lang/NXQL/execute',
  /\/api\/v1\/search\/pp\/[A-Za-z0-9_.-]+(?:\/execute)?/,
  '/api/v1/workflowModel',
  /\/api\/v1\/directory\/[A-Za-z0-9_.-]+/,
  '/agentic-ui-apps/apps.json',
  '/agentic-ui-apps/layer.json',
  /\/agentic-ui-apps\/apps\/payers-claims\/layer\.json/,
  /\/agentic-ui-apps\/apps\/payers-claims\/layer\/(?:layouts\/[A-Za-z0-9_-]+\/(?:view|edit|create)\.layout|queues\/[A-Za-z0-9_.-]+)\.json/,
  '/agentic-ui-config/layouts.json',
  /\/agentic-ui-config\/layouts\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.layout\.json/,
  '/site/connectClient/packages/local',
].map((path) =>
  typeof path === 'string'
    ? new RegExp(`^/nuxeo${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
    : new RegExp(`^/nuxeo${path.source}$`),
);
const MODEL_ID = '0b9ad9a5-6d5e-4b8a-9c41-5b1f3a1e2c77';

const ROOT = 'bundle/agentic-ui-config';
const MODEL = 'bundle/OSGI-INF/payers-claims-demo-model.xml';
const CLAIM_SCHEMA = 'bundle/schemas/claim.xsd';
const CSV = 'bundle/data/vocabularies/PayersClaimDecision.csv';
const ZIP = 'bundle/data/PayersClaimReview.zip';

const failures = [];
let negative = 0;
let positive = 0;

// --- The stand-in Nuxeo -----------------------------------------------------------------------------

/** What the stand-in answers: a Nuxeo with `installed`, the kit as installed, in force. */
function serverFor(installed, change = () => undefined) {
  const content = JSON.parse(readFileSync(join(installed, 'content-model.json'), 'utf8'));
  const state = {
    me: {
      'entity-type': 'user',
      id: USER,
      isAdministrator: true,
      isAnonymous: false,
      properties: { username: USER },
    },
    meStatus: 200,
    meRedirect: false,
    bundles: ['org.nuxeo.agentic.core', BUNDLE, 'org.nuxeo.ecm.core'],
    runtimeErrors: [],
    packages: [{ id: `${NAME}-${versionOf(installed)}`, state: 'running' }],
    listing: true,
    registry: [],
    diagnostics: [],
    layouts: layoutsOf(installed),
    model: {
      doctypes: {
        ...content.doctypes,
        DocumentRoute: { parent: 'Folder', facets: [], schemas: ['document_route_instance'] },
      },
      facets: content.facets,
      schemas: [
        ...content.schemas,
        { name: 'document_route_instance', prefix: 'docri', fields: { modelId: 'string' } },
      ],
    },
    counts: [],
    pageProviders: {},
    pageProviderList: [],
    workflowModels: [{ 'entity-type': 'workflow', name: 'PayersClaimReview', id: MODEL_ID }],
    directories: { PayersClaimDecision: ['approve', 'deny'] },
    layer: null,
    layerFiles: {},
    // The server's runtime properties, as /management/configuration answers them.
    properties: {},
  };
  change(state);
  return state;
}

function versionOf(directory) {
  return /version="([^"]+)">/.exec(
    readFileSync(join(directory, 'package', 'package.xml'), 'utf8'),
  )[1];
}

function layoutsOf(directory) {
  const layouts = [];
  for (const [type, mode] of [
    ['Claim', 'view'],
    ['Member', 'view'],
    ['Case', 'view'],
    ['Provider', 'view'],
  ]) {
    const file = join(directory, ...`${ROOT}/layouts/${type}/${mode}.layout.json`.split('/'));
    const { $schema: _, ...served } = JSON.parse(readFileSync(file, 'utf8'));
    layouts.push({ type, mode, content: served });
  }
  return layouts;
}

const json = (body, status = 200) => ({
  status,
  type: 'application/json',
  body: JSON.stringify(body),
});

/** The answer to one request, as a Nuxeo 2025 gives it. */
function answer(state, url) {
  const path = url.pathname.replace(/^\/nuxeo/, '');
  const decoded = decodeURIComponent(path);
  if (path === '/api/v1/me') {
    if (state.meRedirect) return { status: 302, headers: { location: '/elsewhere/me' }, body: '' };
    return json(state.me, state.meStatus);
  }
  if (path === '/api/v1/management/distribution')
    return json({
      'entity-type': 'serverInfo',
      applicationName: 'Nuxeo Platform',
      distributionVersion: '2025.10.18',
      bundles: state.bundles.map((name) => ({
        name,
        version: name === BUNDLE ? '0.0.0' : '2025.10.18',
      })),
      warnings: [],
      errors: state.runtimeErrors.map((message) => ({ message })),
    });
  if (path === '/site/connectClient/packages/local') {
    if (!state.listing) return { status: 404, type: 'text/html', body: '<html>Not found</html>' };
    const rows = state.packages
      .map(
        (row, index) =>
          `<tr class="row_${index % 2 ? 'odd' : 'even'}" id="row_${row.id}">\n<td class="opentd">&nbsp;</A> </td>\n<td> ${row.id} </td>\n` +
          `<!--<td> ${NAME} </td>-->\n<td> Payers Claims (demo) </td>\n<td> ${row.id.slice(NAME.length + 1)} &nbsp;</td>\n<td> addon </td>\n` +
          `<td>${row.state}</td>\n<td><a class="button uninstall" href="/nuxeo/site/connectClient/uninstall/start/${row.id}?source=local">Uninstall</a></td>\n</tr>`,
      )
      .join('\n');
    return { status: 200, type: 'text/html', body: `<html><table>\n${rows}\n</table></html>` };
  }
  if (path === '/agentic-ui-apps/apps.json')
    return json({
      format: 'nuxeo-agentic-ui-config/1',
      layer: 'apps',
      apps: state.registry,
      diagnostics: state.diagnostics,
    });
  if (path === '/agentic-ui-config/layouts.json')
    return json({
      format: 'nuxeo-agentic-ui-config/1',
      layouts: state.layouts.map(({ type, mode }) => ({
        type,
        mode,
        url: `layouts/${type}/${mode}.layout.json`,
        bundle: BUNDLE,
        source: `agentic-ui-config/layouts/${type}/${mode}.layout.json`,
      })),
    });
  let match;
  if ((match = /^\/agentic-ui-config\/layouts\/([^/]+)\/([^/]+)\.layout\.json$/.exec(decoded))) {
    const layout = state.layouts.find((each) => each.type === match[1] && each.mode === match[2]);
    return layout
      ? json({ type: layout.type, mode: layout.mode, content: layout.content })
      : json({}, 404);
  }
  if (path === '/api/v1/config/types') return json({ doctypes: state.model.doctypes });
  if (path === '/api/v1/config/facets') return json(state.model.facets);
  if (path === '/api/v1/config/schemas')
    return json(state.model.schemas.map(({ name, prefix }) => ({ name, prefix })));
  if ((match = /^\/api\/v1\/config\/schemas\/([^/]+)$/.exec(decoded))) {
    const schema = state.model.schemas.find((each) => each.name === match[1]);
    return schema ? json(schema) : json({ message: 'no such schema' }, 404);
  }
  if (path === '/api/v1/search/lang/NXQL/execute') {
    const query = url.searchParams.get('query') ?? '';
    const found = state.counts.find(([pattern]) =>
      typeof pattern === 'function' ? pattern(query) : pattern.test(query),
    );
    if (found && found[1] === 'fail')
      return json({ 'entity-type': 'exception', status: 500, message: 'all shards failed' }, 500);
    return json({
      'entity-type': 'documents',
      resultsCount: found ? found[1] : 0,
      resultsCountLimit: 10000,
      entries: [],
    });
  }
  if (path === '/api/v1/management/page-providers') return json(state.pageProviderList);
  if (path === '/api/v1/management/configuration')
    return json(
      state.configuration ?? {
        'entity-type': 'configuration',
        configuredProperties: { 'nuxeo.db.password': '***' },
        runtimeProperties: state.properties,
      },
    );
  if ((match = /^\/agentic-ui-apps\/apps\/([^/]+)\/layer\.json$/.exec(decoded))) {
    if (state.layer === null)
      return json(
        { error: 'not-found', message: 'The deployment layer is switched off on this server.' },
        404,
      );
    return json({
      format: 'nuxeo-agentic-ui-layer/1',
      app: match[1],
      files: Object.entries(state.layerFiles).map(([path, file]) => ({
        path,
        revision: 1,
        live: file.live?.version ?? 0,
        draft: file.draft
          ? { savedBy: file.draft.savedBy, savedAt: file.draft.savedAt, submitted: false }
          : null,
      })),
    });
  }
  if ((match = /^\/api\/v1\/search\/pp\/([^/]+)(\/execute)?$/.exec(decoded))) {
    const provider = state.pageProviders[match[1]];
    if (!match[2])
      return provider?.definitionStatus
        ? json({ message: 'the definition could not be read' }, provider.definitionStatus)
        : json(provider?.definition ?? null);
    return provider?.execute ?? json({ message: 'no such page provider' }, 500);
  }
  if (path === '/api/v1/workflowModel')
    return json({ 'entity-type': 'workflows', entries: state.workflowModels });
  if ((match = /^\/api\/v1\/directory\/([^/]+)$/.exec(decoded))) {
    const ids = state.directories[match[1]];
    if (!ids) return json({ message: 'no such directory' }, 404);
    return json({
      'entity-type': 'directoryEntries',
      isNextPageAvailable: false,
      entries: ids.map((id) => ({
        'entity-type': 'directoryEntry',
        id,
        properties: { id, label: id },
      })),
    });
  }
  if (path === '/agentic-ui-apps/layer.json')
    return state.layer === null
      ? json(
          {
            format: 'nuxeo-agentic-ui-layer/1',
            error: 'not-found',
            message: 'The deployment layer is switched off on this server.',
          },
          404,
        )
      : json(state.layer);
  if ((match = /^\/agentic-ui-apps\/apps\/([^/]+)\/layer\/(.+)$/.exec(decoded))) {
    const file = state.layerFiles[match[2]];
    return file ? json(file) : json({ error: 'not-found' }, 404);
  }
  return json({ message: `the stand-in has no ${path}` }, 404);
}

/** The stand-in, listening on this machine; `state` is swapped by each control. */
async function standIn() {
  const holder = { state: null, seen: [] };
  const expected = `Basic ${Buffer.from(`${USER}:${PASSWORD}`).toString('base64')}`;
  const server = createServer((request, response) => {
    holder.seen.push({
      method: request.method,
      url: request.url,
      authorized: request.headers.authorization === expected,
    });
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      if (request.method !== 'GET' || body !== '') {
        response.writeHead(405, { allow: 'GET' });
        response.end();
        return;
      }
      const reply = answer(holder.state, new URL(request.url, 'http://stand-in'));
      response.writeHead(reply.status, {
        'content-type': reply.type ?? 'text/plain',
        ...(reply.headers ?? {}),
      });
      response.end(reply.body);
    });
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return { holder, server, address: `http://127.0.0.1:${server.address().port}/nuxeo` };
}

// --- The packages ---------------------------------------------------------------------------------

function edit(directory, file, from, to) {
  const path = join(directory, ...file.split('/'));
  const text = readFileSync(path, 'utf8');
  if (!text.includes(from))
    throw new Error(`the control's edit does not apply to ${file}: ${from}`);
  writeFileSync(path, text.replace(from, to));
}

function jsonEdit(directory, file, change) {
  const path = join(directory, ...file.split('/'));
  const content = JSON.parse(readFileSync(path, 'utf8'));
  change(content);
  writeFileSync(path, `${JSON.stringify(content, null, 2)}\n`);
}

function setVersion(directory, version) {
  edit(
    directory,
    `${ROOT}/app.json`,
    `"packageVersion": "${VERSION}"`,
    `"packageVersion": "${version}"`,
  );
  edit(directory, 'package/package.xml', `version="${VERSION}">`, `version="${version}">`);
  edit(
    directory,
    'bundle/META-INF/MANIFEST.MF',
    `Bundle-Version: ${VERSION}`,
    `Bundle-Version: ${version}`,
  );
}

function notes(directory, list) {
  writeFileSync(
    join(directory, 'upgrade-notes.json'),
    `${JSON.stringify({ version: 1, notes: list }, null, 2)}\n`,
  );
}

/** A copy of the demo at `version`, changed by `change`. */
function kit(scratch, name, version, change = () => undefined) {
  const directory = join(scratch, name, NAME);
  cpSync(DEMO, directory, { recursive: true, filter: (path) => basename(path) !== 'dist' });
  if (version !== VERSION) setVersion(directory, version);
  change(directory);
  return directory;
}

/** A document type the installed version has and the new one does not. */
const withLegacyType = (directory) =>
  edit(
    directory,
    MODEL,
    '    <doctype name="Claim" extends="Document">',
    '    <doctype name="PayersLegacyNote" extends="Document">\n      <schema name="dublincore" />\n    </doctype>\n    <doctype name="Claim" extends="Document">',
  );
/** A schema the installed version gives members, which the new one does not have. */
const withLegacySchema = (directory) => {
  writeFileSync(
    join(directory, 'bundle', 'schemas', 'legacynote.xsd'),
    '<?xml version="1.0"?>\n<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">\n  <xs:element name="text" type="xs:string" />\n</xs:schema>\n',
  );
  edit(
    directory,
    MODEL,
    '    <schema name="claim" prefix="claim" src="schemas/claim.xsd" />',
    '    <schema name="claim" prefix="claim" src="schemas/claim.xsd" />\n    <schema name="legacynote" prefix="legacynote" src="schemas/legacynote.xsd" />',
  );
  edit(
    directory,
    MODEL,
    '      <schema name="member" />',
    '      <schema name="member" />\n      <schema name="legacynote" />',
  );
};
/** A claim property the installed version has and the new one does not. */
const withLegacyCode = (directory) =>
  edit(
    directory,
    CLAIM_SCHEMA,
    '  <xs:element name="diagnosis" type="xs:string" />',
    '  <xs:element name="diagnosis" type="xs:string" />\n  <xs:element name="legacyCode" type="xs:string" />',
  );
/** The pending claims' page provider, changed. */
const pendingChanged = (directory) =>
  edit(
    directory,
    MODEL,
    "AND claim:status IN ('inReview', 'pended')",
    "AND claim:status IN ('pended', 'inReview')",
  );
/** The pending claims' query written in CDATA, as it is, or changed inside the CDATA. */
const pendingInCdata = (changed) => (directory) =>
  edit(
    directory,
    MODEL,
    "ecm:primaryType = 'Claim' AND claim:status IN ('inReview', 'pended')",
    `<![CDATA[ecm:primaryType = 'Claim' AND claim:status IN (${changed ? "'pended', 'inReview'" : "'inReview', 'pended'"})]]>`,
  );
/** A page provider with no aggregate and no parameter, as it is, or changed. */
const allMembers = (changed) => (directory) =>
  edit(
    directory,
    MODEL,
    "    <!-- The Member page's claims card",
    `    <coreQueryPageProvider name="payers_all_members">\n      <pattern>SELECT * FROM Document WHERE ecm:primaryType = 'Member'${changed ? ' AND ecm:isTrashed = 0' : ''}</pattern>\n    </coreQueryPageProvider>\n    <!-- The Member page's claims card`,
  );
/** The route model's zip, rebuilt with other bytes. */
const zipChanged = (directory) => {
  const path = join(directory, ...ZIP.split('/'));
  writeFileSync(path, Buffer.concat([readFileSync(path), Buffer.from('changed')]));
};
/** A third decision in the vocabulary's CSV. */
const csvChanged = (directory) =>
  edit(directory, CSV, '"deny","Deny","0","2"', '"deny","Deny","0","2"\n"refer","Refer","0","3"');

/** The stand-in's page provider `payers_pending_claims`, answering `aggregations`. */
function pending(state, aggregations, { status = 200, indexed = true } = {}) {
  state.pageProviders.payers_pending_claims = {
    definition: {
      name: 'payers_pending_claims',
      whereClause: { fixedPart: "ecm:primaryType = 'Claim'" },
      aggregates: [{ id: 'claim_status_agg' }, { id: 'claim_adjuster_agg' }],
    },
    execute:
      status === 200
        ? json({ 'entity-type': 'documents', resultsCount: 3, aggregations, entries: [] })
        : json(
            { 'entity-type': 'exception', message: 'the search index refused the query' },
            status,
          ),
  };
  state.pageProviderList = [
    {
      name: 'payers_pending_claims',
      class: 'org.nuxeo.ecm.platform.query.nxql.SearchServicePageProvider',
      defaultSearchClient: indexed ? 'opensearch' : 'repository',
    },
  ];
}
const bothAggregates = {
  claim_status_agg: { id: 'claim_status_agg', buckets: [] },
  claim_adjuster_agg: { id: 'claim_adjuster_agg', buckets: [] },
};

/**
 * A deployment layer that overrides `path`, the my-claims queue unless another is named, with
 * `live`, and a draft. With `live` null the file has a draft only, which the export, as
 * `LayerService.export` writes it, leaves out, and the app's summary lists.
 */
function layerWith(
  state,
  packaged,
  { live, draft = null, packageChanged = false, path = 'queues/my-claims.json' },
) {
  state.layer = {
    format: 'nuxeo-agentic-ui-layer/1',
    apps:
      live === null
        ? []
        : [
            {
              id: APP,
              files: [{ path, version: 3, sha256: 'a', packageSha256: 'b', served: true }],
            },
          ],
  };
  state.layerFiles[path] = {
    format: 'nuxeo-agentic-ui-layer/1',
    app: APP,
    path,
    package: packaged === null ? null : { sha256: 'b', content: packaged },
    live:
      live === null
        ? null
        : { version: 3, kind: 'publish', content: live, sha256: 'a', packageSha256: 'b' },
    draft:
      draft === null
        ? null
        : { content: draft, savedBy: 'designer-one', savedAt: '2026-11-26T10:00:00Z' },
    packageChanged,
  };
}
const queueOf = (directory) => {
  const { $schema: _, ...queue } = JSON.parse(
    readFileSync(join(directory, ...`${ROOT}/queues/my-claims.json`.split('/')), 'utf8'),
  );
  return queue;
};

// --- Running the check ----------------------------------------------------------------------------

function run(args, env = {}) {
  const base = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^NUXEO_(USER|PASS)$/i.test(key)),
  );
  return new Promise((done) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      cwd: REPO,
      env: { ...base, NUXEO_USER: USER, NUXEO_PASS: PASSWORD, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (status) => done({ status, stdout, stderr, output: `${stdout}\n${stderr}` }));
  });
}

/**
 * One control: the kit as installed and as about to be, made by `packages(scratch)`, the stand-in
 * as `server(state, installed, next)` makes it, and what must come of it: `exit`, and with exit 1
 * or 0 the findings `--json` must hold, each `[severity, check, item, text]`, or none.
 */
async function control(
  what,
  stand,
  {
    packages,
    server = () => undefined,
    args = [],
    env,
    exit,
    findings = [],
    says = [],
    none = false,
    requests,
  },
) {
  if (exit === 0) positive++;
  else negative++;
  const scratch = mkdtempSync(join(tmpdir(), 'app-upgrade-server-'));
  try {
    const { installed, next, previous } = packages(scratch);
    stand.holder.state = serverFor(installed, (state) => server(state, installed, next));
    stand.holder.seen = [];
    const address = args.includes('--server') ? [] : ['--server', stand.address];
    const given = previous === undefined ? [] : ['--previous', previous];
    const result = await run(
      [next, ...address, ...given, ...(exit === 2 ? [] : ['--json']), ...args],
      env,
    );
    const wrong = [];
    if (result.status !== exit) wrong.push(`exit ${result.status}, not ${exit}`);
    for (const secret of [PASSWORD, ENCODED, encodeURIComponent(PASSWORD)])
      if (result.output.includes(secret)) wrong.push('the credentials are in what it printed');
    if (stand.holder.seen.some((each) => each.url.includes(PASSWORD) || each.url.includes(ENCODED)))
      wrong.push('the credentials are in a request address');
    // Held to a list written here, not to the module's own READS, which would be the check
    // judging itself.
    const outside = stand.holder.seen.filter(
      (each) => !ALLOWED.some((path) => path.test(new URL(each.url, 'http://stand-in').pathname)),
    );
    if (outside.length > 0)
      wrong.push(`the stand-in was asked for ${outside.map((each) => each.url).join(', ')}`);
    const notGet = stand.holder.seen.filter((each) => each.method !== 'GET');
    if (notGet.length > 0)
      wrong.push(
        `the stand-in saw ${notGet.map((each) => `${each.method} ${each.url}`).join(', ')}`,
      );
    const bare = stand.holder.seen.filter((each) => !each.authorized);
    if (bare.length > 0)
      wrong.push(`${bare.length} request(s) without the credentials, such as ${bare[0].url}`);
    if (requests !== undefined && !requests(stand.holder.seen))
      wrong.push(
        `the requests were ${stand.holder.seen.map((each) => each.url).join(', ') || 'none'}`,
      );
    for (const text of says)
      if (!result.output.includes(text)) wrong.push(`it does not say "${text}"`);
    if (exit !== 2) {
      let report;
      try {
        report = JSON.parse(result.stdout);
      } catch {
        wrong.push('--json printed no JSON');
      }
      if (report && (!Array.isArray(report.findings) || !Array.isArray(report.reads))) {
        wrong.push("its --json is not the server half's report: no findings or reads");
        report = undefined;
      }
      if (report) {
        for (const [severity, check, item, text] of findings) {
          const found = report.findings.find(
            (each) =>
              each.severity === severity &&
              each.check === check &&
              each.item === item &&
              (text === undefined || `${each.what} ${each.steps}`.includes(text)),
          );
          if (!found)
            wrong.push(
              `no ${severity} finding ${check}, ${item}${text ? ` saying "${text}"` : ''}`,
            );
        }
        if (none && report.findings.length > 0)
          wrong.push(
            `findings it should not have: ${report.findings.map((each) => `${each.severity} ${each.check} ${each.item}`).join('; ')}`,
          );
        // What it says it read must be what the stand-in saw, one for one.
        const said = report.reads.map((each) => `${each.method} /nuxeo${each.path}`).sort();
        const seen = stand.holder.seen.map((each) => `${each.method} ${each.url}`).sort();
        if (JSON.stringify(said) !== JSON.stringify(seen))
          wrong.push(
            `its report's ${said.length} reads are not the ${seen.length} the stand-in saw`,
          );
      }
    }
    if (wrong.length > 0)
      failures.push(
        `${what}:\n  ${wrong.join('\n  ')}\n  output:\n${result.output
          .split('\n')
          .slice(0, 30)
          .map((line) => `    ${line}`)
          .join('\n')}`,
      );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** The usual pair: the demo as installed, at its version, and the demo at the next minor. */
const upgrade =
  (before = () => undefined, after = () => undefined) =>
  (scratch) => {
    const installed = kit(scratch, 'installed', VERSION, before);
    return { installed, previous: installed, next: kit(scratch, 'next', MINOR, after) };
  };
const itself = (scratch) => {
  const installed = kit(scratch, 'installed', VERSION);
  return { installed, next: installed };
};

// --- The read-only guard, called directly ---------------------------------------------------------

{
  const sent = [];
  const fake = async (url, init) => {
    sent.push([url, init.method]);
    return new Response('{}', { status: 200 });
  };
  const guard = guardedFetch(
    'http://127.0.0.1:9/nuxeo',
    { username: USER, password: PASSWORD },
    [],
    fake,
  );
  for (const [what, url, init] of [
    ['a POST', 'http://127.0.0.1:9/nuxeo/api/v1/me', { method: 'POST' }],
    ['a GET with a body', 'http://127.0.0.1:9/nuxeo/api/v1/me', { body: 'x' }],
    ['a DELETE of a workflow', 'http://127.0.0.1:9/nuxeo/api/v1/workflow/1', { method: 'DELETE' }],
    ['another origin', 'http://127.0.0.2:9/nuxeo/api/v1/me', {}],
    [
      'an address it does not read',
      'http://127.0.0.1:9/nuxeo/api/v1/automation/Document.Delete',
      {},
    ],
    [
      "the package manager's install link",
      'http://127.0.0.1:9/nuxeo/site/connectClient/install/start/x-1.0.0',
      {},
    ],
    [
      'an encoded slash that a decoding proxy would climb with',
      'http://127.0.0.1:9/nuxeo/api/v1/search/pp/..%2F..%2F..%2F..%2Fsite%2FconnectClient%2Funinstall%2Fstart%2Fx-1.0.0',
      {},
    ],
    [
      'an encoded slash into the automation API',
      'http://127.0.0.1:9/nuxeo/api/v1/directory/..%2F..%2Fautomation%2FDocument.Delete',
      {},
    ],
    [
      'an encoded semicolon, the ..; form a decoding proxy climbs with',
      'http://127.0.0.1:9/nuxeo/api/v1/search/pp/..%3B/execute',
      {},
    ],
    [
      'a path that climbs out of its address',
      'http://127.0.0.1:9/nuxeo/api/v1/me/../../../site/connectClient/remove/start/x',
      {},
    ],
  ]) {
    negative++;
    let refused = false;
    try {
      await guard(url, init);
    } catch (error) {
      refused = error?.name === 'Refusal';
    }
    if (!refused)
      failures.push(`the guard sent ${what}: it must refuse it before anything is sent`);
  }
  if (sent.length > 0)
    failures.push(`the guard sent ${sent.length} request(s) it should have refused`);
  positive++;
  await guard('http://127.0.0.1:9/nuxeo/api/v1/me', {});
  if (sent.length !== 1 || sent[0][1] !== 'GET')
    failures.push('the guard did not send a GET of /api/v1/me');
}

// --- The controls -----------------------------------------------------------------------------------

const stand = await standIn();
try {
  // Sound: the version installed against itself, and an upgrade with nothing left behind.
  await control(
    'the version installed checked against itself, nothing on the server: kept',
    stand,
    {
      packages: itself,
      exit: 0,
      none: true,
      says: ['"kept": true'],
    },
  );
  await control(
    'an upgrade that changes a page provider, a route model, a vocabulary and an overridden file, with nothing left behind: kept, with a warning',
    stand,
    {
      packages: upgrade(undefined, (directory) => {
        pendingChanged(directory);
        zipChanged(directory);
        csvChanged(directory);
        jsonEdit(directory, `${ROOT}/queues/my-claims.json`, (queue) => (queue.pageSize = 25));
      }),
      server: (state, installed) => {
        pending(state, bothAggregates);
        state.directories.PayersClaimDecision = ['approve', 'deny', 'refer'];
        layerWith(state, queueOf(installed), { live: { ...queueOf(installed), pageSize: 20 } });
      },
      exit: 0,
      findings: [['warning', 'layer', 'queue my-claims', 'changes queues/my-claims.json']],
      says: ['"kept": true'],
    },
  );

  // Records.
  await control(
    'a document type removed, with records of it: an error, and the kit note in its steps',
    stand,
    {
      packages: upgrade(withLegacyType, (directory) =>
        notes(directory, [
          { version: MINOR, item: 'type PayersLegacyNote', note: 'Delete the legacy notes first.' },
        ]),
      ),
      server: (state) => state.counts.push([/ecm:primaryType = 'PayersLegacyNote'/, 3]),
      exit: 1,
      findings: [['error', 'records', 'type PayersLegacyNote', 'Delete the legacy notes first.']],
    },
  );
  await control('a schema removed, with records carrying it: an error', stand, {
    packages: upgrade(withLegacySchema, (directory) =>
      notes(directory, [{ version: MINOR, item: 'schema legacynote', note: 'Gone.' }]),
    ),
    server: (state) => {
      state.model.doctypes.Member = {
        ...state.model.doctypes.Member,
        schemas: [...state.model.doctypes.Member.schemas, 'legacynote'],
      };
      state.model.schemas.push({
        name: 'legacynote',
        prefix: 'legacynote',
        fields: { text: { type: 'string' } },
      });
      state.counts.push([/ecm:primaryType IN \('Member'\)/, 4], [/ecm:primaryType = 'Member'$/, 4]);
    },
    exit: 1,
    findings: [['error', 'records', 'schema legacynote', 'carry the schema legacynote']],
  });
  await control('a type that stops carrying a schema the package keeps: an error', stand, {
    packages: upgrade(undefined, (directory) =>
      edit(
        directory,
        MODEL,
        '      <schema name="dublincore" />\n      <schema name="member" />',
        '      <schema name="dublincore" />',
      ),
    ),
    server: (state) => state.counts.push([/ecm:primaryType = 'Member'$/, 4]),
    exit: 1,
    findings: [['error', 'records', 'type Member', 'no longer carries the schema member']],
  });
  await control('a platform type the package stops appending to: no type removed, kept', stand, {
    // The offline half reads an appended type as the package's own, and asks for a note, which
    // this one gives so that the server half is what is held.
    packages: upgrade(
      (directory) =>
        edit(
          directory,
          MODEL,
          '    <doctype name="Claim" extends="Document">',
          '    <doctype name="File" append="true">\n      <facet name="Versionable" />\n    </doctype>\n    <doctype name="Claim" extends="Document">',
        ),
      (directory) =>
        notes(directory, [{ version: MINOR, item: 'type File', note: 'No longer appended to.' }]),
    ),
    server: (state) => state.counts.push([/ecm:primaryType = 'File'/, 9]),
    exit: 0,
    none: true,
  });
  await control('an enumeration widened: the same type, nothing counted, kept', stand, {
    packages: upgrade(undefined, (directory) =>
      edit(
        directory,
        CLAIM_SCHEMA,
        '<xs:enumeration value="paid" />',
        '<xs:enumeration value="paid" />\n        <xs:enumeration value="closed" />',
      ),
    ),
    server: (state) => state.counts.push([/claim:status/, 30]),
    exit: 0,
    none: true,
    says: ['no enumeration is narrowed'],
  });
  await control('an enumeration narrowed, with values it no longer allows: a warning', stand, {
    packages: upgrade(undefined, (directory) =>
      edit(directory, CLAIM_SCHEMA, '        <xs:enumeration value="paid" />\n', ''),
    ),
    server: (state) => state.counts.push([/claim:status IN \('paid'\)/, 3]),
    exit: 0,
    findings: [['warning', 'records', 'property claim:status', '(paid)']],
  });
  await control("a lifecycle the new version changes: held to the new version's states", stand, {
    packages: upgrade(undefined, (directory) =>
      edit(
        directory,
        MODEL,
        /<state name="pended"[\s\S]*?<\/state>\n/.exec(
          readFileSync(join(directory, ...MODEL.split('/')), 'utf8'),
        )[0],
        '',
      ),
    ),
    server: (state) =>
      state.counts.push([
        (query) => /ecm:currentLifeCycleState NOT IN/.test(query) && !query.includes("'pended'"),
        2,
      ]),
    exit: 1,
    findings: [['error', 'records', 'lifecycle Claim', 'does not have']],
  });
  await control('a property removed, with values: an error', stand, {
    packages: upgrade(withLegacyCode, (directory) =>
      notes(directory, [
        { version: MINOR, item: 'property claim:legacyCode', note: 'Copy it to claim:diagnosis.' },
      ]),
    ),
    server: (state) => {
      const claim = state.model.schemas.find((each) => each.name === 'claim');
      claim.fields = { ...claim.fields, legacyCode: { type: 'string' } };
      state.counts.push([/claim:legacyCode IS NOT NULL/, 5]);
    },
    exit: 1,
    findings: [['error', 'records', 'property claim:legacyCode', 'Copy it to claim:diagnosis.']],
  });
  await control(
    "a list written as a repeating element whose items' type changes: an error",
    stand,
    {
      packages: upgrade(
        (directory) =>
          edit(
            directory,
            CLAIM_SCHEMA,
            '  <xs:element name="diagnosis" type="xs:string" />',
            '  <xs:element name="diagnosis" type="xs:string" />\n  <xs:element name="codes">\n    <xs:complexType>\n      <xs:sequence>\n        <xs:element name="item" type="xs:string" minOccurs="0" maxOccurs="unbounded" />\n      </xs:sequence>\n    </xs:complexType>\n  </xs:element>',
          ),
        (directory) =>
          edit(
            directory,
            CLAIM_SCHEMA,
            '  <xs:element name="diagnosis" type="xs:string" />',
            '  <xs:element name="diagnosis" type="xs:string" />\n  <xs:element name="codes">\n    <xs:complexType>\n      <xs:sequence>\n        <xs:element name="item" type="xs:long" minOccurs="0" maxOccurs="unbounded" />\n      </xs:sequence>\n    </xs:complexType>\n  </xs:element>',
          ),
      ),
      server: (state) => {
        const claim = state.model.schemas.find((each) => each.name === 'claim');
        claim.fields = { ...claim.fields, codes: { type: 'string[]' } };
        state.counts.push([/claim:codes\/\* IS NOT NULL/, 4]);
      },
      exit: 1,
      findings: [
        ['error', 'records', 'property claim:codes', 'from list of xs:string to list of xs:long'],
      ],
    },
  );
  await control(
    "a property's type changed, with values: an error the offline half cannot see",
    stand,
    {
      packages: upgrade(undefined, (directory) =>
        edit(
          directory,
          CLAIM_SCHEMA,
          '<xs:element name="diagnosis" type="xs:string" />',
          '<xs:element name="diagnosis" type="xs:long" />',
        ),
      ),
      server: (state) => state.counts.push([/claim:diagnosis IS NOT NULL/, 7]),
      exit: 1,
      findings: [['error', 'records', 'property claim:diagnosis', 'from xs:string to xs:long']],
    },
  );
  await control('claims in a state the lifecycle does not have: an error', stand, {
    packages: upgrade(),
    server: (state) =>
      state.counts.push([/ecm:primaryType = 'Claim' AND ecm:currentLifeCycleState NOT IN/, 2]),
    exit: 1,
    findings: [['error', 'records', 'lifecycle Claim', 'does not have']],
  });
  await control(
    'claims in a state the lifecycle keeps only as a way in: a warning, exit 0',
    stand,
    {
      packages: upgrade(),
      server: (state) => state.counts.push([/ecm:currentLifeCycleState = 'project'/, 6]),
      exit: 0,
      findings: [['warning', 'records', 'lifecycle Claim/project', 'submit']],
    },
  );
  await control('a count the server cannot make: the check cannot be made, exit 2', stand, {
    packages: upgrade(withLegacyType, (directory) =>
      notes(directory, [{ version: MINOR, item: 'type PayersLegacyNote', note: 'Gone.' }]),
    ),
    server: (state) => state.counts.push([/PayersLegacyNote/, 'fail']),
    exit: 2,
    says: ['could not count', 'all shards failed'],
  });

  // Page providers.
  await control(
    'a page provider changed, answered without one of its aggregates: an error',
    stand,
    {
      packages: upgrade(undefined, pendingChanged),
      server: (state) =>
        pending(state, { claim_status_agg: bothAggregates.claim_status_agg }, { indexed: false }),
      exit: 1,
      findings: [
        [
          'error',
          'page-providers',
          'page-provider payers_pending_claims',
          'without its aggregate claim_adjuster_agg: it is answered by the repository',
        ],
      ],
    },
  );
  await control(
    'a page provider changed inside its CDATA, answered without an aggregate: an error',
    stand,
    {
      packages: upgrade(pendingInCdata(false), pendingInCdata(true)),
      server: (state) => pending(state, { claim_status_agg: bothAggregates.claim_status_agg }),
      exit: 1,
      findings: [
        ['error', 'page-providers', 'page-provider payers_pending_claims', 'claim_adjuster_agg'],
      ],
    },
  );
  await control('a page provider with no aggregate, changed and not answered: an error', stand, {
    packages: upgrade(allMembers(false), allMembers(true)),
    server: (state) =>
      (state.pageProviders.payers_all_members = {
        definition: {
          name: 'payers_all_members',
          pattern: "SELECT * FROM Document WHERE ecm:primaryType = 'Member'",
        },
        execute: json({ message: 'the repository refused the query' }, 500),
      }),
    exit: 1,
    findings: [
      ['error', 'page-providers', 'page-provider payers_all_members', 'refused the query'],
    ],
  });
  await control(
    'a page provider moved to the index by the new version: said, not an error',
    stand,
    {
      packages: upgrade(
        (directory) =>
          edit(
            directory,
            MODEL,
            '<genericPageProvider name="payers_pending_claims"\n        class="org.nuxeo.ecm.platform.query.nxql.SearchServicePageProvider">',
            '<genericPageProvider name="payers_pending_claims"\n        class="org.nuxeo.ecm.platform.query.nxql.CoreQueryDocumentPageProvider">',
          ),
        undefined,
      ),
      server: (state) =>
        pending(state, { claim_status_agg: bothAggregates.claim_status_agg }, { indexed: false }),
      exit: 0,
      none: true,
      says: ['is answered as the new version says only after the upgrade'],
    },
  );
  await control("a related list's page provider, filled from its record: not run, kept", stand, {
    packages: upgrade(undefined, (directory) =>
      edit(directory, MODEL, 'claim:member = ?\n', 'claim:member = ? AND ecm:isTrashed = 0\n'),
    ),
    server: (state) =>
      (state.pageProviders.member_claims = {
        definition: {
          name: 'member_claims',
          pattern: 'SELECT * FROM Document WHERE claim:member = ?',
        },
      }),
    exit: 0,
    none: true,
    says: ['member_claims is given a parameter filled from a record, so it was not run'],
    requests: (seen) => !seen.some((each) => each.url.includes('/member_claims/execute')),
  });
  await control('a page provider changed, not answered at all: an error', stand, {
    packages: upgrade(undefined, pendingChanged),
    server: (state) => pending(state, {}, { status: 500 }),
    exit: 1,
    findings: [
      [
        'error',
        'page-providers',
        'page-provider payers_pending_claims',
        'the search index refused the query',
      ],
    ],
  });

  await control(
    'a changed page provider whose definition the server cannot read: the check cannot be made, exit 2',
    stand,
    {
      packages: upgrade(undefined, pendingChanged),
      server: (state) => {
        pending(state, bothAggregates);
        state.pageProviders.payers_pending_claims.definitionStatus = 500;
      },
      exit: 2,
      says: ['/api/v1/search/pp/payers_pending_claims answered 500'],
    },
  );
  await control('a changed page provider the server does not have yet: said, kept', stand, {
    packages: upgrade(undefined, pendingChanged),
    exit: 0,
    none: true,
    says: ['the server has no page provider payers_pending_claims yet'],
  });

  // Workflows.
  await control('workflows running on a route model the package replaces: an error', stand, {
    packages: upgrade(undefined, zipChanged),
    server: (state) => state.counts.push([new RegExp(`docri:modelId = '${MODEL_ID}'`), 2]),
    exit: 1,
    findings: [
      [
        'error',
        'workflows',
        'route-model PayersClaimReview',
        'keeps the nodes it was started with',
      ],
    ],
  });
  await control('a route model replaced, nothing running on it: kept', stand, {
    packages: upgrade(undefined, zipChanged),
    exit: 0,
    none: true,
    says: ['no workflow runs on the route model PayersClaimReview'],
  });

  // The deployment layer.
  await control('an override in force that no longer fits the new version: an error', stand, {
    packages: upgrade(),
    server: (state, installed) =>
      layerWith(state, queueOf(installed), {
        live: { ...queueOf(installed), rowActions: ['payers.claim.gone'] },
      }),
    exit: 1,
    findings: [['error', 'layer', 'queue my-claims', 'payers.claim.gone']],
  });
  await control('a draft that no longer fits the new version: a warning, exit 0', stand, {
    packages: upgrade(),
    server: (state, installed) =>
      layerWith(state, queueOf(installed), {
        live: queueOf(installed),
        draft: { ...queueOf(installed), rowActions: ['payers.claim.gone'] },
      }),
    exit: 0,
    findings: [['warning', 'layer', 'queue my-claims', 'saved by designer-one']],
  });
  await control("an override made on another version of the kit's file: a warning", stand, {
    packages: upgrade(),
    server: (state, installed) =>
      layerWith(state, queueOf(installed), { live: queueOf(installed), packageChanged: true }),
    exit: 0,
    findings: [['warning', 'layer', 'queue my-claims', 'another version of the kit']],
  });
  await control(
    'an override of a type the upgrade removes, which fits the server now: an error',
    stand,
    {
      packages: upgrade(withLegacyType, (directory) =>
        notes(directory, [{ version: MINOR, item: 'type PayersLegacyNote', note: 'Gone.' }]),
      ),
      server: (state) => {
        state.model.doctypes.PayersLegacyNote = {
          parent: 'Document',
          facets: [],
          schemas: ['dublincore'],
        };
        layerWith(state, null, {
          path: 'layouts/PayersLegacyNote/view.layout.json',
          live: {
            version: 2,
            columns: 1,
            cards: [{ id: 'note', label: 'Note', fields: ['dc:title'] }],
          },
        });
      },
      exit: 1,
      findings: [['error', 'layer', 'layout PayersLegacyNote/view', 'is not in the content model']],
    },
  );
  await control(
    'a draft of a file with no override in force, which the export does not list: a warning',
    stand,
    {
      packages: upgrade(),
      server: (state, installed) =>
        layerWith(state, queueOf(installed), {
          live: null,
          draft: { ...queueOf(installed), rowActions: ['payers.claim.gone'] },
        }),
      exit: 0,
      findings: [['warning', 'layer', 'queue my-claims', 'saved by designer-one']],
    },
  );
  await control(
    'a configuration that holds none of its properties: the ids cannot be read, exit 2',
    stand,
    {
      packages: upgrade(),
      server: (state, installed) => {
        state.configuration = { 'entity-type': 'configuration' };
        layerWith(state, queueOf(installed), { live: queueOf(installed) });
      },
      exit: 2,
      says: ['with no runtimeProperties or configuredProperties'],
    },
  );
  await control('an override naming a row action the deployment registers: fits, kept', stand, {
    packages: upgrade(),
    server: (state, installed) => {
      state.properties['nuxeo.agentic.ui.layer.registered.rowActions'] =
        'deployment.flag, other.one';
      layerWith(state, queueOf(installed), {
        live: { ...queueOf(installed), rowActions: ['deployment.flag'] },
      });
    },
    exit: 0,
    none: true,
  });

  // Vocabularies.
  await control("a vocabulary's new entry, which the server does not load: an error", stand, {
    packages: upgrade(undefined, csvChanged),
    exit: 1,
    findings: [['error', 'vocabularies', 'vocabulary PayersClaimDecision', 'refer']],
  });
  await control(
    "a vocabulary loaded again at each start, with an administrator's entry: a warning, and no error for the new one",
    stand,
    {
      packages: upgrade(undefined, (directory) => {
        csvChanged(directory);
        edit(
          directory,
          'bundle/OSGI-INF/payers-claims-demo-workflow.xml',
          '<createTablePolicy>on_missing_columns</createTablePolicy>',
          '<createTablePolicy>always</createTablePolicy>',
        );
      }),
      server: (state) => (state.directories.PayersClaimDecision = ['approve', 'deny', 'escalate']),
      exit: 0,
      findings: [['warning', 'vocabularies', 'vocabulary PayersClaimDecision', 'escalate']],
    },
  );

  // What the server already says.
  await control(
    'what the server reports wrong before the upgrade: a warning for each, exit 0',
    stand,
    {
      packages: upgrade(),
      server: (state) => {
        state.diagnostics = [
          {
            level: 'error',
            code: 'action-refused',
            message: 'payers-claims actions.json: refused.',
            app: APP,
            bundle: BUNDLE,
          },
        ];
        state.runtimeErrors = ['Component nuxeo.customer.layer is pending.'];
      },
      exit: 0,
      findings: [
        ['warning', 'diagnostics', `app ${APP}`, 'payers-claims actions.json: refused.'],
        ['warning', 'diagnostics', 'runtime', 'nuxeo.customer.layer is pending'],
      ],
    },
  );

  // Refusals: a server it cannot identify, or a version it cannot hold the upgrade to.
  await control('/me answers the anonymous guest: refused', stand, {
    packages: upgrade(),
    server: (state) => (state.me = { 'entity-type': 'user', id: 'Guest', isAnonymous: true }),
    exit: 2,
    says: ['anonymous guest'],
    requests: (seen) => seen.length === 1,
  });
  await control('the account is not an administrator: refused', stand, {
    packages: upgrade(),
    server: (state) => (state.me = { ...state.me, isAdministrator: false }),
    exit: 2,
    says: ['is not an administrator'],
  });
  await control('/me answers a redirect: refused, and the redirect is not followed', stand, {
    packages: upgrade(),
    server: (state) => (state.meRedirect = true),
    exit: 2,
    says: ['a redirect, which is not followed'],
    requests: (seen) =>
      seen.length === 1 && !seen.some((each) => each.url.startsWith('/elsewhere')),
  });
  await control('the kit is not installed: refused', stand, {
    packages: upgrade(),
    server: (state) => (state.bundles = state.bundles.filter((name) => name !== BUNDLE)),
    exit: 2,
    says: [`has no bundle ${BUNDLE}`],
  });
  await control('no nuxeo-agentic-ui on the server: refused', stand, {
    packages: upgrade(),
    server: (state) =>
      (state.bundles = state.bundles.filter((name) => name !== 'org.nuxeo.agentic.core')),
    exit: 2,
    says: ['nuxeo-agentic-ui is not installed there'],
  });
  await control(
    'the version cannot be read, the listing gone and the app not shown: refused',
    stand,
    {
      packages: upgrade(),
      server: (state) => (state.listing = false),
      exit: 2,
      says: ['cannot be read', 'none of its groups'],
    },
  );
  await control('the app registry alone gives the version: kept', stand, {
    packages: upgrade(),
    server: (state, installed) => {
      state.listing = false;
      state.registry = [
        { id: APP, bundle: BUNDLE, content: { id: APP, packageVersion: versionOf(installed) } },
      ];
    },
    exit: 0,
    none: true,
    says: ['"the app registry"'],
  });
  await control('the package manager and the app registry disagree: refused', stand, {
    packages: upgrade(),
    server: (state) =>
      (state.registry = [{ id: APP, bundle: BUNDLE, content: { id: APP, packageVersion: OLDER } }]),
    exit: 2,
    says: ['the app registry says', 'is not known'],
  });
  await control('two versions of the kit running at once: refused', stand, {
    packages: upgrade(),
    server: (state, installed) =>
      state.packages.push({ id: `${NAME}-${OLDER}`, state: 'running' }) && versionOf(installed),
    exit: 2,
    says: ['running at once'],
  });
  await control(
    'a version in a state the check does not know, such as an install in progress: refused',
    stand,
    {
      packages: upgrade(),
      server: (state) =>
        state.packages.push({ id: `${NAME}-${MINOR}`, state: 'installation in progress' }),
      exit: 2,
      says: ['in a state this does not know'],
    },
  );
  await control("Node told to use the environment's proxy: refused, nothing sent", stand, {
    packages: upgrade(),
    env: { NODE_USE_ENV_PROXY: '1' },
    exit: 2,
    says: ["environment's proxy"],
    requests: (seen) => seen.length === 0,
  });
  await control('the version installed waits for a restart: refused', stand, {
    packages: upgrade(),
    server: (state, installed) =>
      (state.packages = [{ id: `${NAME}-${versionOf(installed)}`, state: 'Installed' }]),
    exit: 2,
    says: ['waiting for a restart'],
  });
  await control('--previous is another version than the one installed: refused', stand, {
    packages: (scratch) => ({
      installed: kit(scratch, 'installed', VERSION),
      previous: kit(scratch, 'other', OLDER),
      next: kit(scratch, 'next', MINOR),
    }),
    exit: 2,
    says: [`--previous is ${NAME} ${OLDER}, and the server has ${VERSION} installed`],
  });
  await control('another version installed, and no --previous: refused', stand, {
    packages: (scratch) => ({
      installed: kit(scratch, 'installed', VERSION),
      next: kit(scratch, 'next', MINOR),
    }),
    exit: 2,
    says: ['give the package as installed with --previous'],
  });
  await control('a newer version installed than the package: refused, a downgrade', stand, {
    packages: (scratch) => {
      const installed = kit(scratch, 'installed', MINOR);
      return { installed, previous: installed, next: kit(scratch, 'next', VERSION) };
    },
    exit: 2,
    says: ['not a downgrade'],
  });
  await control(
    'the installed version serves a layout otherwise than the package held to: refused',
    stand,
    {
      packages: itself,
      server: (state) =>
        (state.layouts[0].content = { ...state.layouts[0].content, labelKey: 'payers.other' }),
      exit: 2,
      says: ['another build', 'mp-install skips a version already installed'],
    },
  );
  await control(
    'the installed version serves a layout the package held to does not have: refused',
    stand,
    {
      packages: itself,
      server: (state) =>
        state.layouts.push({ type: 'Claim', mode: 'edit', content: { version: 2 } }),
      exit: 2,
      says: [
        'serves the edit layout of Claim records from layouts/Claim/edit.layout.json, which the package does not have',
      ],
    },
  );
  await control('no NUXEO_PASS: refused, nothing sent', stand, {
    packages: upgrade(),
    env: { NUXEO_PASS: '' },
    exit: 2,
    says: ['must both be set'],
    requests: (seen) => seen.length === 0,
  });
  await control('an address that holds credentials: refused, nothing sent', stand, {
    packages: upgrade(),
    args: ['--server', stand.address.replace('http://', 'http://someone:secret@')],
    exit: 2,
    says: ['carries credentials'],
    requests: (seen) => seen.length === 0,
  });
  await control('plain HTTP to another machine: refused, nothing sent', stand, {
    packages: upgrade(),
    args: ['--server', 'http://nuxeo.example.invalid/nuxeo'],
    exit: 2,
    says: ['HTTPS only'],
    requests: (seen) => seen.length === 0,
  });
} finally {
  stand.server.close();
}

if (failures.length > 0) {
  console.error(`app-upgrade-server selftest: ${failures.length} control(s) did not hold:\n`);
  for (const failure of failures) console.error(`- ${failure}\n`);
  process.exit(1);
}
console.log(
  `app-upgrade-server selftest: ${negative} negative control(s) refused for their own reason, ` +
    `${positive} sound one(s) kept; every request a GET with the credentials, and the password never printed.`,
);
