#!/usr/bin/env node
/**
 * Seed a Nuxeo server for the media kit: a fictional film with its release windows, its three
 * localised versions, each with its own rights and its three files, and the folder deliveries are
 * filed in, with the kit's two groups' permissions. It files no delivery: that is the demo's, by a
 * distribution coordinator (the kit's README, "The demo").
 *
 *   node business-apps/packages/media-demo/demo/seed.mjs
 *
 * Needs, installed first: the assets add-on (nuxeo-agentic-assets) 0.4.0, whose MediaDelivery the
 * deliveries are and whose rights policy decides them, and this kit, whose stand-in types, Film and
 * FilmVersion, the film and its versions are.
 *
 * Writes, under /default-domain/workspaces/media-demo:
 *   - films/, the film of data.mjs, its release windows days from today in UTC;
 *   - versions/, its localised versions, each naming the film, with its language, territories,
 *     channels and rights end, and its master, subtitles and key art as its attachments, in the
 *     order the kit's rights policy names them;
 *   - deliveries/, empty;
 *   - on each folder, the permissions data.mjs grants the kit's two groups.
 *
 * Environment:
 *   NUXEO_USER, NUXEO_PASS   required, with no default: an administrator's, since the seed grants
 *                            permissions.
 *   NUXEO_URL                the server, default http://localhost:8080
 *   NUXEO_TIMEOUT_MS         how long one request may take, its body included, default 30000
 *
 * **It creates no user and no group.** media-rights and media-distribution are the server's.
 *
 * **Safe to run twice.** A film or a version already there is left as it is, its windows and files
 * included, and said: the demo's cases hold for 30 days after the seed that wrote them (the
 * README). A place holding a document of another type stops the run.
 *
 * Node 24 and nothing else. Credentials are sent to NUXEO_URL only, as Basic authentication, and
 * never printed.
 *
 * Exit codes: 0, seeded; 1, the server refused a write or a check failed; 2, a precondition, found
 * before anything is written: no credentials, no server, not an administrator, or a package missing.
 */
import {
  DELIVERIES,
  FILM,
  FILMS,
  GRANTS,
  LOCALISED,
  VERSIONS,
  WORKSPACE,
  day,
  filesOf,
  todayUtc,
  versionName,
  versionTitle,
  windowsFrom,
} from './data.mjs';

const EXIT_PRECONDITION = 2;
const SERVER = (process.env['NUXEO_URL'] || 'http://localhost:8080').replace(/\/+$/, '');
const API = `${SERVER}/nuxeo/api/v1`;
const TIMEOUT_MS = Number(process.env['NUXEO_TIMEOUT_MS']) || 30_000;

const WORKSPACES = '/default-domain/workspaces';
const ROOT = `${WORKSPACES}/${WORKSPACE.name}`;

class Precondition extends Error {}

class HttpError extends Error {
  constructor(status, method, path, detail) {
    super(`${method} ${path}: HTTP ${status}${detail ? `, ${detail}` : ''}`);
    this.status = status;
  }
}

const username = process.env['NUXEO_USER'];
const password = process.env['NUXEO_PASS'];
if (!username || !password) {
  console.error(
    "NUXEO_USER and NUXEO_PASS must both be set, and neither has a default. Export an administrator's first:\n" +
      '  export NUXEO_USER=<user> NUXEO_PASS=<password>',
  );
  process.exit(EXIT_PRECONDITION);
}
const AUTHORIZATION = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
const tally = { created: 0, uploaded: 0, granted: 0 };
let preflighting = true;

try {
  await seed();
} catch (error) {
  if (error instanceof Precondition) {
    console.error(error.message);
    process.exit(EXIT_PRECONDITION);
  }
  console.error(error instanceof HttpError ? error.message : (error?.stack ?? String(error)));
  process.exit(1);
}

async function seed() {
  const today = todayUtc();
  console.log(`Seeding ${SERVER} for the media kit, on ${today} (UTC).`);
  await preflight();
  preflighting = false;

  await ensure(WORKSPACES, WORKSPACE.name, 'Workspace', {
    'dc:title': WORKSPACE.title,
    'dc:description': 'Fictional films for the media kit. No real studio, distributor, person or film.',
  });
  const folders = {};
  for (const folder of [FILMS, VERSIONS, DELIVERIES]) {
    folders[folder.name] = await ensure(ROOT, folder.name, 'Folder', { 'dc:title': folder.title });
  }
  for (const grant of GRANTS) await ensureGrant(folders[grant.folder], grant);

  const windows = windowsFrom(today);
  const film = await ensure(`${ROOT}/${FILMS.name}`, FILM.name, 'Film', {
    'dc:title': FILM.title,
    'dc:description': FILM.description,
    'film:year': FILM.year,
    'film:director': FILM.director,
    'film:genre': FILM.genre,
    'film:originalLanguage': FILM.originalLanguage,
    'film:windows': windows,
  });
  if (!film.created) {
    const held = (await call('GET', `/id/${film.uid}`, { schemas: 'film' }))?.properties?.['film:windows'];
    if (JSON.stringify(days(held)) !== JSON.stringify(windows))
      console.log(
        `  kept     ${film.path}: its release windows are an earlier seed's, so the demo's cases hold for 30 days after it`,
      );
  }

  for (const version of LOCALISED) {
    const name = versionName(version);
    const path = `${ROOT}/${VERSIONS.name}/${name}`;
    if ((await find(`/path${pathOf(path)}`)) !== null) {
      await ensure(`${ROOT}/${VERSIONS.name}`, name, 'FilmVersion', {});
      continue;
    }
    const files = [];
    for (const file of filesOf(version)) files.push({ file: await upload(file) });
    await ensure(`${ROOT}/${VERSIONS.name}`, name, 'FilmVersion', {
      'dc:title': versionTitle(version),
      'dc:expired': day(today, version.rightsForDays),
      'fver:film': film.uid,
      'fver:language': version.language,
      'fver:territories': version.territories,
      'fver:channels': version.channels,
      'files:files': files,
    });
  }

  const { created, uploaded, granted } = tally;
  console.log(`\nDone: ${created} created, ${uploaded} file(s) uploaded, ${granted} permission(s) granted.`);
  console.log(`The film: ${film.path} (${film.uid}). Deliveries are filed in ${ROOT}/${DELIVERIES.name}.`);
  console.log("The demo itself, deliveries filed by a distribution coordinator, is the kit's README's.");
}

async function preflight() {
  let me;
  try {
    me = await call('GET', '/me');
  } catch (error) {
    if (error instanceof HttpError && error.status === 401)
      throw new Precondition(`${SERVER} refused NUXEO_USER and NUXEO_PASS (HTTP 401).`);
    if (error instanceof HttpError)
      throw new Precondition(
        `${SERVER} answered GET /me with HTTP ${error.status}: is NUXEO_URL a Nuxeo server's address?`,
      );
    throw error;
  }
  if (me?.isAdministrator !== true)
    throw new Precondition(`${username} is not an administrator: only an administrator grants the kit's permissions.`);
  for (const [type, from] of [
    ['MediaDelivery', 'the assets add-on, nuxeo-agentic-assets 0.4.0'],
    ['Film', 'this kit, media-demo'],
    ['FilmVersion', 'this kit, media-demo'],
  ]) {
    if ((await find(`/config/types/${type}`)) === null)
      throw new Precondition(`${SERVER} has no ${type} type: install ${from} first, then run this again.`);
  }
  if ((await find(`/path${pathOf(WORKSPACES)}`)) === null)
    throw new Precondition(`${SERVER} has no ${WORKSPACES}, where the kit's workspace goes.`);
}

/** The windows as the server answers them, with their days only, to compare with today's. */
function days(windows) {
  return (Array.isArray(windows) ? windows : []).map(({ territory, channel, from, until }) => ({
    territory,
    channel,
    from: typeof from === 'string' ? from.slice(0, 10) : from,
    until: typeof until === 'string' ? until.slice(0, 10) : until,
  }));
}

/**
 * The document at `parent/name`, created with `properties` when it is not there, and then marked
 * `created`; refused when it is another type.
 */
async function ensure(parent, name, type, properties) {
  const path = `${parent === '/' ? '' : parent}/${name}`;
  const existing = await find(`/path${pathOf(path)}`);
  if (existing === null) {
    const created = await call('POST', `/path${pathOf(parent)}`, {
      json: { 'entity-type': 'document', name, type, properties },
    });
    tally.created++;
    console.log(`  created  ${path}`);
    return { ...created, created: true };
  }
  if (existing.type !== type)
    throw new Error(`${path} is a ${existing.type}, not a ${type}. It is not the seed's, so it is left alone.`);
  return existing;
}

/** A group's permission on a folder, added once. */
async function ensureGrant(folder, { group, permission }) {
  const acl = await call('GET', `/id/${folder.uid}/@acl`);
  const local = (acl?.acl ?? []).find((each) => each.name === 'local')?.aces ?? [];
  if (local.some((ace) => ace.username === group && ace.permission === permission && ace.granted === true)) return;
  await call('POST', '/automation/Document.AddPermission', {
    json: { input: `doc:${folder.uid}`, params: { users: [group], permission, notify: false } },
  });
  tally.granted++;
  console.log(`  granted  ${permission} on ${folder.path} to ${group}`);
}

/** A file uploaded to a new batch, as the value a document's blob property takes. */
async function upload({ fileName, bytes, mimeType }) {
  const { batchId } = await call('POST', '/upload/');
  await call('POST', `/upload/${batchId}/0`, {
    body: bytes,
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-File-Name': encodeURIComponent(fileName),
      'X-File-Type': mimeType,
      'X-File-Size': String(bytes.length),
    },
  });
  tally.uploaded++;
  return { 'upload-batch': batchId, 'upload-fileId': '0' };
}

function pathOf(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

async function find(path) {
  try {
    return await call('GET', path);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return null;
    throw error;
  }
}

async function call(method, path, { json, body, headers = {}, schemas } = {}) {
  const url = new URL(`${API}${path}`);
  const sent = { Authorization: AUTHORIZATION, Accept: 'application/json', ...headers };
  if (schemas) sent['X-NXproperties'] = schemas;
  if (json !== undefined) sent['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: sent,
      body: json === undefined ? body : JSON.stringify(json),
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    if (preflighting)
      throw new Precondition(`${SERVER} did not answer: ${error?.cause?.code ?? error?.name ?? error}.`);
    throw new Error(`${method} ${path}: no answer from ${SERVER}, ${error?.cause?.code ?? error?.name ?? error}.`);
  }
  const text = await response.text();
  if (!response.ok) {
    let detail = '';
    try {
      detail = JSON.parse(text)?.message ?? '';
    } catch {
      detail = '';
    }
    throw new HttpError(response.status, method, path, String(detail).slice(0, 300));
  }
  return text ? JSON.parse(text) : null;
}
