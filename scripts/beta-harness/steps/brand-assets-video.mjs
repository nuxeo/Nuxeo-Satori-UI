/**
 * The brand assets kit's videos (docs/business-apps/development-plan.md, phase 5, "Files as
 * records: brand assets"): **a video is an asset with its own page, as a picture is, and its
 * rights are the server's.** On the kit's two seeded videos, `AcmeVideo` records, with the assets
 * module's server add-on, `nuxeo-agentic-assets`, enforcing the kit's video policy
 * (`bundle/OSGI-INF/brand-assets-demo-video-rights.xml`).
 *
 *   1. The cleared video's page: its player plays a file of it from a blob URL, the transcoded
 *      web cut where the server made one, else the original; the browser reads it as a video; the
 *      facts Nuxeo read of it, or the page's word that it read none; and, at 4 seconds, too short
 *      for one, the page's word that the server made no storyboard.
 *   2. The video with no Print channel: where the server transcoded it, its web cut plays, and its
 *      storyboard, a frame of which seeks the player; where it did not, its original, the master,
 *      is refused, and the page says the server's reason, asked after the 403, with no player and
 *      nothing tried instead.
 *   3. The REST API called directly, outside the app: the no-Print video's original refused,
 *      through `@blob` and `/nxfile/`, and through `Video.Slice`, which reads it; a transcoded
 *      video served by its conversion's name, through `@rendition` and at its place through
 *      `@blob` alike; the cleared video's original served.
 *   4. The library lists the videos with the pictures, its Type facet counts them from the
 *      aggregate, and choosing AcmeVideo narrows it to them on the server.
 *
 * A server that has transcoded one video and not yet the other, or the 12-second one and not yet
 * made its storyboard, is refused (exit 2): Nuxeo is still working, and the run checks one branch.
 *
 * **Whether the server transcodes** depends on ffmpeg in its container: the local Nuxeo has none
 * (its log: "ffmpeg is not available"), so it reads no facts, transcodes nothing and makes no
 * storyboard. The run reads what the server made and checks the branch it is on, and says which.
 *
 * What it needs, and refuses to run without (exit 2):
 *
 * - `nuxeo-agentic-assets` 0.3.0 or later and the kit 0.2.4 or later installed on the Nuxeo the
 *   app talks to, and the kit seeded with `demo/seed.mjs`, today: the videos' rights run.
 * - The dev server serving the kit's video layout through `npm run config:dev` (the kit's README,
 *   "Seeing it under nx serve"), and the library queue.
 * - `NUXEO_USER` and `NUXEO_PASS`: anyone who may read the kit's workspace. `NUXEO_URL`, default
 *   `http://localhost:8080`, is where the REST API is called directly.
 *
 *   npm run beta:evidence -- brand-assets-video
 *
 * Load-bearing checks: the player's blob URL and the browser's reading of it as a video; the
 * facts and storyboard as the server holds them; the 403 on the no-Print original, in the app and
 * called directly and through `Video.Slice`, and the page's reason, the code the enricher gives
 * after the 403; a transcoded video served by its name and at its place alike; the library's Type
 * facet and its narrowing.
 * Negative ones: the cleared video's original served, its page with no refusal, and no Nuxeo
 * address on any `<video>` or `<img>`.
 *
 * Not covered, and said in notes: the add-on's paths beyond the download endpoints and the
 * `Video.*` operations (its README, "What it does not cover"); the layouts come from `config:dev`,
 * not the package.
 */
import { readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { requireStepCredentials } from '../helpers.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const KIT = join(REPO, 'business-apps', 'packages', 'brand-assets-demo');
const CONFIG = join(KIT, 'bundle', 'agentic-ui-config');
const { ASSETS, MARKER, VIDEOS, WORKSPACE } = await import(join(KIT, 'demo', 'data.mjs'));

/**
 * What a server run of this file needs, for the release candidate's list of demo steps
 * (`scripts/release-candidate.mjs`), which reads it without running anything here.
 */
export const serverRun = {
  kit: basename(KIT),
  seeds: ['demo/seed.mjs'],
  runAs: { users: [], who: "anyone who may read the kit's workspace" },
  signsInAs: [],
  needs: [
    'nuxeo-agentic-assets 0.3.0 and the kit 0.2.4 or later installed, and the kit seeded on the day of the demo',
    "the dev server with `npm run config:dev` serving the kit's video layout and library queue",
    'ffmpeg on the server for the transcoded web cut and the storyboard; without it the run checks the originals',
  ],
};

const ROOT = `/default-domain/workspaces/${WORKSPACE.name}`;
/** The videos the demo opens: one with no Print channel, one cleared everywhere. */
const NO_PRINT = VIDEOS.find((video) => !video.channels.includes('Print'));
const CLEARED = VIDEOS.find((video) => video.channels.includes('Print'));

/** Where the REST API is called directly: Nuxeo itself, not the app or its dev server. */
const NUXEO = (process.env['NUXEO_URL'] ?? 'http://localhost:8080').replace(/\/$/, '');

/**
 * Not the kit's: `/nuxeo/logout` is 404 under the dev proxy, `AI.*` operations come from a package
 * this server may lack, and the recently-viewed list asks for thumbnails a record with no file has
 * not got. The refused original's own 403 is added once its address is known: it is the point.
 */
const ENVIRONMENTAL_ERRORS = ['/nuxeo/logout', /automation\/AI\./, /\/@rendition\/thumbnail$/];

const deferred = () => undefined;
const unread = () => null;

const kitFile = (path) => JSON.parse(readFileSync(join(CONFIG, path), 'utf8'));

/**
 * The conversions the kit's video policy covers by E-commerce, read from the kit's own file, not
 * from the server: the web cut, which both seeded videos' channels hold.
 */
const WEB_CUT = [
  ...readFileSync(
    join(KIT, 'bundle', 'OSGI-INF', 'brand-assets-demo-video-rights.xml'),
    'utf8',
  ).matchAll(/<rendition name="([^"]+)" channel="E-commerce" \/>/g),
].map((match) => match[1]);

/** A JSON value with its object keys sorted, so two parses compare as text. */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
const sameJson = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/** A served file comes in the servlet's envelope, as `config:dev` writes it; the rest as is. */
function unwrap(body) {
  if (body?.format === 'nuxeo-agentic-ui-config/1' && typeof body.layer === 'string')
    return { content: body.content, source: body.source };
  return { content: body, source: null };
}

/** The decision the server's `assetRights` explanation gives for `kind` `name`, or `otherwise`. */
function decisionFor(rights, kind, name) {
  if (!rights) return null;
  const listed = rights.uses?.find((use) => use.use === kind && use.name === name);
  return listed ?? rights.otherwise ?? null;
}

/** What Nuxeo made of a video: its facts read, its transcoded videos' names, its storyboard. */
function madeOf(document) {
  const properties = document?.properties ?? {};
  const info = properties['vid:info'];
  const transcoded = Array.isArray(properties['vid:transcodedVideos'])
    ? properties['vid:transcodedVideos']
    : [];
  return {
    facts:
      typeof info === 'object' &&
      info !== null &&
      ['duration', 'width', 'height', 'format'].some((field) => info[field] != null),
    info: info ?? null,
    transcoded: transcoded.map((each) => each?.name).filter((name) => typeof name === 'string'),
    frames: Array.isArray(properties['vid:storyboard']) ? properties['vid:storyboard'].length : 0,
  };
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {ReturnType<import('../helpers.mjs').createHelpers>} h
 */
export default async function run(page, h) {
  // ── Preconditions ──────────────────────────────────────────────────────────────────────────
  await h.step('Preconditions: the add-on and the kit installed, seeded, and the layout served');
  const { username, password } = requireStepCredentials(
    'read the seeded videos and call the REST API',
  );
  const basic = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

  /** A GET of Nuxeo itself, as any client of the REST API sends one: its status, type and size. */
  const direct = async (path, headers = {}, body = undefined) => {
    try {
      const response = await fetch(`${NUXEO}/nuxeo${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Authorization: basic,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
        signal: AbortSignal.timeout(30_000),
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      return { status: response.status, type: response.headers.get('content-type') ?? '', bytes };
    } catch {
      return null;
    }
  };
  const json = (answer) => {
    try {
      return answer?.status === 200 ? JSON.parse(answer.bytes.toString('utf8')) : null;
    } catch {
      return null;
    }
  };

  const type = await direct('/api/v1/config/types/AcmeVideo');
  h.requirePrecondition(
    "the kit's video type is installed",
    type?.status === 200,
    `GET /api/v1/config/types/AcmeVideo answered ${type?.status ?? 'nothing'}: install the kit 0.2.4 or later (its README)`,
  );

  const readVideo = async (video) =>
    json(
      await direct(`/api/v1/path${ROOT}/assets/${video.id}`, {
        properties: '*',
        'enrichers.document': 'assetRights',
      }),
    );
  const seeded = new Map();
  for (const video of VIDEOS) {
    const doc = await readVideo(video);
    if (doc?.type === 'AcmeVideo' && doc.properties?.['dc:source'] === MARKER)
      seeded.set(video.id, doc);
  }
  h.requirePrecondition(
    "the seeded videos are there, each carrying the seed's marker",
    seeded.size === VIDEOS.length,
    `found ${[...seeded.keys()].join(', ') || 'none'} of ${VIDEOS.map((video) => video.id).join(', ')}: run demo/seed.mjs`,
  );
  const rightsOf = (video) => seeded.get(video.id).contextParameters?.assetRights ?? null;
  h.requirePrecondition(
    "nuxeo-agentic-assets is installed and the kit's video policy is in force",
    VIDEOS.every((video) => rightsOf(video)?.type === 'AcmeVideo'),
    'the assetRights enricher answered nothing for an AcmeVideo: install nuxeo-agentic-assets and the kit at 0.2.4 or later',
  );
  h.requirePrecondition(
    "nuxeo-agentic-assets 0.3.0 or later: the enricher explains a video's storyboard as one use",
    VIDEOS.every(
      (video) => rightsOf(video)?.uses?.some((use) => use.use === 'storyboard') === true,
    ),
    'no storyboard use in the assetRights explanation: install nuxeo-agentic-assets 0.3.0 and the kit 0.2.4 or later',
  );
  h.requirePrecondition(
    `the seed's rights still hold on the server's day: ${NO_PRINT.id} running with no Print channel, ${CLEARED.id} running with Print`,
    rightsOf(NO_PRINT).ended === false &&
      Array.isArray(rightsOf(NO_PRINT).channels) &&
      !rightsOf(NO_PRINT).channels.includes('Print') &&
      rightsOf(CLEARED).ended === false &&
      rightsOf(CLEARED).channels?.includes('Print') === true,
    'run demo/seed.mjs again today',
  );

  for (const path of ['layouts/AcmeVideo/view.layout.json', 'queues/library.json']) {
    const served = await page.request.get(`${h.baseUrl}/agentic-ui-config/${path}`).catch(unread);
    const { content, source } = unwrap(served?.ok() ? await served.json().catch(unread) : null);
    h.requirePrecondition(
      `the dev server serves the kit's ${path}`,
      sameJson(content, kitFile(path)) &&
        (source === null || resolve(REPO, source) === join(CONFIG, path)),
      `not the kit's (${served?.status()}): run the kit README's config:dev command, then restart the dev server`,
    );
  }

  const made = new Map(VIDEOS.map((video) => [video.id, madeOf(seeded.get(video.id))]));
  const transcodes = VIDEOS.every((video) => made.get(video.id).transcoded.length > 0);
  h.requirePrecondition(
    'the server has transcoded both videos or neither, so that the run checks one branch',
    transcodes || VIDEOS.every((video) => made.get(video.id).transcoded.length === 0),
    `transcoded so far: ${VIDEOS.map((video) => `${video.id} ${made.get(video.id).transcoded.join(', ') || 'nothing'}`).join('; ')}. Nuxeo is still converting: wait, then run this again`,
  );
  // Nuxeo makes a storyboard for a video of 10 seconds or more, in a job of its own after the
  // conversions: where it transcodes, the 12-second video has one, or soon will.
  h.requirePrecondition(
    `where the server transcodes, it has made ${NO_PRINT.id}'s storyboard, ${NO_PRINT.video.seconds} seconds long`,
    !transcodes || made.get(NO_PRINT.id).frames > 0,
    `${NO_PRINT.id} has no storyboard yet. Nuxeo makes it after the conversions: wait, then run this again`,
  );
  h.note(
    transcodes
      ? `the server transcoded the videos: ${VIDEOS.map((video) => `${video.id} ${made.get(video.id).transcoded.join(', ')}`).join('; ')}`
      : 'the server transcoded neither video, as one without ffmpeg does: each page plays the original, and the run checks that branch',
  );

  /** The video's page as drawn: what plays, from where, and what the browser made of it. */
  const readVideoPage = () =>
    page
      .evaluate(() => {
        const root = document.querySelector('lib-record-video');
        const player = root?.querySelector('video');
        const refusal = root?.querySelector('nxs-banner[data-refusal]');
        return {
          rendition:
            root?.querySelector('.record-video__figure')?.getAttribute('data-rendition') ?? null,
          src: player?.getAttribute('src') ?? null,
          name: player?.getAttribute('aria-label') ?? null,
          readyState: player?.readyState ?? null,
          duration: player && Number.isFinite(player.duration) ? player.duration : null,
          error: player?.error?.code ?? null,
          refusal: refusal?.getAttribute('data-refusal') ?? null,
          text: refusal?.querySelector('.nxs-banner__message')?.textContent?.trim() ?? null,
          facts: [...(root?.querySelectorAll('[data-fact]') ?? [])].map((fact) => [
            fact.getAttribute('data-fact'),
            fact.querySelector('dd')?.textContent?.trim(),
          ]),
          notes: [...(root?.querySelectorAll('[data-note]') ?? [])].map((note) =>
            note.getAttribute('data-note'),
          ),
          frames: [...(root?.querySelectorAll('.nxs-storyboard__frame') ?? [])].map((frame) =>
            frame.getAttribute('aria-label'),
          ),
          nuxeoAddresses: [...(root?.querySelectorAll('video, img, source') ?? [])]
            .map((element) => element.getAttribute('src') ?? '')
            .filter((src) => src !== '' && !src.startsWith('blob:')),
        };
      })
      .catch(unread);

  const open = async (video) => {
    await h.goToDoc(seeded.get(video.id).uid);
    await page
      .waitForFunction(
        () => {
          const root = document.querySelector('lib-record-video');
          const player = root?.querySelector('video');
          return (
            (player?.getAttribute('src')?.startsWith('blob:') && player.readyState >= 1) ||
            player?.error != null ||
            root?.querySelector('nxs-banner[data-refusal], nxs-error-state, nxs-empty-state') !=
              null
          );
        },
        undefined,
        { timeout: 60_000 },
      )
      .catch(deferred);
    return readVideoPage();
  };

  const expectedFacts = (video) => {
    const { facts, info } = made.get(video.id);
    if (!facts) return [];
    const out = [];
    if (Number(info.duration) > 0) out.push('duration');
    if (Number(info.width) > 0 && Number(info.height) > 0) out.push('frame-size');
    if (typeof info.format === 'string' && info.format.trim() !== '') out.push('format');
    return out;
  };

  /** Press a frame of the storyboard on the page, and read where the player then is. */
  const seekWithLastFrame = async () => {
    await page.locator('lib-record-video .nxs-storyboard__frame').last().click().catch(deferred);
    return page
      .evaluate(() => document.querySelector('lib-record-video video')?.currentTime ?? null)
      .catch(unread);
  };

  // ── 1. The cleared video's page ────────────────────────────────────────────────────────────
  await h.step(`1. ${CLEARED.title}: its page plays it, with its facts, and no storyboard`);
  await h.login();
  const cleared = await open(CLEARED);
  const clearedMade = made.get(CLEARED.id);
  h.check(
    `the player plays ${transcodes ? 'a transcoded web cut, by its name' : 'the original, the server having transcoded nothing'}, from a blob URL`,
    cleared?.src?.startsWith('blob:') === true &&
      (transcodes
        ? clearedMade.transcoded.includes(cleared.rendition)
        : cleared.rendition === 'original'),
    JSON.stringify(cleared),
  );
  h.check(
    'the browser reads it as a video: its metadata loaded, its length about the seeded one',
    cleared?.readyState >= 1 &&
      cleared.error === null &&
      Math.abs((cleared.duration ?? 0) - CLEARED.video.seconds) < 1.5,
    JSON.stringify({
      readyState: cleared?.readyState,
      duration: cleared?.duration,
      error: cleared?.error,
    }),
  );
  h.check(
    "the player is named by the video's title and the file it plays",
    cleared?.name?.startsWith(`${CLEARED.title}, `) === true,
    cleared?.name,
  );
  h.check(
    'no Nuxeo address on the player or a frame',
    cleared?.nuxeoAddresses.length === 0,
    JSON.stringify(cleared?.nuxeoAddresses),
  );
  h.check(
    clearedMade.facts
      ? 'the facts Nuxeo read of it are listed'
      : 'the page says the server has read no facts of it',
    clearedMade.facts
      ? sameJson(
          cleared?.facts.map(([fact]) => fact),
          expectedFacts(CLEARED),
        )
      : cleared?.notes.includes('facts') && cleared.facts.length === 0,
    JSON.stringify(cleared?.facts),
  );
  // Its 4 seconds are under the 10 from which Nuxeo makes a storyboard, ffmpeg or not.
  h.check(
    'the page says the server has made no storyboard for it, as the server holds none',
    clearedMade.frames === 0 &&
      cleared?.notes.includes('storyboard') &&
      cleared.frames.length === 0,
    JSON.stringify({ server: clearedMade.frames, page: cleared?.frames }),
  );
  h.check('the cleared video is not refused', cleared?.refusal === null, cleared?.refusal);
  await h.screenshot('video-cleared');

  // ── 2. The video with no Print channel ─────────────────────────────────────────────────────
  const noPrintUid = seeded.get(NO_PRINT.id).uid;
  const refusedInApp = `HTTP 403 /nuxeo/api/v1/id/${noPrintUid}/@blob/file:content`;
  if (transcodes) {
    await h.step(
      `2. ${NO_PRINT.title}, with no Print channel: its web cut plays, with its storyboard`,
    );
    const web = await open(NO_PRINT);
    const noPrintMade = made.get(NO_PRINT.id);
    h.check(
      'its transcoded web cut plays, covered by E-commerce, though its original is not, and the browser reads it',
      web?.name?.startsWith(`${NO_PRINT.title}, `) === true &&
        web.src?.startsWith('blob:') === true &&
        noPrintMade.transcoded.includes(web.rendition) &&
        web.readyState >= 1 &&
        web.error === null &&
        web.refusal === null,
      JSON.stringify(web),
    );
    // The precondition above holds the server to a storyboard for it, so this is no branch.
    h.check(
      `its storyboard of ${noPrintMade.frames} frame(s), each a button that seeks it`,
      noPrintMade.frames > 0 &&
        web?.frames.length === noPrintMade.frames &&
        web.frames.every((name) => /^Seek to /.test(name ?? '')),
      JSON.stringify({ server: noPrintMade.frames, page: web?.frames }),
    );
    const position = await seekWithLastFrame();
    h.check(
      'pressing the last frame moves the player to its moment',
      Number(position) > 0,
      String(position),
    );
  } else {
    await h.step(
      `2. ${NO_PRINT.title}, with no Print channel: its original refused, with the server's reason`,
    );
    const explained = page
      .waitForResponse(
        (response) =>
          response.url().includes(`/api/v1/id/${noPrintUid}`) &&
          response.request().headers()['enrichers.document'] === 'assetRights',
        { timeout: 30_000 },
      )
      .catch(unread);
    const answered = page
      .waitForResponse(
        (response) => response.url().includes(`/id/${noPrintUid}/@blob/file:content`),
        {
          timeout: 30_000,
        },
      )
      .catch(unread);
    const refused = await open(NO_PRINT);
    h.check('the server answers its original with 403', (await answered)?.status() === 403);
    const said = decisionFor(
      (await (await explained)?.json().catch(unread))?.contextParameters?.assetRights,
      'original',
      null,
    );
    h.check(
      "the page says the reason the server's explanation gives, asked after the 403",
      said?.allowed === false &&
        said?.reason === 'channel-not-covered' &&
        said?.channel === 'Print' &&
        refused?.refusal === said?.reason,
      `server: ${JSON.stringify(said)}, page: ${refused?.refusal}`,
    );
    h.check(
      "in the platform's words, of a video",
      refused?.text ===
        `The server refused this video: it is covered by the Print channel, and this asset's rights cover ${new Intl.ListFormat('en', { type: 'conjunction' }).format(rightsOf(NO_PRINT).channels)} only.`,
      refused?.text,
    );
    h.check(
      'no player where the file was refused, and nothing tried instead',
      refused?.src === null &&
        refused.rendition === 'original' &&
        refused.name === null &&
        refused.nuxeoAddresses.length === 0,
      JSON.stringify(refused),
    );
  }
  await h.screenshot('video-no-print');

  // ── 3. The REST API, called directly ───────────────────────────────────────────────────────
  await h.step('3. The REST API, called directly: what the server refuses and serves of a video');
  const clearedUid = seeded.get(CLEARED.id).uid;
  for (const [what, path] of [
    ['its original through @blob/file:content', `/api/v1/id/${noPrintUid}/@blob/file:content`],
    ['the same file through /nxfile/', `/nxfile/default/${noPrintUid}/file:content`],
  ]) {
    const answer = await direct(path);
    h.check(
      `${NO_PRINT.id}, with no Print channel, ${what}: 403`,
      answer?.status === 403,
      `GET ${path}: ${answer?.status ?? 'no answer'}`,
    );
  }
  // Video.Slice reads the original when given no xpath: refused before it reads, ffmpeg or not.
  const slice = await direct(
    '/api/v1/automation/Video.Slice',
    {},
    { input: `doc:${noPrintUid}`, params: {} },
  );
  h.check(
    `${NO_PRINT.id}, its original through Video.Slice: 403, decided as its download`,
    slice?.status === 403,
    `POST /api/v1/automation/Video.Slice: ${slice?.status ?? 'no answer'}`,
  );
  const original = await direct(`/api/v1/id/${clearedUid}/@blob/file:content`);
  h.check(
    `${CLEARED.id}, cleared everywhere, its original: served, as WebM`,
    original?.status === 200 && original.type.startsWith('video/webm') && original.bytes.length > 0,
    `${original?.status}, ${original?.type}`,
  );
  if (transcodes) {
    const transcodedChecks = [];
    for (const video of VIDEOS) {
      const uid = seeded.get(video.id).uid;
      made.get(video.id).transcoded.forEach((name, place) => {
        transcodedChecks.push({ video, uid, name, place });
      });
    }
    for (const { video, uid, name, place } of transcodedChecks) {
      // The kit's policy covers its web cut by E-commerce, which both videos hold; a conversion it
      // does not name is refused, by its name and at its place alike.
      const served = WEB_CUT.includes(name);
      const expected = served ? 200 : 403;
      const byName = await direct(`/api/v1/id/${uid}/@rendition/${encodeURIComponent(name)}`);
      h.check(
        `${video.id}, ${name} by its name, @rendition: ${served ? 'served, covered by E-commerce' : '403, not listed'}`,
        byName?.status === expected &&
          (!served || (byName.type.startsWith('video/') && byName.bytes.length > 0)),
        `${byName?.status}, ${byName?.type}`,
      );
      const byPlace = await direct(`/api/v1/id/${uid}/@blob/vid:transcodedVideos/${place}/content`);
      h.check(
        `${video.id}, ${name} at its place, @blob/vid:transcodedVideos/${place}/content: ${expected}, as by its name`,
        byPlace?.status === expected && (!served || byPlace.bytes.length > 0),
        `${byPlace?.status}, ${byPlace?.type}`,
      );
    }
    h.check(
      `each video has a conversion the kit covers, ${WEB_CUT.join(' or ')}, checked at its place`,
      WEB_CUT.length > 0 &&
        VIDEOS.every((video) =>
          made.get(video.id).transcoded.some((name) => WEB_CUT.includes(name)),
        ),
      VIDEOS.map((video) => `${video.id}: ${made.get(video.id).transcoded.join(', ')}`).join('; '),
    );
  } else {
    h.note(
      'no transcoded video on this server: their service by name and at their places is not called',
    );
  }
  const me = json(await direct('/api/v1/me'));
  h.note(
    me?.isAdministrator === true
      ? `run as ${me.id}, an administrator: the refusals above held for an administrator`
      : `run as ${me?.id ?? username}, who is not an administrator; the add-on reads no user`,
  );

  // ── 4. The library ─────────────────────────────────────────────────────────────────────────
  await h.step(
    '4. The library lists the videos, and its Type facet narrows it to them on the server',
  );
  await h.goTo('/#/queues/library');
  await page
    .waitForFunction(
      () => document.querySelectorAll('.queue-page tbody tr').length > 0,
      undefined,
      {
        timeout: 30_000,
      },
    )
    .catch(deferred);
  const readRows = () =>
    page
      .evaluate(() =>
        [...document.querySelectorAll('.queue-page tbody tr')].map((row) =>
          (row.innerText ?? '').replace(/\s+/g, ' ').trim(),
        ),
      )
      .catch(unread);
  const titled = (rows, titles) =>
    titles.filter((title) => rows?.some((row) => row.startsWith(title)));
  const videoTitles = VIDEOS.map((video) => video.title);
  const rows = await readRows();
  h.check(
    'the library lists both videos among the assets',
    titled(rows, videoTitles).length === VIDEOS.length &&
      titled(
        rows,
        ASSETS.map((asset) => asset.title),
      ).length === ASSETS.length,
    JSON.stringify(rows),
  );
  const typeFacet = await page
    .evaluate(() =>
      Object.fromEntries(
        [
          ...document.querySelectorAll(
            'fieldset.queue-facet[data-aggregate="acme_type_agg"] .queue-facet__bucket',
          ),
        ].map((bucket) => {
          const match = /^\s*(.+?)\s*\((\d+)\)\s*$/.exec(bucket.textContent ?? '');
          return match ? [match[1], Number(match[2])] : [bucket.textContent?.trim(), null];
        }),
      ),
    )
    .catch(unread);
  h.check(
    'the Type facet counts the pictures and the videos, from the terms aggregate',
    sameJson(typeFacet, { AcmeAsset: ASSETS.length, AcmeVideo: VIDEOS.length }),
    JSON.stringify(typeFacet),
  );
  const narrowed = page
    .waitForRequest(
      (request) =>
        request.url().includes('/search/pp/acme_asset_library/execute') &&
        new URL(request.url()).searchParams.get('acme_type_agg') === JSON.stringify(['AcmeVideo']),
      { timeout: 15_000 },
    )
    .catch(unread);
  await page
    .locator('fieldset.queue-facet[data-aggregate="acme_type_agg"] .queue-facet__bucket', {
      hasText: /^\s*AcmeVideo\b/,
    })
    .locator('input')
    .click()
    .catch(deferred);
  const sent = await narrowed;
  await page
    .waitForFunction(
      (count) => document.querySelectorAll('.queue-page tbody tr').length === count,
      VIDEOS.length,
      { timeout: 15_000 },
    )
    .catch(deferred);
  const videoRows = await readRows();
  h.check(
    'choosing AcmeVideo sends acme_type_agg=["AcmeVideo"] to the page provider',
    sent !== null,
  );
  h.check(
    'the server narrows the library to the videos',
    videoRows?.length === VIDEOS.length && titled(videoRows, videoTitles).length === VIDEOS.length,
    JSON.stringify(videoRows),
  );
  await h.screenshot('library-videos');

  // ── Health ─────────────────────────────────────────────────────────────────────────────────
  await h.step('Health');
  h.expectNoConsoleErrors('no unexpected browser console errors', [
    ...ENVIRONMENTAL_ERRORS,
    ...(transcodes ? [] : [refusedInApp]),
  ]);
  h.note(
    'the add-on refuses at the platform download endpoints this run calls; the server paths it does ' +
      'not cover yet, video operations among them, are listed in nuxeo-agentic-assets/README.md',
  );
  h.note(
    'the video layout and the library come from config:dev under the dev server, not from the package',
  );
}
