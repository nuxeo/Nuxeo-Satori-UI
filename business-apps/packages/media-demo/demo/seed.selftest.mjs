#!/usr/bin/env node
/**
 * The media kit seed's controls, against the kit's stand-in for the parts of Nuxeo's REST API it
 * calls (`stand-in.mjs`), on the loopback interface. No Nuxeo, no install, no credential of anyone's.
 *
 *   node business-apps/packages/media-demo/demo/seed.selftest.mjs
 *
 * Each control runs the seed as a command and checks what it asked the stand-in and what it said.
 * The seed must never file a delivery: that is the demo's, a distribution coordinator's. The last
 * controls hold the demo's four cases in data.mjs to the seeded data, on the stand-in's decision,
 * which is the add-on's as its own tests hold it.
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEMO, DELIVERIES, FILM, FILMS, GRANTS, LOCALISED, VERSIONS, WORKSPACE, todayUtc, versionName, windowsFrom } from './data.mjs';
import { basic, kitPolicy, startStandIn } from './stand-in.mjs';

const SEED = join(dirname(fileURLToPath(import.meta.url)), 'seed.mjs');
const PASSWORD = 'not-a-real-password-for-the-stand-in';
const ROOT = `/default-domain/workspaces/${WORKSPACE.name}`;
let failures = 0;

function check(name, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : `: ${detail}`}`);
  if (!ok) failures++;
}

const USERS = {
  admin: { password: PASSWORD, administrator: true },
  coordinator: { password: PASSWORD, groups: ['media-distribution'] },
  outsider: { password: PASSWORD, groups: [] },
};

function run(url, { env = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SEED], {
      env: { PATH: process.env.PATH, NUXEO_URL: url, NUXEO_USER: 'admin', NUXEO_PASS: PASSWORD, NUXEO_TIMEOUT_MS: '5000', ...env },
    });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('close', (status) => resolve({ status, output }));
  });
}

const writes = (requests) => requests.filter((each) => each.method !== 'GET');
const filedDeliveries = (requests) => requests.filter((each) => each.json?.type === 'MediaDelivery');

/** A delivery filed on the stand-in as `user`, as the demo files it. */
async function file(stub, user, { version, distributor, territory }) {
  const target = stub.docs.get(`${ROOT}/${VERSIONS.name}/${versionName(LOCALISED.find((each) => each.key === version))}`);
  const response = await fetch(`${stub.url}/nuxeo/api/v1/path${ROOT}/${DELIVERIES.name}`, {
    method: 'POST',
    headers: { Authorization: basic(user, PASSWORD), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      'entity-type': 'document',
      type: 'MediaDelivery',
      name: `${version}-${territory}-${Date.now()}`,
      properties: { 'mdlv:version': target.uid, 'mdlv:distributor': distributor, 'mdlv:territory': territory },
    }),
  });
  return { status: response.status, body: await response.json() };
}

const today = todayUtc();

// 1. No credentials: refused before anything is asked.
{
  const stub = await startStandIn({ users: USERS, today });
  const result = await run(stub.url, { env: { NUXEO_USER: '', NUXEO_PASS: '' } });
  check('no credentials: exit 2', result.status === 2, result.output);
  check('no credentials: nothing asked of the server', stub.requests.length === 0);
  await stub.close();
}

// 2. Not an administrator: refused before any write.
{
  const stub = await startStandIn({ users: USERS, today });
  const result = await run(stub.url, { env: { NUXEO_USER: 'coordinator' } });
  check('not an administrator: exit 2', result.status === 2, result.output);
  check('not an administrator: nothing written', writes(stub.requests).length === 0);
  await stub.close();
}

// 3. The assets add-on 0.4.0 not installed: refused, naming it.
{
  const stub = await startStandIn({ users: USERS, today, types: ['Workspace', 'Folder', 'Film', 'FilmVersion'] });
  const result = await run(stub.url);
  check('no assets add-on: exit 2, naming it', result.status === 2 && result.output.includes('nuxeo-agentic-assets 0.4.0'), result.output);
  check('no assets add-on: nothing written', writes(stub.requests).length === 0);
  await stub.close();
}

// 4. A server with both packages: everything seeded, and no delivery filed.
{
  const stub = await startStandIn({ users: USERS, today });
  const result = await run(stub.url);
  check('seeded: exit 0', result.status === 0, result.output);
  const film = stub.docs.get(`${ROOT}/${FILMS.name}/${FILM.name}`);
  check('seeded: the film', film?.type === 'Film' && film.properties['dc:title'] === FILM.title);
  check(
    "seeded: the film's windows, days from today",
    JSON.stringify(film?.properties['film:windows']) === JSON.stringify(windowsFrom(today)),
    JSON.stringify(film?.properties['film:windows']),
  );
  const versions = [...stub.docs.values()].filter((doc) => doc.type === 'FilmVersion');
  check('seeded: every localised version of data.mjs', versions.length === LOCALISED.length);
  for (const version of LOCALISED) {
    const doc = stub.docs.get(`${ROOT}/${VERSIONS.name}/${versionName(version)}`);
    check(`seeded: the ${version.language} version names the film`, doc?.properties['fver:film'] === film?.uid);
    check(
      `seeded: the ${version.language} version's own territories and channels`,
      JSON.stringify(doc?.properties['fver:territories']) === JSON.stringify(version.territories) &&
        JSON.stringify(doc?.properties['fver:channels']) === JSON.stringify(version.channels),
    );
    const files = doc?.properties['files:files'] ?? [];
    check(
      `seeded: the ${version.language} version's master, subtitles and key art, in that order, each stored`,
      files.length === 3 && files.every((entry) => entry.file?.digest) && /master/.test(files[0].file.name) &&
        /subtitles/.test(files[1].file.name) && /key-art/.test(files[2].file.name),
      JSON.stringify(files.map((entry) => entry.file?.name)),
    );
  }
  const deliveries = stub.docs.get(`${ROOT}/${DELIVERIES.name}`);
  check('seeded: the deliveries folder', deliveries?.type === 'Folder');
  for (const { folder, group, permission } of GRANTS) {
    const at = stub.docs.get(`${ROOT}/${folder}`);
    check(`seeded: ${permission} on ${folder} for ${group}`, at?.acl.some((ace) => ace.username === group && ace.permission === permission && ace.granted));
  }
  check('seeded: no delivery filed', filedDeliveries(stub.requests).length === 0 && ![...stub.docs.values()].some((doc) => doc.type === 'MediaDelivery'));
  check('seeded: every request with Basic credentials', stub.requests.every((each) => each.authorization?.startsWith('Basic ')));
  check('seeded: the password never printed', !result.output.includes(PASSWORD));

  // 5. Run again: nothing added, uploaded or granted twice.
  const before = writes(stub.requests).length;
  const again = await run(stub.url);
  check('again: exit 0', again.status === 0, again.output);
  check('again: nothing written', writes(stub.requests).length === before, `${writes(stub.requests).length - before} write(s)`);

  // 6. The demo's cases, as data.mjs names them, on what the seed wrote.
  const inside = await file(stub, 'coordinator', DEMO.inside);
  check('the demo: inside its windows, delivered', inside.status === 201, JSON.stringify(inside.body));
  check(
    'the demo: what was delivered, the three files with their digests',
    inside.body.properties?.['mdlv:files']?.length === 3 && inside.body.properties['mdlv:files'].every((each) => each.digest),
  );
  for (const [name, refusal] of [['outside', DEMO.outside], ['whole', DEMO.whole], ['territory', DEMO.territory]]) {
    const refused = await file(stub, 'coordinator', refusal);
    check(
      `the demo: ${name}, refused with ${refusal.reason}`,
      refused.status === 403 && String(refused.body.message).includes(refusal.reason),
      JSON.stringify(refused.body),
    );
  }
  const whole = await file(stub, 'coordinator', DEMO.whole);
  check(
    'the demo: the package to BE is refused for its key art alone',
    /files:files\/2\/file outside-window for Marketing/.test(whole.body.message) && !/original/.test(whole.body.message),
    whole.body.message,
  );
  const outsider = await file(stub, 'outsider', DEMO.inside);
  check('the demo: someone who may not read the version is refused, 403', outsider.status === 403, JSON.stringify(outsider.body));
  const made = [...stub.docs.values()].filter((doc) => doc.type === 'MediaDelivery');
  check('the demo: one delivery made, the one inside its windows', made.length === 1 && made[0].properties['mdlv:territory'] === DEMO.inside.territory);
  await stub.close();
}

// 7. A place holding a document of another type: stopped, and left alone.
{
  const stub = await startStandIn({ users: USERS, today });
  await run(stub.url);
  const film = stub.docs.get(`${ROOT}/${FILMS.name}/${FILM.name}`);
  film.type = 'Folder';
  const result = await run(stub.url);
  check('another type in place: exit 1, naming it', result.status === 1 && result.output.includes(FILM.name), result.output);
  await stub.close();
}

// 8. The stand-in decides by the kit's own policy file, as the add-on reads it.
{
  const policy = kitPolicy();
  check('the kit policy: the film is where versions read their windows', policy.windows === 'film:windows' && policy.windowsDocument === 'fver:film');
  check(
    "the kit policy: the master and the subtitles for SVOD, the key art for Marketing",
    policy.rules.get('original') === 'SVOD' && policy.rules.get('blob files:files/1/file') === 'SVOD' && policy.rules.get('blob files:files/2/file') === 'Marketing',
  );
  check('the kit policy: a delivery carries all three', JSON.stringify(policy.delivery) === JSON.stringify([
    { use: 'original', name: null }, { use: 'blob', name: 'files:files/1/file' }, { use: 'blob', name: 'files:files/2/file' },
  ]));
}

console.log(failures === 0 ? '\nEvery control passed.' : `\n${failures} control(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
