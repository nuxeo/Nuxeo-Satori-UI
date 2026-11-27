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
 *
 * Since the kit's 0.2.0, the watermark, as the stand-in applies the kit's policy: the delivery's key
 * art marked for its distributor and the master and the subtitles not; a delivery whose key art is
 * no picture refused whole; the still refused unmarked to an outside partner and to an
 * administrator, served as it is to staff, and served marked, naming its reader, by
 * `Asset.GetWatermarked`.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEMO,
  DELIVERIES,
  FILES,
  FILM,
  FILMS,
  GRANTS,
  GROUPS,
  LOCALISED,
  VERSIONS,
  WORKSPACE,
  filesOf,
  todayUtc,
  versionName,
  watermarkText,
  windowsFrom,
} from './data.mjs';
import { basic, fillWatermark, jpegComment, kitPolicy, startStandIn } from './stand-in.mjs';

const SEED = join(dirname(fileURLToPath(import.meta.url)), 'seed.mjs');
/** The stand-in's one password, made for each run: no credential is written in the repository. */
const PASSWORD = randomBytes(18).toString('base64url');
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
  partner: { password: PASSWORD, groups: [GROUPS.partners] },
};

/** A GET of `path` under the stand-in's address, as `user`: its status, type and bytes. */
async function download(stub, user, path) {
  const response = await fetch(`${stub.url}${path}`, {
    headers: { Authorization: basic(user, PASSWORD) },
  });
  return {
    status: response.status,
    type: response.headers.get('content-type'),
    bytes: Buffer.from(await response.arrayBuffer()),
  };
}

/** `Asset.GetWatermarked` of `use` of `doc`, as `user`. */
async function marked(stub, user, doc, use) {
  const response = await fetch(`${stub.url}/nuxeo/api/v1/automation/Asset.GetWatermarked`, {
    method: 'POST',
    headers: { Authorization: basic(user, PASSWORD), 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: `doc:${doc.uid}`, params: { use } }),
  });
  return {
    status: response.status,
    type: response.headers.get('content-type'),
    bytes: Buffer.from(await response.arrayBuffer()),
  };
}

function run(url, { env = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SEED], {
      env: {
        PATH: process.env.PATH,
        NUXEO_URL: url,
        NUXEO_USER: 'admin',
        NUXEO_PASS: PASSWORD,
        NUXEO_TIMEOUT_MS: '5000',
        ...env,
      },
    });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('close', (status) => resolve({ status, output }));
  });
}

const writes = (requests) => requests.filter((each) => each.method !== 'GET');
const filedDeliveries = (requests) =>
  requests.filter((each) => each.json?.type === 'MediaDelivery');

/** A delivery filed on the stand-in as `user`, as the demo files it. */
async function file(stub, user, { version, distributor, territory }) {
  const target = stub.docs.get(
    `${ROOT}/${VERSIONS.name}/${versionName(LOCALISED.find((each) => each.key === version))}`,
  );
  const response = await fetch(`${stub.url}/nuxeo/api/v1/path${ROOT}/${DELIVERIES.name}`, {
    method: 'POST',
    headers: { Authorization: basic(user, PASSWORD), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      'entity-type': 'document',
      type: 'MediaDelivery',
      name: `${version}-${territory}-${Date.now()}`,
      properties: {
        'mdlv:version': target.uid,
        'mdlv:distributor': distributor,
        'mdlv:territory': territory,
      },
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

// 3. The assets add-on 0.5.0 not installed: refused, naming it.
{
  const stub = await startStandIn({
    users: USERS,
    today,
    types: ['Workspace', 'Folder', 'Film', 'FilmVersion'],
  });
  const result = await run(stub.url);
  check(
    'no assets add-on: exit 2, naming it',
    result.status === 2 && result.output.includes('nuxeo-agentic-assets 0.5.0'),
    result.output,
  );
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
    check(
      `seeded: the ${version.language} version names the film`,
      doc?.properties['fver:film'] === film?.uid,
    );
    check(
      `seeded: the ${version.language} version's own territories and channels`,
      JSON.stringify(doc?.properties['fver:territories']) === JSON.stringify(version.territories) &&
        JSON.stringify(doc?.properties['fver:channels']) === JSON.stringify(version.channels),
    );
    const files = doc?.properties['files:files'] ?? [];
    check(
      `seeded: the ${version.language} version's master, subtitles, key art and still, in that order, each stored`,
      files.length === 4 &&
        files.every((entry) => entry.file?.digest) &&
        /master/.test(files[0].file.name) &&
        /subtitles/.test(files[1].file.name) &&
        /key-art/.test(files[2].file.name) &&
        /still/.test(files[3].file.name),
      JSON.stringify(files.map((entry) => entry.file?.name)),
    );
    check(
      `seeded: the ${version.language} version's key art and still are PNG pictures, as drawn`,
      files[2]?.file?.['mime-type'] === 'image/png' &&
        files[3]?.file?.['mime-type'] === 'image/png' &&
        Number(files[3].file.length) === filesOf(version)[3].bytes.length,
      JSON.stringify(files.map((entry) => entry.file?.['mime-type'])),
    );
  }
  const deliveries = stub.docs.get(`${ROOT}/${DELIVERIES.name}`);
  check('seeded: the deliveries folder', deliveries?.type === 'Folder');
  for (const { folder, group, permission } of GRANTS) {
    const at = stub.docs.get(`${ROOT}/${folder}`);
    check(
      `seeded: ${permission} on ${folder} for ${group}`,
      at?.acl.some((ace) => ace.username === group && ace.permission === permission && ace.granted),
    );
  }
  check(
    'seeded: no delivery filed',
    filedDeliveries(stub.requests).length === 0 &&
      ![...stub.docs.values()].some((doc) => doc.type === 'MediaDelivery'),
  );
  check(
    'seeded: every request with Basic credentials',
    stub.requests.every((each) => each.authorization?.startsWith('Basic ')),
  );
  check('seeded: the password never printed', !result.output.includes(PASSWORD));

  // 5. Run again: nothing added, uploaded or granted twice.
  const before = writes(stub.requests).length;
  const again = await run(stub.url);
  check('again: exit 0', again.status === 0, again.output);
  check(
    'again: nothing written',
    writes(stub.requests).length === before,
    `${writes(stub.requests).length - before} write(s)`,
  );

  // 6. The demo's cases, as data.mjs names them, on what the seed wrote.
  const inside = await file(stub, 'coordinator', DEMO.inside);
  check(
    'the demo: inside its windows, delivered',
    inside.status === 201,
    JSON.stringify(inside.body),
  );
  check(
    'the demo: what was delivered, the three files with their digests',
    inside.body.properties?.['mdlv:files']?.length === 3 &&
      inside.body.properties['mdlv:files'].every((each) => each.digest),
  );
  const delivered = inside.body.properties?.['mdlv:files'] ?? [];
  check(
    'the demo: the key art marked for its distributor, the master and the subtitles not',
    JSON.stringify(delivered.map((each) => each.watermarked)) ===
      JSON.stringify([false, false, true]) &&
      delivered[2].watermarkedFor === DEMO.inside.distributor &&
      delivered[2].watermark === watermarkText(DEMO.inside.distributor, today) &&
      delivered.slice(0, 2).every((each) => each.watermarkedFile === null),
    JSON.stringify(
      delivered.map(({ watermarked, watermarkedFor, watermark }) => ({
        watermarked,
        watermarkedFor,
        watermark,
      })),
    ),
  );
  check(
    "the demo: the delivery holds the key art marked, a JPEG apart from the version's",
    delivered[2]?.watermarkedFile?.['mime-type'] === 'image/jpeg' &&
      delivered[2].watermarkedFile.digest &&
      delivered[2].watermarkedFile.digest !== delivered[2].digest,
    JSON.stringify(delivered[2]?.watermarkedFile),
  );
  for (const [name, refusal] of [
    ['outside', DEMO.outside],
    ['whole', DEMO.whole],
    ['territory', DEMO.territory],
  ]) {
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
    /files:files\/2\/file outside-window for Marketing/.test(whole.body.message) &&
      !/original/.test(whole.body.message),
    whole.body.message,
  );
  const outsider = await file(stub, 'outsider', DEMO.inside);
  check(
    'the demo: someone who may not read the version is refused, 403',
    outsider.status === 403,
    JSON.stringify(outsider.body),
  );
  const made = [...stub.docs.values()].filter((doc) => doc.type === 'MediaDelivery');
  check(
    'the demo: one delivery made, the one inside its windows',
    made.length === 1 && made[0].properties['mdlv:territory'] === DEMO.inside.territory,
  );

  // The still, a preview the watermark marks for anyone outside the kit's staff.
  const french = stub.docs.get(
    `${ROOT}/${VERSIONS.name}/${versionName(LOCALISED.find((each) => each.key === 'french'))}`,
  );
  const stillPath = `/nuxeo/api/v1/id/${french.uid}/@blob/${FILES.still}`;
  const stillBytes = filesOf(LOCALISED.find((each) => each.key === 'french'))[3].bytes;
  const partnerStill = await download(stub, 'partner', stillPath);
  check(
    'the still: refused unmarked to an outside partner, 403 watermark-required',
    partnerStill.status === 403 && partnerStill.bytes.toString().includes('watermark-required'),
    `${partnerStill.status} ${partnerStill.bytes.toString().slice(0, 200)}`,
  );
  const nxfile = await download(
    stub,
    'partner',
    `/nuxeo/nxfile/default/${french.uid}/${FILES.still}`,
  );
  check('the still: refused at /nxfile/ too', nxfile.status === 403, String(nxfile.status));
  check(
    'the still: refused unmarked to an administrator, whom no group exempts',
    (await download(stub, 'admin', stillPath)).status === 403,
  );
  const staffStill = await download(stub, 'coordinator', stillPath);
  check(
    'the still: served as it is to a distribution coordinator',
    staffStill.status === 200 &&
      staffStill.type === 'image/png' &&
      staffStill.bytes.equals(stillBytes),
    `${staffStill.status} ${staffStill.type}`,
  );
  const forPartner = await marked(stub, 'partner', french, `blob:${FILES.still}`);
  check(
    'the still: served marked to the partner, a JPEG naming them',
    forPartner.status === 200 &&
      forPartner.type === 'image/jpeg' &&
      forPartner.bytes[0] === 0xff &&
      forPartner.bytes[1] === 0xd8 &&
      !forPartner.bytes.equals(stillBytes) &&
      jpegComment(forPartner.bytes) === watermarkText('partner', today),
    `${forPartner.status} ${forPartner.type} ${jpegComment(forPartner.bytes)}`,
  );
  check(
    'the key art is not marked for a download: not served by Asset.GetWatermarked, 404',
    (await marked(stub, 'partner', french, `blob:${FILES.keyArt}`)).status === 404,
  );
  const textArt = french.properties['files:files'][2].file;
  french.properties['files:files'][2].file = { ...textArt, 'mime-type': 'text/plain' };
  const unmarkable = await file(stub, 'coordinator', DEMO.inside);
  check(
    'a delivery whose key art is no picture: refused whole, watermark-unavailable',
    unmarkable.status === 403 &&
      String(unmarkable.body.message).includes(FILES.keyArt) &&
      String(unmarkable.body.message).includes('cannot be marked'),
    JSON.stringify(unmarkable.body),
  );
  french.properties['files:files'][2].file = textArt;

  // The stand-in refuses as the add-on does what the add-on refuses: a window it cannot read, a
  // film of another type, and a distributor's name with a control character in it.
  const seededFilm = stub.docs.get(`${ROOT}/${FILMS.name}/${FILM.name}`);
  const windows = seededFilm.properties['film:windows'];
  seededFilm.properties['film:windows'] = [
    ...windows,
    { territory: 'FR', channel: 'SVOD', from: null, until: null },
  ];
  const unreadable = await file(stub, 'coordinator', DEMO.inside);
  check(
    'the stand-in: a window with no first day refuses, policy-error',
    unreadable.status === 403 && String(unreadable.body.message).includes('policy-error'),
    JSON.stringify(unreadable.body),
  );
  seededFilm.properties['film:windows'] = windows;
  seededFilm.type = 'Folder';
  const notAFilm = await file(stub, 'coordinator', DEMO.inside);
  check(
    'the stand-in: a film of another type refuses, policy-error',
    notAFilm.status === 403 && String(notAFilm.body.message).includes('policy-error'),
    JSON.stringify(notAFilm.body),
  );
  seededFilm.type = 'Film';
  const control = await file(stub, 'coordinator', {
    ...DEMO.inside,
    distributor: 'Acme\u0007Distribution',
  });
  check(
    'the stand-in: a control character in the distributor refuses, 400',
    control.status === 400,
    JSON.stringify(control.body),
  );
  check(
    'the stand-in: no delivery made by any of the three',
    [...stub.docs.values()].filter((doc) => doc.type === 'MediaDelivery').length === 1,
  );
  await stub.close();
}

// 7. A place holding a document of another type: stopped, and left alone.
{
  const stub = await startStandIn({ users: USERS, today });
  await run(stub.url);
  const film = stub.docs.get(`${ROOT}/${FILMS.name}/${FILM.name}`);
  film.type = 'Folder';
  const result = await run(stub.url);
  check(
    'another type in place: exit 1, naming it',
    result.status === 1 && result.output.includes(FILM.name),
    result.output,
  );
  await stub.close();
}

// 8. The stand-in decides by the kit's own policy file, as the add-on reads it.
{
  const policy = kitPolicy();
  check(
    'the kit policy: the film is where versions read their windows',
    policy.windows === 'film:windows' && policy.windowsDocument === 'fver:film',
  );
  check(
    'the kit policy: the master and the subtitles for SVOD, the key art for Marketing',
    policy.rules.get('original') === 'SVOD' &&
      policy.rules.get('blob files:files/1/file') === 'SVOD' &&
      policy.rules.get('blob files:files/2/file') === 'Marketing',
  );
  check(
    'the kit policy: the still a preview, the thumbnail too',
    policy.previews.has(`blob ${FILES.still}`) && policy.previews.has('rendition thumbnail'),
  );
  check(
    'the kit policy: the watermark marks the still on previews, the key art on deliveries, and no download',
    JSON.stringify(policy.watermark?.previews) === JSON.stringify([`blob ${FILES.still}`]) &&
      JSON.stringify(policy.watermark?.deliveries) === JSON.stringify([`blob ${FILES.keyArt}`]) &&
      policy.watermark?.downloads === undefined,
    JSON.stringify(policy.watermark),
  );
  check(
    "the kit policy: the watermark exempts the kit's staff, and not its partners",
    JSON.stringify(policy.watermark?.except) ===
      JSON.stringify([GROUPS.rights, GROUPS.distribution]),
  );
  check(
    'the kit policy: its text is the one data.mjs expects, naming its recipient and the day',
    fillWatermark(policy.watermark, { recipient: 'Someone', user: 'u', day: '2026-11-27' }) ===
      watermarkText('Someone', '2026-11-27'),
    policy.watermark?.text,
  );
  check(
    'the kit policy: a delivery carries all three',
    JSON.stringify(policy.delivery) ===
      JSON.stringify([
        { use: 'original', name: null },
        { use: 'blob', name: 'files:files/1/file' },
        { use: 'blob', name: 'files:files/2/file' },
      ]),
  );
}

console.log(failures === 0 ? '\nEvery control passed.' : `\n${failures} control(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
