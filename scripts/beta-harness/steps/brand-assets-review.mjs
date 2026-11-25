/**
 * The brand assets kit's creative review (docs/business-apps/development-plan.md, phase 5, "Demo",
 * step 4, "a creative review with pins on the picture"), end to end, on the kit in
 * `business-apps/packages/brand-assets-demo`, for the fictional Acme Outdoor.
 *
 *   4.1 A reviewer places a pin on the picture with a note; it is drawn where they clicked, and
 *       listed beside the picture. Choosing a pin in the list highlights it on the picture.
 *   4.2 Round 1 is closed and round 2 opens; round 1's pins stay, marked as past.
 *   4.3 A pin placed with the keyboard alone, in round 2, and the pins reached by keyboard.
 *   4.4 The review is the server's: a reload shows it again, a view drawn at another size keeps
 *       each pin on its point, and the REST API holds the pins and the round as Nuxeo annotations.
 *   4.5 A reader who may not comment sees the pins and is offered no pin.
 *
 * **It writes only what it creates.** It draws a picture with the kit's `demo/png.mjs`, creates an
 * asset from it in a folder of its own, reviews that asset, and trashes the folder at the end,
 * whatever happened before. The folder is in `REVIEW_WORKSPACE`, a workspace path the runner names,
 * or else in a workspace of its own under `/default-domain/workspaces`, trashed with it. The kit's
 * seeded records are never written: a review adds annotations to the asset it is on.
 *
 * The asset is the kit's own type, `AcmeAsset`, where the server has the package installed, and
 * otherwise the platform's `Picture`, with the kit's asset layout served for it, as the kit's
 * README's "Previewing the asset page" does. Either way the page is drawn from the kit's layout
 * file, whose `review` is what turns the review on: the precondition holds the served file to it.
 *
 * What it needs, and refuses to run without (exit 2):
 *
 * - `NUXEO_USER` and `NUXEO_PASS`: someone who may create a folder and a picture in the workspace,
 *   comment on the picture and change it, so that Close round is offered. There is no default.
 * - The dev server with `npm run config:dev` serving the kit's asset layout for the type used (the
 *   kit's README, "Seeing it under nx serve", or for `Picture`, "Previewing the asset page").
 * - Picture conversion on the server: the asset's views are waited for, up to a minute.
 *
 *   npm run beta:evidence -- brand-assets-review
 *
 * Load-bearing checks: each pin drawn at the point it was placed, as fractions of the view, and
 * at the same point on a view of another size; the pins listed with their notes, and the chosen
 * one highlighted in both places; the second round open after the first is closed, and the first
 * round's pins marked as past on the picture, in their names and in the list; a pin placed with no
 * pointerdown or mousedown at all, at the place typed; the arrow keys moving among the pins; the
 * annotations the REST API returns, their origin, file, payload and author, the same pins after a
 * real reload, and their notes in the Comments panel. Negative ones: no pin offered to a reader,
 * no Close round before a pin, none of the review's annotations on `file:content`, and no pointer
 * event during the keyboard step, whose positive control is the pointer step's count.
 *
 * Not covered, and said in notes: the server refusing a reader's pin (Nuxeo 2025 accepts an
 * annotation from anyone who may read the record, so hiding the control is not the control), the
 * reader seen through a second account (the kit has no demo people: the record's permissions are
 * answered without Comment and Write in the browser instead), and the package installed from the
 * pipeline (the dev server reads the layout from `config:dev`).
 */
import { readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { requireStepCredentials } from '../helpers.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const KIT = join(REPO, 'business-apps', 'packages', 'brand-assets-demo');
const CONFIG = join(KIT, 'bundle', 'agentic-ui-config');
const { picturePng } = await import(join(KIT, 'demo', 'png.mjs'));

/**
 * What a server run of this file needs, for the release candidate's list of demo steps
 * (`scripts/release-candidate.mjs`), which reads it without running anything here. It needs no
 * seed: it creates the asset it reviews, and trashes it at the end.
 */
export const serverRun = {
  kit: basename(KIT),
  seeds: [],
  runAs: {
    users: [],
    who: 'someone who may create a folder and a picture in the workspace, comment on the picture and change it',
  },
  signsInAs: [],
  needs: [
    'picture conversion on the server',
    "the dev server with `npm run config:dev` serving the kit's asset layout for the type used",
  ],
};

/** The review's own annotations, as `picture-review.ts` writes them. */
const REVIEW_XPATH = 'picture:views';
const REVIEW_ORIGIN = 'nuxeo-satori.review';

/** The asset under review: fictional, drawn here, and trashed at the end. */
const DRAFT = {
  title: 'Summit Shell Jacket, Glacier, front (draft for review)',
  picture: { shape: 'jacket', size: [1200, 1500], background: [226, 232, 238], ink: [32, 86, 140] },
};
/** The notes, and where the pointer places the first two pins, as fractions of the view. */
const FIRST = { x: 0.3, y: 0.25, note: 'Logo sits too close to the collar seam' };
const SECOND = { x: 0.62, y: 0.7, note: 'Hem colour reads grey, not Glacier' };
/** The keyboard's pin, in whole percent, as its fields take it. */
const TYPED = { across: 45, down: 55, note: 'Zip pull is missing in this shot' };

/**
 * As in `brand-assets-demo.mjs`, not the review's, and one more: a reload signs a stale cookie
 * session out, and Nuxeo's logout redirects to the packaged app's address, `/nuxeo/agentic-ui/`,
 * which a server without the packaged app answers 404 through the dev proxy (seen on the local
 * Nuxeo 2025.10.18: the request is redirected from `/nuxeo/logout`).
 */
const ENVIRONMENTAL_ERRORS = [
  '/nuxeo/logout',
  /automation\/AI\./,
  /\/@rendition\/thumbnail$/,
  /^HTTP 404 \/nuxeo\/agentic-ui\/$/,
];

const deferred = () => undefined;
const unread = () => null;

const kitLayout = JSON.parse(
  readFileSync(join(CONFIG, 'layouts', 'AcmeAsset', 'view.layout.json'), 'utf8'),
);

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

/** A served layout comes in the servlet's envelope, as `config:dev` writes it. */
function unwrap(body) {
  if (body?.format === 'nuxeo-agentic-ui-config/1' && body.layer === 'layout')
    return { content: body.content, source: body.source };
  return { content: body, source: null };
}

const close = (a, b, within) => typeof a === 'number' && Math.abs(a - b) <= within;

/** WCAG's contrast ratio of two `rgb()` or `rgba()` colours, as computed styles write them. */
function contrast(a, b) {
  const luminance = (css) => {
    const parts = /rgba?\(([^)]*)\)/.exec(css)?.[1].split(',').map(Number);
    if (!parts || parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return null;
    const [r, g, b2] = parts
      .slice(0, 3)
      .map((value) => value / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b2;
  };
  const [one, two] = [luminance(a), luminance(b)];
  if (one === null || two === null) return null;
  return (Math.max(one, two) + 0.05) / (Math.min(one, two) + 0.05);
}

/** The review as drawn: its round, its pins on the picture, its list, and its offers. */
function readReview(page) {
  return page
    .evaluate(() => {
      const root = document.querySelector('.record-review');
      if (!root) return null;
      const image = root.querySelector('.record-picture__image');
      const box = image?.getBoundingClientRect() ?? null;
      return {
        round: Number(root.getAttribute('data-round')),
        status: root.querySelector('.record-review__status')?.textContent?.trim() ?? null,
        view: root.querySelector('.record-picture__figure')?.getAttribute('data-view') ?? null,
        src: image?.getAttribute('src') ?? null,
        image: box ? { left: box.left, top: box.top, width: box.width, height: box.height } : null,
        pins: [...root.querySelectorAll('.record-review__marks .record-review__pin')].map((pin) => {
          const at = pin.getBoundingClientRect();
          return {
            number: Number(pin.getAttribute('data-pin')),
            round: Number(pin.getAttribute('data-round')),
            left: pin.style.left,
            top: pin.style.top,
            // Where its centre is, as fractions of the picture's box as drawn.
            x: box ? (at.left + at.width / 2 - box.left) / box.width : null,
            y: box ? (at.top + at.height / 2 - box.top) / box.height : null,
            past: pin.classList.contains('record-review__pin--past'),
            pressed: pin.getAttribute('aria-pressed'),
            tabIndex: pin.tabIndex,
            name: pin.getAttribute('aria-label'),
          };
        }),
        rounds: [...root.querySelectorAll('.record-review__round')].map((round) => ({
          round: Number(round.getAttribute('data-round')),
          heading: round.querySelector('.record-review__round-heading')?.textContent?.trim(),
          entries: [...round.querySelectorAll('.record-review__entry')].map((entry) => ({
            number: Number(entry.getAttribute('data-pin')),
            note: entry.querySelector('.record-review__entry-note')?.textContent ?? null,
            past: entry.querySelector('.record-review__past') !== null,
            pressed: entry.getAttribute('aria-pressed'),
          })),
        })),
        add: root.querySelector('.record-review__add') !== null,
        close: root.querySelector('.record-review__close')?.textContent?.trim() ?? null,
        readOnly: root.querySelector('.record-review__read-only')?.textContent?.trim() ?? null,
      };
    })
    .catch(unread);
}

/** The review has read its annotations, and the picture shows a view from a blob URL. */
async function reviewSettled(page, { pins = null } = {}) {
  await page
    .waitForFunction(
      (count) =>
        document.querySelector('.record-review__status') !== null &&
        document
          .querySelector('.record-picture__image')
          ?.getAttribute('src')
          ?.startsWith('blob:') &&
        (count === null ||
          document.querySelectorAll('.record-review__marks .record-review__pin').length === count),
      pins,
      { timeout: 30_000 },
    )
    .catch(deferred);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {ReturnType<import('../helpers.mjs').createHelpers>} h
 */
export default async function run(page, h) {
  // ── Preconditions ──────────────────────────────────────────────────────────────────────────
  await h.step(
    'Preconditions: a picture type with the kit asset layout served, and a place to write',
  );
  const { username } = requireStepCredentials('create the asset under review and review it');
  const api = (path) => `${h.baseUrl}/nuxeo/api/v1${path}`;
  const json = (answer) => (answer?.ok() ? answer.json().catch(unread) : null);

  const kitType = await page.request.get(api('/config/types/AcmeAsset')).catch(unread);
  const type = kitType?.status() === 200 ? 'AcmeAsset' : 'Picture';
  const servedAnswer = await page.request
    .get(`${h.baseUrl}/agentic-ui-config/layouts/${type}/view.layout.json`)
    .catch(unread);
  const served = unwrap(servedAnswer?.ok() ? await servedAnswer.json().catch(unread) : null);
  const fromKit =
    served.source === null ||
    resolve(REPO, served.source) === join(CONFIG, 'layouts', 'AcmeAsset', 'view.layout.json');
  h.requirePrecondition(
    `the dev server serves the kit's asset layout, with its review, for ${type}`,
    sameJson(served.content, kitLayout) && fromKit && 'review' in kitLayout,
    `${type}/view.layout.json is ${servedAnswer?.status() ?? 'not answered'}` +
      `${served.source ? `, from ${served.source}` : ''}: run the kit README's config:dev command` +
      (type === 'Picture' ? ' with --layout Picture/view=<the kit asset layout>' : ''),
  );

  const named = process.env['REVIEW_WORKSPACE'];
  let workspace = null;
  let ownWorkspace = false;
  if (named) {
    workspace = await json(await page.request.get(api(`/path${named}`)).catch(unread));
    h.requirePrecondition(
      `REVIEW_WORKSPACE names a workspace this user may read: ${named}`,
      workspace?.type === 'Workspace',
      `answered ${workspace?.type ?? 'nothing'}`,
    );
  } else {
    // Nuxeo cuts a name to 24 characters: this one is 21.
    const name = `brand-review-${Date.now().toString(36)}`;
    workspace = await json(
      await page.request
        .post(api('/path/default-domain/workspaces'), {
          data: {
            'entity-type': 'document',
            type: 'Workspace',
            name,
            properties: { 'dc:title': 'Brand assets review run (trashed when it ends)' },
          },
        })
        .catch(unread),
    );
    ownWorkspace = workspace?.type === 'Workspace';
    h.requirePrecondition(
      'a workspace of its own is created under /default-domain/workspaces',
      ownWorkspace,
      'the server refused it: name one this user may write in with REVIEW_WORKSPACE',
    );
  }

  // Everything from here is written under `scratch`, which `finally` trashes.
  const folder = ownWorkspace
    ? workspace
    : await json(
        await page.request
          .post(api(`/id/${workspace.uid}`), {
            data: {
              'entity-type': 'document',
              type: 'Folder',
              name: `review-${Date.now().toString(36)}`,
              properties: { 'dc:title': 'Brand assets review run (trashed when it ends)' },
            },
          })
          .catch(unread),
      );
  const scratch = folder?.uid ?? null;
  try {
    h.requirePrecondition(
      'a folder of its own is created for the asset under review',
      scratch !== null,
      'the server refused it',
    );

    const batch = await json(await page.request.post(api('/upload/')).catch(unread));
    const uploaded = batch?.batchId
      ? await page.request
          .post(api(`/upload/${batch.batchId}/0`), {
            data: picturePng(DRAFT.picture),
            headers: {
              'Content-Type': 'application/octet-stream',
              'X-File-Name': 'summit-shell-draft.png',
              'X-File-Type': 'image/png',
            },
          })
          .catch(unread)
      : null;
    const asset =
      uploaded?.ok() &&
      (await json(
        await page.request
          .post(api(`/id/${scratch}`), {
            data: {
              'entity-type': 'document',
              type,
              name: 'summit-shell-draft',
              properties: {
                'dc:title': DRAFT.title,
                'file:content': { 'upload-batch': batch.batchId, 'upload-fileId': '0' },
              },
            },
          })
          .catch(unread),
      ));
    h.requirePrecondition(
      `the asset under review is created, as ${type}`,
      Boolean(asset?.uid),
      `upload ${uploaded?.status() ?? 'not answered'}`,
    );

    // Nuxeo makes the views a moment after the upload; the asset page shows them when it has them.
    let views = [];
    for (let waited = 0; waited < 60_000 && views.length < 2; waited += 1000) {
      const read = await json(
        await page.request
          .get(api(`/id/${asset.uid}`), { headers: { properties: 'picture' } })
          .catch(unread),
      );
      views = (read?.properties?.['picture:views'] ?? []).filter((view) => view?.content);
      if (views.length < 2) await page.waitForTimeout(1000);
    }
    h.requirePrecondition(
      'Nuxeo made the picture views of the asset under review',
      views.some((view) => view.title === 'Medium') &&
        views.some((view) => view.title === 'Thumbnail'),
      `views made: ${JSON.stringify(views.map((view) => view.title))}`,
    );

    // ── 4.1 Pins on the picture ────────────────────────────────────────────────────────────────
    await h.step('4.1 A pin placed on the picture with a note, drawn there and listed beside it');
    await h.login();
    await h.goToDoc(asset.uid);
    await reviewSettled(page, { pins: 0 });
    // What the keyboard step counts, so that a count of none there is a count that can be more.
    await page
      .evaluate(() => {
        const seen = { count: 0 };
        window.__reviewPointer = seen;
        for (const kind of ['pointerdown', 'mousedown'])
          window.addEventListener(kind, (event) => event.isTrusted && seen.count++, true);
      })
      .catch(deferred);
    const empty = await readReview(page);
    h.check(
      'the asset page shows its picture as a review, round 1 open, with no pin and no Close round yet',
      empty?.round === 1 &&
        empty.status === 'Round 1 is open' &&
        empty.pins.length === 0 &&
        empty.add &&
        empty.close === null &&
        empty.src?.startsWith('blob:'),
      JSON.stringify(empty),
    );

    const placeByPointer = async ({ x, y, note }) => {
      const overlay = page.locator('.record-review__overlay');
      const box = await overlay.boundingBox().catch(unread);
      if (!box) return;
      await overlay.click({ position: { x: box.width * x, y: box.height * y } }).catch(deferred);
      await page.locator('.record-review__form textarea').fill(note).catch(deferred);
      await page.locator('.record-review__place').click().catch(deferred);
    };
    await placeByPointer(FIRST);
    await reviewSettled(page, { pins: 1 });
    await placeByPointer(SECOND);
    await reviewSettled(page, { pins: 2 });
    const pressed = await page.evaluate(() => window.__reviewPointer?.count ?? null).catch(unread);
    h.check(
      'placing a pin with the pointer fires pointer events: what the keyboard step counts none of',
      typeof pressed === 'number' && pressed > 0,
      `pointer events: ${pressed}`,
    );
    const placed = await readReview(page);
    const [one, two] = placed?.pins ?? [];
    h.check(
      'each pin is drawn where the picture was clicked, as fractions of the view, within 1%',
      close(one?.x, FIRST.x, 0.01) &&
        close(one?.y, FIRST.y, 0.01) &&
        close(two?.x, SECOND.x, 0.01) &&
        close(two?.y, SECOND.y, 0.01),
      JSON.stringify(placed?.pins),
    );
    const listed = placed?.rounds.find((round) => round.round === 1)?.entries ?? [];
    h.check(
      'the pins are listed beside the picture, numbered as on it, with their notes, in round 1',
      sameJson(
        listed.map((entry) => [entry.number, entry.note, entry.past]),
        [
          [1, FIRST.note, false],
          [2, SECOND.note, false],
        ],
      ),
      JSON.stringify(placed?.rounds),
    );
    h.check(
      "each pin's name says its number, round, place and note",
      one?.name === `Pin 1, round 1, 30% across, 25% down: ${FIRST.note}`,
      one?.name ?? 'no pin',
    );
    await page.locator('.record-review__entry[data-pin="1"]').click().catch(deferred);
    const chosen = await readReview(page);
    h.check(
      'choosing pin 1 in the list highlights it on the picture, and only it',
      chosen?.pins.map((pin) => pin.pressed).join() === 'true,false' &&
        chosen.rounds[0]?.entries.map((entry) => entry.pressed).join() === 'true,false',
      JSON.stringify(chosen?.pins.map((pin) => pin.pressed)),
    );
    await h.screenshot('review-round-1-two-pins');

    // ── 4.2 A second round ─────────────────────────────────────────────────────────────────────
    await h.step('4.2 Round 1 closed and round 2 opened; round 1 pins stay, marked as past');
    h.check('Close round 1 is offered once round 1 has a pin', chosen?.close === 'Close round 1');
    await page.locator('.record-review__close').click().catch(deferred);
    await page
      .waitForFunction(
        () => document.querySelector('.record-review')?.getAttribute('data-round') === '2',
        undefined,
        { timeout: 15_000 },
      )
      .catch(deferred);
    const second = await readReview(page);
    h.check(
      'round 2 is open, and its list comes first, empty, above round 1',
      second?.round === 2 &&
        second.status === 'Round 2 is open' &&
        sameJson(
          second.rounds.map((round) => [round.round, round.heading, round.entries.length]),
          [
            [2, 'Round 2, open', 0],
            [1, 'Round 1, past', 2],
          ],
        ),
      JSON.stringify(second?.rounds),
    );
    h.check(
      "round 1's pins stay on the picture, marked as past in their look and their names, and in the list",
      second?.pins.length === 2 &&
        second.pins.every((pin) => pin.past && pin.name?.includes('past round 1')) &&
        second.rounds[1]?.entries.every((entry) => entry.past),
      JSON.stringify(second?.pins.map((pin) => [pin.past, pin.name])),
    );
    await h.screenshot('review-round-2-open-round-1-past');

    // ── 4.3 By keyboard ────────────────────────────────────────────────────────────────────────
    await h.step('4.3 A pin placed with the keyboard alone, and the pins reached by keyboard');
    // A button pressed with Enter fires a click, so a click is not counted: no pointer is used.
    await page
      .evaluate(() => {
        if (window.__reviewPointer) window.__reviewPointer.count = 0;
      })
      .catch(deferred);
    // From the review's heading, which is focusable from script only: Tab reaches Add a pin.
    await page.locator('.record-review__heading').focus().catch(deferred);
    await page.keyboard.press('Tab');
    const onAdd = await page
      .evaluate(() => document.activeElement?.classList.contains('record-review__add'))
      .catch(unread);
    await page.keyboard.press('Enter');
    await page
      .waitForFunction(() => document.activeElement?.id?.endsWith('-across'), undefined, {
        timeout: 5000,
      })
      .catch(deferred);
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type(String(TYPED.across));
    await page.keyboard.press('Tab');
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type(String(TYPED.down));
    await page.keyboard.press('Tab');
    await page.keyboard.type(TYPED.note);
    await page.keyboard.press('Tab');
    const onPlace = await page
      .evaluate(() => document.activeElement?.classList.contains('record-review__place'))
      .catch(unread);
    await page.keyboard.press('Enter');
    await reviewSettled(page, { pins: 3 });
    const typed = await readReview(page);
    const pointer = await page.evaluate(() => window.__reviewPointer?.count ?? null).catch(unread);
    const third = typed?.pins.find((pin) => pin.number === 3);
    h.check(
      'Tab reaches Add a pin from the heading and Place pin from the note, and no pointerdown or mousedown is fired',
      onAdd === true && onPlace === true && pointer === 0,
      `Add a pin focused: ${onAdd}, Place pin focused: ${onPlace}, pointer events: ${pointer}`,
    );
    h.check(
      'the keyboard pin is pin 3, in round 2, at the place typed',
      third?.round === 2 &&
        third.left === `${TYPED.across}%` &&
        third.top === `${TYPED.down}%` &&
        close(third.x, TYPED.across / 100, 0.01) &&
        typed.rounds[0]?.entries.map((entry) => entry.note).join() === TYPED.note,
      JSON.stringify(third),
    );
    // The pins on the picture are one Tab stop, the chosen pin, the new one: Shift+Tab from the
    // first view button reaches it, and a second Shift+Tab leaves the picture.
    await page.locator('.record-picture__view').first().focus().catch(deferred);
    await page.keyboard.press('Shift+Tab');
    const stop = await page
      .evaluate(() => document.activeElement?.getAttribute('data-pin') ?? null)
      .catch(unread);
    await page.keyboard.press('Shift+Tab');
    const before = await page
      .evaluate(() =>
        document.activeElement?.closest('.record-review__marks') ? 'a pin' : 'out of the pins',
      )
      .catch(unread);
    await page.keyboard.press('Tab');
    h.check(
      'Shift+Tab from the views reaches one pin on the picture, the one just placed, and the next leaves the pins',
      stop === '3' && before === 'out of the pins',
      `reached pin ${stop}, then ${before}`,
    );
    await page.keyboard.press('Home');
    const reached = await readReview(page);
    const focused = await page
      .evaluate(() => document.activeElement?.getAttribute('data-pin'))
      .catch(unread);
    h.check(
      'Home moves to pin 1 and chooses it, and pin 1 is then the one Tab stop',
      focused === '1' &&
        reached?.pins.filter((pin) => pin.tabIndex === 0).length === 1 &&
        reached.pins[0]?.tabIndex === 0 &&
        reached.pins[0]?.pressed === 'true',
      JSON.stringify(reached?.pins.map((pin) => [pin.number, pin.tabIndex, pin.pressed])),
    );
    // The focused pin's ring, as drawn: no offset, so that it does not lie on the picture, and a
    // halo of the theme's surface outside it, against which its contrast is measured. Its style
    // and width first: a ring with none computes its colour to the text's (AGENTS/08, pattern 17).
    const ring = await page
      .evaluate(() => {
        const pin = document.activeElement;
        if (!pin?.classList.contains('record-review__pin')) return null;
        const style = getComputedStyle(pin);
        const probe = document.createElement('div');
        probe.style.background = 'var(--mat-sys-surface)';
        pin.parentElement?.appendChild(probe);
        const surface = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return {
          style: style.outlineStyle,
          width: parseFloat(style.outlineWidth),
          offset: style.outlineOffset,
          color: style.outlineColor,
          shadow: style.boxShadow,
          surface,
        };
      })
      .catch(unread);
    const halo = /^(rgba?\([^)]*\)) 0px 0px 0px (\d+(?:\.\d+)?)px/.exec(ring?.shadow ?? '');
    const ratio = ring && contrast(ring.color, ring.surface);
    h.check(
      "the focused pin's ring has no offset and a surface halo outside it, at 3:1 or more against it",
      ring !== null &&
        ring.style !== 'none' &&
        ring.width >= 2 &&
        ring.offset === '0px' &&
        halo?.[1] === ring.surface &&
        Number(halo?.[2]) > ring.width &&
        ratio !== null &&
        ratio >= 3,
      JSON.stringify({ ...ring, ratio: ratio === null ? null : Number(ratio.toFixed(2)) }),
    );
    await page.keyboard.press('ArrowRight');
    const moved = await page
      .evaluate(() => document.activeElement?.getAttribute('aria-label'))
      .catch(unread);
    h.check(
      'the arrow keys move to the next pin, whose name says its place',
      moved === `Pin 2, past round 1, 62% across, 70% down: ${SECOND.note}`,
      moved ?? 'nothing focused',
    );
    await h.screenshot('review-keyboard-pin-round-2');

    // ── 4.4 The server's ───────────────────────────────────────────────────────────────────────
    await h.step('4.4 The review is on the server: the REST API, a reload, a view of another size');
    const stored = await json(
      await page.request
        .get(api(`/id/${asset.uid}/@annotation?xpath=${encodeURIComponent(REVIEW_XPATH)}`))
        .catch(unread),
    );
    const ours = (stored?.entries ?? []).filter((entry) => entry.origin === REVIEW_ORIGIN);
    const payloads = ours
      .map((entry) => {
        try {
          return { ...JSON.parse(entry.entity), author: entry.author, text: entry.text };
        } catch {
          return null;
        }
      })
      .sort((a, b) => (a?.kind ?? '').localeCompare(b?.kind ?? '') || (a?.x ?? 0) - (b?.x ?? 0));
    // In the order sorted above: the pins by how far across, then the close.
    const expected = [
      { kind: 'pin', round: 1, x: FIRST.x, y: FIRST.y, text: FIRST.note },
      { kind: 'pin', round: 2, x: TYPED.across / 100, y: TYPED.down / 100, text: TYPED.note },
      { kind: 'pin', round: 1, x: SECOND.x, y: SECOND.y, text: SECOND.note },
      { kind: 'round-closed', round: 1, text: 'Round 1 closed' },
    ];
    h.check(
      `the REST API holds three pins and a round's close, as annotations on ${REVIEW_XPATH} by ${username}`,
      ours.length === expected.length &&
        ours.every((entry) => entry.xpath === REVIEW_XPATH && entry.author === username) &&
        expected.every(
          (want, index) =>
            payloads[index]?.kind === want.kind &&
            payloads[index].version === 1 &&
            payloads[index].round === want.round &&
            payloads[index].text === want.text &&
            (want.kind !== 'pin' ||
              (close(payloads[index].x, want.x, 0.01) && close(payloads[index].y, want.y, 0.01))),
        ),
      JSON.stringify(payloads),
    );
    const otherFile = await json(
      await page.request.get(api(`/id/${asset.uid}/@annotation?xpath=file:content`)).catch(unread),
    );
    h.check(
      "none is on the original's file, file:content, where the Annotations tab's viewer keeps its own",
      Array.isArray(otherFile?.entries) && otherFile.entries.length === 0,
      JSON.stringify(otherFile),
    );

    await page.reload({ waitUntil: 'networkidle' }).catch(deferred);
    await reviewSettled(page, { pins: 3 });
    const reloaded = await readReview(page);
    h.check(
      'after a real reload the page shows the same pins, round 2 open and round 1 past',
      reloaded?.round === 2 &&
        sameJson(
          reloaded.pins.map((pin) => [pin.number, pin.round, pin.past, pin.left, pin.top]),
          typed?.pins.map((pin) => [pin.number, pin.round, pin.past, pin.left, pin.top]),
        ),
      JSON.stringify(reloaded?.pins),
    );

    // An annotation is a comment: the Comments panel beside the page lists each pin's note.
    await page
      .locator('[role="tab"]', { hasText: /^\s*Comments\s*$/ })
      .first()
      .click()
      .catch(deferred);
    await page
      .waitForFunction(
        (note) => document.querySelector('nxs-comments')?.textContent?.includes(note),
        TYPED.note,
        { timeout: 15_000 },
      )
      .catch(deferred);
    const thread = await page
      .evaluate(() => document.querySelector('nxs-comments')?.textContent ?? null)
      .catch(unread);
    h.check(
      "the asset's Comments panel lists each pin's note, and the round's close",
      [FIRST.note, SECOND.note, TYPED.note, 'Round 1 closed'].every((text) =>
        thread?.includes(text),
      ),
      thread === null ? 'no comments panel' : thread.replace(/\s+/g, ' ').slice(0, 400),
    );

    const shownView = reloaded?.view;
    // Medium and Small are drawn at the frame's height alike; the Thumbnail is drawn smaller.
    await page.locator('.record-picture__view[data-view="Thumbnail"]').click().catch(deferred);
    await page
      .waitForFunction(
        () =>
          document.querySelector('.record-picture__figure')?.getAttribute('data-view') ===
            'Thumbnail' && document.querySelector('.record-picture__image')?.complete,
        undefined,
        { timeout: 15_000 },
      )
      .catch(deferred);
    const small = await readReview(page);
    // A place as fractions holds only if every view has the picture's proportions.
    const ratios = views
      .filter((each) => Number(each.width) > 0 && Number(each.height) > 0)
      .map((each) => Number(each.width) / Number(each.height));
    h.check(
      "every view Nuxeo made has the picture's proportions, within 2%",
      ratios.length === views.length &&
        ratios.every((ratio) => close(ratio, ratios[0], 0.02 * ratios[0])),
      JSON.stringify(views.map((each) => `${each.title} ${each.width}x${each.height}`)),
    );
    h.check(
      `on the Thumbnail view, drawn at another size than ${shownView}, each pin is on the same point`,
      small?.view === 'Thumbnail' &&
        small.image !== null &&
        reloaded?.image !== null &&
        small.image.width !== reloaded.image.width &&
        small.pins.length === 3 &&
        small.pins.every((pin, index) => {
          const before = reloaded.pins[index];
          return close(pin.x, before.x, 0.015) && close(pin.y, before.y, 0.015);
        }),
      JSON.stringify({ before: reloaded?.image, after: small?.image, pins: small?.pins }),
    );
    await h.screenshot('review-thumbnail-view-same-points');

    // ── 4.5 A reader ───────────────────────────────────────────────────────────────────────────
    await h.step(
      '4.5 A reader sees the pins and is offered no pin; a holder of Comment, a pin only',
    );
    // The record's own answer, with the permissions a reader has: a check of the page, not of the
    // server, which is said in a note.
    const isRecord = (url) => new URL(url).pathname === `/nuxeo/api/v1/id/${asset.uid}`;
    const asReader = async (route) => {
      const answer = await route.fetch();
      const body = await answer.json().catch(unread);
      if (body?.contextParameters)
        body.contextParameters.permissions = ['Read', 'Browse', 'ReadProperties', 'ReadChildren'];
      await route.fulfill({ response: answer, json: body });
    };
    await page.route(isRecord, asReader);
    await page.reload({ waitUntil: 'networkidle' }).catch(deferred);
    await reviewSettled(page, { pins: 3 });
    const reader = await readReview(page);
    await page.unroute(isRecord, asReader);
    h.check(
      'a reader sees the three pins and their list, with no Add a pin and no Close round',
      reader?.pins.length === 3 &&
        reader.rounds.flatMap((round) => round.entries).length === 3 &&
        !reader.add &&
        reader.close === null &&
        reader.readOnly === 'You can see the pins, but not add one.',
      JSON.stringify({ add: reader?.add, close: reader?.close, readOnly: reader?.readOnly }),
    );
    await h.screenshot('review-reader-no-pin-offered');

    // And a holder of Comment, not Write: offered a pin, not Close round. The same edit of the
    // record's answer in the browser, a check of the page alone.
    const asCommenter = async (route) => {
      const answer = await route.fetch();
      const body = await answer.json().catch(unread);
      if (body?.contextParameters)
        body.contextParameters.permissions = ['Read', 'Browse', 'ReadProperties', 'Comment'];
      await route.fulfill({ response: answer, json: body });
    };
    await page.route(isRecord, asCommenter);
    await page.reload({ waitUntil: 'networkidle' }).catch(deferred);
    await reviewSettled(page, { pins: 3 });
    const commenter = await readReview(page);
    await page.unroute(isRecord, asCommenter);
    h.check(
      'a holder of Comment, not Write, is offered Add a pin and not Close round',
      commenter?.pins.length === 3 &&
        commenter.add &&
        commenter.close === null &&
        commenter.readOnly === null,
      JSON.stringify({
        add: commenter?.add,
        close: commenter?.close,
        readOnly: commenter?.readOnly,
      }),
    );

    // ── Health ─────────────────────────────────────────────────────────────────────────────────
    await h.step('Health');
    h.expectNoConsoleErrors('no unexpected browser console errors', ENVIRONMENTAL_ERRORS);
    h.note(
      "the server's refusal of a reader's pin is not checked: Nuxeo 2025's comment service " +
        'accepts an annotation from anyone who may read the record, so Add a pin hidden from a ' +
        'reader is the page, not a security control',
    );
    h.note(
      'the reader is the record answered without Comment and Write in the browser, not a second ' +
        'account: the kit creates no people',
    );
    h.note(
      `the asset was of the type ${type}, and its layout came from config:dev, not from an installed package`,
    );
  } finally {
    // Whatever happened above: the run leaves nothing behind but the trash, or says what it left.
    if (scratch) {
      const trashed = await page.request
        .post(api('/automation/Document.Trash'), { data: { input: scratch, params: {} } })
        .catch(unread);
      if (trashed?.status() !== 200)
        h.note(
          `the run's ${ownWorkspace ? 'workspace' : 'folder'} ${folder?.path ?? scratch} was not ` +
            `trashed (${trashed?.status() ?? 'no answer'}): trash it by hand`,
        );
    }
  }
}
