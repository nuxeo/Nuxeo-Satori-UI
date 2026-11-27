/**
 * The media kit's delivery packages: business apps phase 9's demo step 1, "A localised film
 * delivered to a distributor inside its window, and refused outside it"
 * (docs/business-apps/development-plan.md, phase 9, "Demo"), on the kit in
 * `business-apps/packages/media-demo`, version 0.2.0, with `nuxeo-agentic-assets` 0.5.0; and, since
 * the kit's 0.2.0, the watermarks of the plan's same phase: the delivery's key art marked for its
 * distributor, and a still from the film marked for an outside partner.
 *
 * **On a stand-in server.** No server has the add-on 0.5.0 or the kit: the local Nuxeo is read-only
 * here, and has the add-on's 0.1.0. So by default this file starts the kit's stand-in
 * (`demo/stand-in.mjs`), seeds it with the kit's own seed, and files the demo's deliveries there, over
 * the REST API, as a distribution coordinator would. The stand-in decides a delivery as the add-on
 * does, from the kit's own rights policy file; the add-on's own decision is held by its tests in
 * Nuxeo's test framework (`MediaDeliveryTest`, `mvn -pl nuxeo-agentic-assets -am verify`). What a
 * run here proves is the demo's script and its data: that the seeded film's windows put the French
 * version inside them in France, the German version outside them in Germany, and that the record
 * of a delivery says what the demo says it does.
 *
 * With `MEDIA_DEMO_SERVER`, a server's address, it runs the same steps there instead, on the kit
 * seeded with `demo/seed.mjs`, as `NUXEO_USER`, a member of `media-distribution`, and, for the still,
 * as `MEDIA_PARTNER_USER` and `MEDIA_PARTNER_PASS`, a member of `media-partners`: on a server without
 * them, the partner's checks are not run, and a note says so.
 *
 * The steps:
 *
 *   - **Set up:** the stand-in started and seeded (or the server named), and the film's windows
 *     read back: the demo's cases hold only within 30 days of the seed that wrote them.
 *   - **1, inside:** the French version delivered to a distributor in France. Read back: the
 *     record names the distributor, the territory and the version; its three files, master,
 *     subtitles and key art, each with its channel and the digest the version holds; who delivered
 *     it, and the day; the key art marked for the distributor, the text naming them, and held marked
 *     as a JPEG, the master and the subtitles not marked; and the queue of deliveries and the
 *     version's deliveries list it.
 *   - **1, outside:** the German version to a distributor in Germany, 35 days before SVOD opens
 *     there: refused, 403, `outside-window`, naming the master and the subtitles; nothing made.
 *   - **Refused whole:** the French version to Belgium, where SVOD is open and Marketing closed:
 *     refused for the key art alone, and the master and the subtitles are not delivered either.
 *   - **A version's own rights:** the French version to Germany, where the film's Marketing window
 *     is open: refused, `territory-not-covered`, since its own territories do not hold DE.
 *   - **The still, for an outside partner:** served as it is, a PNG, to the coordinator, whom the
 *     kit's watermark exempts; refused unmarked to a member of media-partners, 403
 *     `watermark-required`; and served to them marked by `Asset.GetWatermarked`, a JPEG apart from
 *     the still. On the stand-in, whose marked file is not the server's, its text naming the partner
 *     is read back too.
 *
 * Load-bearing checks: the delivery inside its windows made, and its record's distributor,
 * territory, version, files with their channels and digests, filer and day; the key art's mark, for
 * whom and with what text, and the marked file it holds; the two lists that show it; the still
 * served as it is to staff and marked to a partner. Negative ones: each refusal's status and reason,
 * the files it names and those it does not, and nothing made after it; the master and the subtitles
 * not marked; the still refused unmarked to the partner.
 *
 * Not covered, and said in notes: the pages, which the stand-in does not serve (the package pipeline
 * holds the kit's layouts and queues to its model); and the server's own decision, which the add-on's
 * tests hold.
 *
 *   npm run beta:evidence -- media-delivery
 *   MEDIA_DEMO_SERVER=http://localhost:8080 NUXEO_USER=<coordinator> NUXEO_PASS=<password> npm run beta:evidence -- media-delivery
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { requireStepCredentials } from '../helpers.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const KIT = join(REPO, 'business-apps', 'packages', 'media-demo');
const {
  DEMO,
  DELIVERIES,
  FILES,
  FILM,
  FILMS,
  LOCALISED,
  VERSIONS,
  WORKSPACE,
  todayUtc,
  versionName,
  watermarkText,
} = await import(join(KIT, 'demo', 'data.mjs'));
const { basic, jpegComment, startStandIn } = await import(join(KIT, 'demo', 'stand-in.mjs'));

/**
 * The runner sends no credentials: on the stand-in there are none to send, and on a server this
 * file sends the coordinator's itself, as its seed's requests do.
 */
export const skipHttpCredentials = true;

/**
 * What a server run of this file needs, for the release candidate's list of demo steps
 * (`scripts/release-candidate.mjs`), which reads it without running anything here.
 */
export const serverRun = {
  kit: basename(KIT),
  seeds: ['demo/seed.mjs'],
  runAs: {
    users: [],
    who: 'a member of media-distribution, who may read the versions and file deliveries',
  },
  signsInAs: [],
  needs: [
    'nuxeo-agentic-assets 0.5.0 and the kit 0.2.0 installed, and the kit seeded within 30 days of the demo',
    "MEDIA_PARTNER_USER and MEDIA_PARTNER_PASS, a member of media-partners, for the still's checks; without them those checks are not run",
    "MEDIA_DEMO_SERVER, the server's address; without it, the file runs on the kit's stand-in",
  ],
};

const ROOT = `/default-domain/workspaces/${WORKSPACE.name}`;

/**
 * @param {import('@playwright/test').Page} page
 * @param {ReturnType<import('../helpers.mjs').createHelpers>} h
 */
// eslint-disable-next-line no-unused-vars
export default async function run(page, h) {
  await h.step('Set up: the kit seeded, and its film read back');
  const server = process.env['MEDIA_DEMO_SERVER'];
  let standIn = null;
  let base;
  let filer;
  let partner = null;
  if (server) {
    const credentials = requireStepCredentials(
      'file the demo deliveries as a distribution coordinator',
    );
    base = server.replace(/\/+$/, '');
    filer = {
      username: credentials.username,
      authorization: basic(credentials.username, credentials.password),
    };
    const partnerUser = process.env['MEDIA_PARTNER_USER'];
    const partnerPass = process.env['MEDIA_PARTNER_PASS'];
    if (partnerUser && partnerPass)
      partner = { username: partnerUser, authorization: basic(partnerUser, partnerPass) };
    h.note(`on ${base}, as ${credentials.username}${partner ? `, and ${partnerUser}` : ''}`);
  } else {
    const password = randomBytes(18).toString('base64url');
    standIn = await startStandIn({
      today: todayUtc(),
      users: {
        'stand-in-admin': { password, administrator: true },
        'stand-in-coordinator': { password, groups: ['media-distribution'] },
        'stand-in-partner': { password, groups: ['media-partners'] },
      },
    });
    base = standIn.url;
    filer = {
      username: 'stand-in-coordinator',
      authorization: basic('stand-in-coordinator', password),
    };
    partner = { username: 'stand-in-partner', authorization: basic('stand-in-partner', password) };
    const seeded = await seed(base, 'stand-in-admin', password);
    h.check(
      'the kit seeded on the stand-in by its own seed',
      seeded.status === 0,
      seeded.output.slice(-400),
    );
    h.note(
      `on the kit's stand-in, ${base}: the add-on's own decision is held by its tests, not here`,
    );
  }
  try {
    await demo(h, base, filer, partner, standIn !== null);
  } finally {
    await standIn?.close();
  }
}

/**
 * The demo's steps, against `base` as `filer`, and the still's as `partner` when there is one.
 * `standIn` says the server is the kit's stand-in, whose marked file holds its text in a comment.
 */
async function demo(h, base, filer, partner, standIn) {
  const api = (method, path, json) =>
    fetch(`${base}/nuxeo/api/v1${path}`, {
      method,
      headers: {
        Authorization: filer.authorization,
        Accept: 'application/json',
        'X-NXproperties': '*',
        ...(json ? { 'Content-Type': 'application/json' } : {}),
      },
      body: json ? JSON.stringify(json) : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    }).then(async (response) => {
      const text = await response.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        // Not JSON, such as a proxy's error page: kept as text, so that a check naming the answer
        // shows it, and every check reading a field fails on it.
        body = { message: text.slice(0, 300) };
      }
      return { status: response.status, body };
    });
  const today = todayUtc();
  // The deliveries are filed as a distribution coordinator: a member of the group, and no
  // administrator, whom the server would let move or delete a delivery.
  const me = await api('GET', '/me');
  const groups = me.body?.properties?.groups ?? [];
  h.requirePrecondition(
    'the deliveries are filed by a distribution coordinator',
    me.status === 200 &&
      me.body?.isAdministrator === false &&
      groups.includes('media-distribution'),
    `GET /me: HTTP ${me.status}, administrator ${me.body?.isAdministrator}, groups ${JSON.stringify(groups)}`,
  );
  const film = await api('GET', `/path${ROOT}/${FILMS.name}/${FILM.name}`);
  h.requirePrecondition(
    'the film is seeded',
    film.status === 200,
    `GET the film: HTTP ${film.status}`,
  );
  const versions = Object.fromEntries(
    await Promise.all(
      LOCALISED.map(async (version) => [
        version.key,
        (await api('GET', `/path${ROOT}/${VERSIONS.name}/${versionName(version)}`)).body,
      ]),
    ),
  );
  h.requirePrecondition(
    'its localised versions are seeded',
    LOCALISED.every((version) => versions[version.key]?.uid),
    LOCALISED.filter((version) => !versions[version.key]?.uid)
      .map((version) => version.language)
      .join(', '),
  );
  const windows = film.body.properties?.['film:windows'] ?? [];
  const open = (territory, channel) =>
    windows.some(
      (window) =>
        window.territory === territory &&
        window.channel === channel &&
        String(window.from).slice(0, 10) <= today &&
        (window.until == null || today <= String(window.until).slice(0, 10)),
    );
  h.requirePrecondition(
    "the film's windows are a recent seed's: France open, SVOD in Germany not yet",
    open('FR', 'SVOD') &&
      open('FR', 'Marketing') &&
      !open('DE', 'SVOD') &&
      open('BE', 'SVOD') &&
      !open('BE', 'Marketing'),
    'the seeded windows no longer put the demo inside and outside them today: seed the kit again',
  );
  const deliveries = async () => {
    const queue = await api('GET', '/search/pp/media_deliveries/execute');
    return queue.status === 200 ? queue.body.entries : null;
  };
  const before = (await deliveries()) ?? [];
  const file = ({ version, distributor, territory }) =>
    api('POST', `/path${ROOT}/${DELIVERIES.name}`, {
      'entity-type': 'document',
      type: 'MediaDelivery',
      name: `${version}-${territory}-${Date.now()}`,
      properties: {
        'mdlv:version': versions[version].uid,
        'mdlv:distributor': distributor,
        'mdlv:territory': territory,
      },
    });

  await h.step('1. Inside its window: the French version delivered to a distributor in France');
  const french = versions[DEMO.inside.version];
  const inside = await file(DEMO.inside);
  h.check(
    'delivered: 201',
    inside.status === 201,
    `HTTP ${inside.status}: ${inside.body?.message ?? ''}`,
  );
  const record = inside.body?.properties ?? {};
  h.check(
    'the record names the distributor, the territory and the version',
    record['mdlv:distributor'] === DEMO.inside.distributor &&
      record['mdlv:territory'] === DEMO.inside.territory &&
      record['mdlv:version'] === french.uid,
    JSON.stringify([record['mdlv:distributor'], record['mdlv:territory'], record['mdlv:version']]),
  );
  const held = (french.properties?.['files:files'] ?? []).map((entry) => entry.file?.digest);
  const delivered = record['mdlv:files'] ?? [];
  h.check(
    'what was delivered: the master and the subtitles for SVOD, the key art for Marketing',
    JSON.stringify(delivered.map((each) => [each.use, each.name ?? null, each.channel])) ===
      JSON.stringify([
        ['original', null, 'SVOD'],
        ['blob', 'files:files/1/file', 'SVOD'],
        ['blob', 'files:files/2/file', 'Marketing'],
      ]),
    JSON.stringify(delivered.map((each) => [each.use, each.name, each.channel])),
  );
  h.check(
    'each delivered file by the digest the version holds',
    delivered.length === 3 &&
      delivered.every((each, index) => each.digest && each.digest === held[index]),
    JSON.stringify({ delivered: delivered.map((each) => each.digest), held }),
  );
  h.check(
    'who delivered it, and when: the coordinator, today',
    record['mdlv:deliveredBy'] === filer.username &&
      String(record['mdlv:deliveredAt']).slice(0, 10) === today,
    `${record['mdlv:deliveredBy']} on ${record['mdlv:deliveredAt']}`,
  );
  const marks = delivered.map((each) => each.watermarked === true);
  h.check(
    'the key art marked for the delivery, the master and the subtitles not',
    JSON.stringify(marks) === JSON.stringify([false, false, true]) &&
      delivered.slice(0, 2).every((each) => !each.watermarkedFile),
    JSON.stringify(marks),
  );
  const keyArt = delivered[2] ?? {};
  h.check(
    "the key art marked for its distributor, the mark's text naming them and the day",
    keyArt.watermarkedFor === DEMO.inside.distributor &&
      keyArt.watermark === watermarkText(DEMO.inside.distributor, today),
    `${keyArt.watermarkedFor}: ${keyArt.watermark}`,
  );
  const markedFile = keyArt.watermarkedFile ?? {};
  h.check(
    'the delivery holds the key art marked, a JPEG apart from the version’s',
    markedFile['mime-type'] === 'image/jpeg' &&
      Boolean(markedFile.digest) &&
      markedFile.digest !== keyArt.digest,
    JSON.stringify(markedFile),
  );
  const queued = (await deliveries()) ?? [];
  h.check(
    'the queue of deliveries lists it, newest first',
    queued.length === before.length + 1 && queued[0]?.uid === inside.body?.uid,
    `${queued.length} deliveries, the first ${queued[0]?.uid}`,
  );
  const ofVersion = await api(
    'GET',
    `/search/pp/media_version_deliveries/execute?queryParams=${encodeURIComponent(french.uid)}`,
  );
  h.check(
    "the version's deliveries list it",
    ofVersion.status === 200 &&
      ofVersion.body.entries.some((entry) => entry.uid === inside.body?.uid),
    `HTTP ${ofVersion.status}`,
  );

  /** A refusal: 403, its reason in the server's message, and no delivery made. */
  const refused = async (name, filed, { names = [], omits = [] } = {}) => {
    const count = ((await deliveries()) ?? []).length;
    const answer = await file(filed);
    const message = String(answer.body?.message ?? '');
    h.check(
      `${name}: refused, 403, ${filed.reason}`,
      answer.status === 403 && message.includes(filed.reason),
      `HTTP ${answer.status}: ${message}`,
    );
    for (const named of names)
      h.check(`${name}: the refusal names ${named}`, message.includes(named), message);
    for (const omitted of omits)
      h.check(`${name}: the refusal does not name ${omitted}`, !message.includes(omitted), message);
    const after = ((await deliveries()) ?? []).length;
    h.check(`${name}: nothing made`, after === count, `${count} deliveries before, ${after} after`);
  };

  await h.step(
    '1. Outside its window: the German version refused in Germany, before SVOD opens there',
  );
  await refused('outside', DEMO.outside, {
    names: ['original outside-window for SVOD', 'files:files/1/file outside-window for SVOD'],
    omits: ['files:files/2/file'],
  });

  await h.step('Refused whole: the French version to Belgium, where Marketing has closed');
  await refused('whole', DEMO.whole, {
    names: ['refused whole', 'files:files/2/file outside-window for Marketing'],
    omits: ['original', 'files:files/1/file'],
  });

  await h.step("A version's own rights: the French version to Germany, which it may not go to");
  await refused('territory', DEMO.territory, { names: ['territory-not-covered'] });

  await h.step('The still, for an outside partner: refused unmarked, served marked');
  const fetchAs = (who, path, init = {}) =>
    fetch(`${base}${path}`, {
      ...init,
      headers: { Authorization: who.authorization, ...(init.headers ?? {}) },
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    }).then(async (response) => ({
      status: response.status,
      type: String(response.headers.get('content-type') ?? ''),
      bytes: Buffer.from(await response.arrayBuffer()),
    }));
  const stillPath = `/nuxeo/api/v1/id/${french.uid}/@blob/${FILES.still}`;
  const asItIs = await fetchAs(filer, stillPath);
  h.check(
    'the still served as it is to the coordinator, whom the watermark exempts: a PNG',
    asItIs.status === 200 && asItIs.type.startsWith('image/png'),
    `HTTP ${asItIs.status}, ${asItIs.type}`,
  );
  if (partner === null) {
    h.note(
      "the partner's checks: not run, since MEDIA_PARTNER_USER and MEDIA_PARTNER_PASS are not set",
    );
  } else {
    const unmarked = await fetchAs(partner, stillPath);
    h.check(
      'the still refused unmarked to the outside partner, 403 watermark-required',
      unmarked.status === 403 && unmarked.bytes.toString('utf8').includes('watermark-required'),
      `HTTP ${unmarked.status}: ${unmarked.bytes.toString('utf8').slice(0, 200)}`,
    );
    const forPartner = await fetchAs(partner, '/nuxeo/api/v1/automation/Asset.GetWatermarked', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: `doc:${french.uid}`, params: { use: `blob:${FILES.still}` } }),
    });
    h.check(
      'the still served marked to the partner: a JPEG, apart from the still',
      forPartner.status === 200 &&
        forPartner.type.startsWith('image/jpeg') &&
        forPartner.bytes[0] === 0xff &&
        forPartner.bytes[1] === 0xd8 &&
        !forPartner.bytes.equals(asItIs.bytes),
      `HTTP ${forPartner.status}, ${forPartner.type}, ${forPartner.bytes.length} bytes`,
    );
    if (standIn)
      h.check(
        "on the stand-in, the marked still's text naming the partner and the day",
        jpegComment(forPartner.bytes) === watermarkText(partner.username, today),
        String(jpegComment(forPartner.bytes)),
      );
    else
      h.note(
        "the marked still's text: drawn across the picture by the server, not read back here; the add-on's MediaDeliveryTest holds it to the partner's name, byte for byte",
      );
  }
  h.note(
    "the record pages, the film's with its versions and windows and the delivery's, and the queue in the browser: the stand-in serves no app, and the package pipeline holds the kit's layouts and queues to its model",
  );
  h.note(
    "the server's own decision and its marks: held by the add-on's tests in Nuxeo's test framework, MediaDeliveryTest and WatermarkPolicyTest, not by this run",
  );
}

/** The kit's seed, run as a command against `base`, as an administrator of the stand-in. */
function seed(base, user, password) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(KIT, 'demo', 'seed.mjs')], {
      env: {
        PATH: process.env.PATH,
        NUXEO_URL: base,
        NUXEO_USER: user,
        NUXEO_PASS: password,
        NUXEO_TIMEOUT_MS: '10000',
      },
    });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('close', (status) => resolve({ status, output }));
  });
}
