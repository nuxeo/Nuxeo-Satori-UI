/**
 * Scene 1 — which components on screen are upstream, and which are ours.
 *
 * ## Why this is not a deck
 *
 * An earlier cut of this scene was mostly slides, and was rejected for being "more of a
 * PPT presentation". The claim being made — *this thing you are looking at came from
 * `@alfresco`, that thing next to it is ours* — cannot be made by a slide, because a slide
 * can say anything. It can only be made by drawing on the running product. So the bulk of
 * this scene is the live app with `tools/video/overlay/provenance-overlay.mjs` injected on
 * top of it: three slides of framing, then the product.
 *
 * ## What the overlay is anchored to
 *
 * Real DOM elements, found by Angular component selector. The selectors came out of the
 * shipped bundles and out of `libs/shared/adf-hx-bridge/src`, and every reveal reports the
 * tags it could *not* draw, so a beat that silently annotated nothing shows up in the run
 * log instead of passing quietly.
 *
 * ## Verifying it
 *
 *   PROV_SHOTS=/tmp/prov node tools/video/record.mjs 01-provenance
 *
 * writes a PNG and a `placements()` dump per beat. That is the same code path as the
 * recording, so what is checked is what is filmed.
 *
 * ## Honest limitations, filmed as they are
 *
 * - Folder navigation is not wired on this route — no row double-click or title click
 *   descends. The scene deep-links with `?path=` instead of miming a click that does
 *   nothing.
 * - Upstream's viewer previews what adf-core can show natively — PDF, PNG, JPEG, GIF, BMP,
 *   SVG, text, audio and video. Anything else, WebP and Office files included, would need a
 *   rendition this bridge cannot serve, so the scene previews the PDF fixture.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ADOPTED_COUNT,
  OURS_COUNT,
  caption,
  clearOverlay,
  installOverlay,
  placements,
  revealAndHold,
  scan,
  unknownSelectors,
} from '../overlay/provenance-overlay.mjs';
import { requireNuxeoCredentials } from '../../../scripts/beta-harness/nuxeo-credentials.mjs';

const PRODUCT = 'http://localhost:4200';

/**
 * A workspace with eleven mixed children — files, folders, an image and a PDF.
 * The repository root has two folderish rows and nothing to select, which makes the
 * Preview beat unreachable; hence a folder, reached by the
 * route's own `path` query parameter.
 */
const FOLDER = '/default-domain/workspaces/Narasimha';

const SHOTS = process.env['PROV_SHOTS'] ?? '';
let beatNo = 0;

async function productReachable() {
  try {
    const res = await fetch(PRODUCT, { signal: AbortSignal.timeout(3000) });
    return res.ok || res.status === 302;
  } catch {
    return false;
  }
}

/**
 * Sign in. The form is **two-step** — username, submit, then the password field appears.
 * This Nuxeo permits anonymous access, so without the signed-out flag the app auto-
 * authenticates as Anonymous, which can see 1 document out of 123. An earlier recording
 * did exactly that and looked like a working demo of an empty repository.
 */
async function signIn(page, { username: user, password: pass }) {
  const username = page.locator('input[formcontrolname="username"]');
  if (!(await username.count())) return false;
  if (!(await username.isVisible().catch(() => false))) return false;

  await username.fill(user);
  await page.locator('button[type="submit"]').first().click();

  const password = page.locator('input[formcontrolname="password"]');
  await password.waitFor({ state: 'visible', timeout: 15000 });
  await password.fill(pass);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3500);
  return !(await password.isVisible().catch(() => false));
}

/** Record a beat: log what was drawn, and in verify mode write a frame and a dump. */
async function beat(page, name) {
  beatNo += 1;
  const tag = `${String(beatNo).padStart(2, '0')}-${name.replace(/[^a-z0-9]+/gi, '-')}`;
  const p = await placements(page);
  const drawn = Object.entries(p)
    .filter(([, v]) => !v.hidden)
    .map(([k]) => k);
  console.log(`  [beat ${tag}] drawn: ${drawn.join(' ') || '(none)'}`);
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, `${tag}.png`) });
    writeFileSync(join(SHOTS, `${tag}.json`), JSON.stringify(p, null, 2));
  }
}

/**
 * Go to the adf-hx browse route at a path, wait for it to settle, re-inject the overlay.
 *
 * The route is hash-based, so `page.goto` here is a **same-document** navigation: the overlay
 * and, worse, its caption survive it. That produced a frame of the repository root sitting
 * under the caption "Upstream's viewer, on screen and running" — the caption from the
 * previous beat, over a screen that had no viewer in it. Anything left over is torn down
 * immediately after the navigation, before the seven-second settle.
 */
async function goBrowse(page, path) {
  await page.goto(`${PRODUCT}/#/browse-adf-hx?path=${encodeURIComponent(path)}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.evaluate(() => {
    if (window.__prov) {
      window.__prov.clear();
      window.__prov.caption(null);
    }
  });
  await page.waitForTimeout(7000);
  await installOverlay(page);
}

const clickTab = (page, label) =>
  page.locator('.hxp-browse-tabs__tab', { hasText: label }).first().click({ timeout: 8000 });

/**
 * Start a beat: drop the previous annotations and put the new caption up *before* the
 * interaction.
 *
 * An earlier cut set the caption after clicking, which left a stale caption over an
 * un-annotated screen for two to three seconds. On one extracted frame the column picker was
 * open under the words "Our navigation drawer, wrapping upstream's document tree", and on
 * another the viewer's error state sat under "Trash and restore: ours". Both would have read
 * as mislabelling the product. The caption now always describes what is on screen.
 */
async function stage(page, text) {
  await clearOverlay(page);
  await caption(page, text);
}

/**
 * End a beat before undoing it.
 *
 * The mirror image of the stale-caption problem: closing the details panel, dismissing the
 * column picker, scrolling the pager away or escaping the viewer all leave the caption
 * describing something that has just left the screen. On one extracted frame the words "The
 * details panel — tags, state, activity — is ours" sat over a list with no panel in it, and
 * the counter had already dropped to zero-of-ours, which is what gave it away. Tear the
 * annotations and the caption down *first*, then revert the interaction.
 */
const endBeat = (page) => stage(page, null);

/** Check the first row whose title matches, so Preview has a target. */
async function selectRow(page, pattern) {
  const rows = page.locator('adf-datatable-row');
  const n = await rows.count();
  for (let i = 1; i < n; i += 1) {
    const text = await rows
      .nth(i)
      .innerText()
      .catch(() => '');
    if (pattern.test(text)) {
      await rows.nth(i).locator('input[type="checkbox"]').click({ timeout: 6000 });
      await page.waitForTimeout(2000);
      return text.replace(/\s+/g, ' ').trim();
    }
  }
  return null;
}

export default async function run({ page, deckUrl, hold, playDeck }) {
  // ---- Framing: three slides, and then out of the way ----------------------
  await page.goto(`${deckUrl}/deck.html?deck=01-provenance`);
  await page.waitForSelector('body[data-ready="true"]');
  await hold(page, 1000);
  await playDeck(page, { from: 0, to: 0 });
  await playDeck(page, { from: 2, to: 2 });

  if (!(await productReachable())) {
    console.log('  [scene] product unreachable — recording the framing only');
    await playDeck(page, { from: 7, to: 7 });
    return;
  }

  // ---- Sign in as Administrator -------------------------------------------
  // NUXEO_USER / NUXEO_PASS, no default (NXSAT-649) — both fell back to the local Docker
  // administrator pair. Required here, where the live cut starts, and outside `signIn`'s
  // `.catch(() => false)` below: inside it, a missing pair would read as "NOT signed in" and
  // quietly record the framing only, which is a different and misleading outcome.
  const credentials = requireNuxeoCredentials('sign in for the 01-provenance live cut');
  await page.goto(`${PRODUCT}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem('agentic_ui_signed_out', '1');
  });
  await page.goto(`${PRODUCT}/#/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const signedIn = await signIn(page, credentials).catch(() => false);
  console.log(`  [scene] signed in: ${signedIn}`);
  if (!signedIn) {
    // Filming Anonymous and captioning it Administrator is the failure mode this guard
    // exists for. Bail to the closing slide rather than ship a misleading live cut.
    console.log('  [scene] NOT signed in — skipping the live cut');
    await page.goto(`${deckUrl}/deck.html?deck=01-provenance`);
    await page.waitForSelector('body[data-ready="true"]');
    await playDeck(page, { from: 7, to: 7 });
    return;
  }

  // ---- The live product ---------------------------------------------------
  await goBrowse(page, FOLDER);

  const onScreen = await scan(page);
  console.log(`  [scene] on screen — adf-hx: ${onScreen['adf-hx'].join(' ')}`);
  console.log(`  [scene] on screen — adf-core: ${onScreen['adf-core'].join(' ')}`);
  console.log(`  [scene] on screen — ours: ${onScreen.ours.join(' ')}`);
  const unknown = await unknownSelectors(page);
  if (unknown.length)
    console.log(`  [scene] UNREGISTERED selectors on screen: ${unknown.join(' ')}`);

  await caption(page, 'This is the running product, not a screenshot. Signed in as Administrator.');
  await hold(page, 3500);
  await beat(page, 'live-app');

  // Beat 1 — the list, and the adf-core datatable inside it.
  await caption(
    page,
    'The document list is upstream: imported from @alfresco/adf-hx-content-services.',
  );
  await revealAndHold(page, ['hxp-document-list'], 5000, { label: 'list' });
  await beat(page, 'document-list');

  await caption(
    page,
    'Inside it, an adf-core DataTable. Rows, sorting and selection are upstream code.',
  );
  await revealAndHold(page, ['adf-datatable'], 5000, { label: 'datatable' });
  await beat(page, 'datatable');

  // Beat 2 — the breadcrumb, three upstream components deep.
  await caption(
    page,
    'The breadcrumb is upstream too — and is itself three nested upstream components.',
  );
  await revealAndHold(page, ['hxp-ui-breadcrumb', 'hxp-breadcrumb', 'adf-breadcrumb'], 5500, {
    label: 'breadcrumb',
  });
  await beat(page, 'breadcrumb');

  // Beat 3 — everything framing it is ours, under a prefix that looks identical.
  await caption(
    page,
    'Everything framing it is ours. Same Hxp prefix, mirroring upstream — so the prefix tells you nothing.',
  );
  await revealAndHold(
    page,
    ['hxp-folder-header', 'hxp-browse-tabs', 'hxp-browse-toolbar', 'hxp-icon'],
    6500,
    {
      label: 'ours-frame',
    },
  );
  await beat(page, 'ours-frame');

  // Beat 4 — the pager, below the fold until we scroll to it. The boxes track the DOM as it
  // scrolls, which is itself the point: they are anchored to elements, not to pixels.
  await caption(page, 'Paging is ours as well: upstream ships the table, not the page controls.');
  await page.evaluate(() => window.__prov.scrollIntoView('hxp-browse-pager'));
  await page.waitForTimeout(1500);
  await revealAndHold(page, ['hxp-browse-pager'], 4500, { label: 'pager' });
  await beat(page, 'pager');
  await endBeat(page);
  await page.evaluate(() => window.__prov.scrollIntoView('hxp-folder-header'));
  await page.waitForTimeout(1200);

  // Beat 5 — the details panel: ours end to end, with no upstream component inside it.
  await stage(
    page,
    'The details panel — tags, state, activity — is ours. Nothing upstream is inside it.',
  );
  await page
    .locator('button[aria-label="Toggle details panel"]')
    .click({ timeout: 8000 })
    .catch((e) => console.log(`  [scene] details panel: ${e.message}`));
  await page.waitForTimeout(4000);
  await revealAndHold(page, ['hxp-browse-details-panel', 'hxp-document-list'], 6000, {
    label: 'details-panel',
  });
  await beat(page, 'details-panel');
  await endBeat(page);
  await page
    .locator('button[aria-label="Toggle details panel"]')
    .click({ timeout: 8000 })
    .catch(() => {});
  await page.waitForTimeout(1500);

  // Beat 6 — our drawer, upstream's tree inside it. The bridge pattern in one picture.
  await stage(
    page,
    'Our navigation drawer, wrapping upstream’s document tree. That is the bridge pattern.',
  );
  await page
    // By id, not by label: the entry's text is a translated Layer 0 string and a
    // relabel would leave this matching nothing, silently filming the wrong beat.
    .locator('sat-platform-nav-list-item[data-nav-id="app.navbar.browseAdfHx"]')
    .first()
    .click({ timeout: 8000 })
    .catch((e) => console.log(`  [scene] nav item click failed: ${e.message}`));
  await page.waitForTimeout(5000);
  await revealAndHold(
    page,
    ['hxp-browse-nav-drawer', 'hxp-document-tree', 'hxp-folder-icon'],
    7000,
    {
      label: 'nav-drawer',
    },
  );
  await beat(page, 'nav-drawer-tree');

  // Beat 7 — the column picker. Upstream has none; this is a rehomed responsibility.
  await stage(
    page,
    'Upstream’s list has no column picker. This one is ours, rehomed into the bridge.',
  );
  await page
    .locator('.hxp-poc-column-btn')
    .click({ timeout: 8000 })
    .catch((e) => console.log(`  [scene] columns: ${e.message}`));
  await page.waitForTimeout(2500);
  await revealAndHold(page, ['hxp-column-picker'], 5500, { label: 'column-picker' });
  await beat(page, 'column-picker');
  await endBeat(page);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);

  // Beat 8 — the card view replaces upstream's list entirely.
  await stage(
    page,
    'Switch to cards and upstream leaves the frame: the card view is entirely ours.',
  );
  await page
    .locator('button[aria-label="Card view"]')
    .click({ timeout: 8000 })
    .catch((e) => console.log(`  [scene] cards: ${e.message}`));
  await page.waitForTimeout(4000);
  await revealAndHold(page, ['hxp-document-cards', 'hxp-browse-toolbar', 'hxp-browse-tabs'], 6000, {
    label: 'cards',
  });
  await beat(page, 'document-cards');
  await stage(page, null);
  await page
    .locator('button[aria-label="List view"]')
    .click({ timeout: 8000 })
    .catch(() => {});
  await page.waitForTimeout(3000);

  // Properties and Versions were beats 9 and 10 here, over upstream's sidebars in browse tabs of
  // those names. The tabs were removed on 2026-09-23 so the folder tabs match production browse,
  // which keeps both panels on the document page.

  // Beat 11 — the Permissions tab, now upstream's own panel, then two tabs with no upstream
  // component in them at all. Permissions used to be in the second group: `hxp-browse-permissions`
  // was a read-only table of ours, and the line here said upstream shipped nothing for it. Both
  // stopped being true when `hxp-permissions-management-panel` was adopted.
  let spinnerCaught = false;
  for (const [tab, tag, text] of [
    [
      'Permissions',
      'hxp-permissions-management-panel',
      'Permissions: upstream’s own panel, reading and writing real Nuxeo ACLs.',
    ],
    [
      'History',
      'hxp-browse-history',
      'Audit history: ours, over Nuxeo’s audit API. No upstream component here.',
    ],
    [
      'Trash',
      'hxp-browse-trash',
      'Trash and restore: ours. Upstream on screen in this tab — zero.',
    ],
  ]) {
    await stage(page, text);
    await clickTab(page, tab).catch((e) => console.log(`  [scene] ${tab}: ${e.message}`));
    // `HxpSpinnerComponent` exists only while a tab is loading, so it can only be caught in
    // the gap between the click and the response. The previous attempt "caught" it and then
    // held for 900ms, by which time the box was hidden and the frame showed nothing — a beat
    // that logged success and filmed an empty screen. Now the placement is re-read straight
    // after the hold and only a still-drawn spinner counts.
    if (!spinnerCaught) {
      for (let i = 0; i < 30; i += 1) {
        const r = await page.evaluate(() => window.__prov.reveal(['hxp-spinner']));
        if (r.added.length) {
          await page.waitForTimeout(250);
          const still = await placements(page);
          if (still['hxp-spinner'] && !still['hxp-spinner'].hidden) {
            spinnerCaught = true;
            await hold(page, 1200);
            await beat(page, `spinner-during-${tab}`);
          }
          break;
        }
        await page.waitForTimeout(100);
      }
    }
    await page.waitForTimeout(4500);
    await clearOverlay(page, ['hxp-spinner']);
    await revealAndHold(page, [tag], 5000, { label: tab });
    await beat(page, `tab-${tab}`);
  }
  console.log(
    spinnerCaught
      ? '  [scene] HxpSpinnerComponent annotated while a tab was loading'
      : '  [scene] HxpSpinnerComponent was never on screen long enough to annotate — NOT covered',
  );

  // Beat 12 — upstream's viewer, previewing the PDF fixture.
  //
  // Every fixture used to land on "Couldn't load preview": the bridge never mapped the main file
  // to `sysfile_blob`, which is where the viewer reads the MIME type from, so it treated every
  // file as unsupported. With that mapped and the DOWNLOAD port serving it from `file:content`,
  // the viewer renders the file itself. The caption says so only if it did — an error state
  // captioned as a preview would be the misleading kind of evidence.
  await stage(page, null);
  await clickTab(page, 'View').catch(() => {});
  await page.waitForTimeout(3000);
  const previewTarget = await selectRow(page, /lta_merged\.pdf/i).catch(() => null);
  console.log(`  [scene] preview target: ${previewTarget}`);
  const preview = page.locator('.hxp-browse-page__preview-btn');
  if (await preview.count()) {
    await preview
      .click({ timeout: 8000 })
      .catch((e) => console.log(`  [scene] preview: ${e.message}`));
    await page.waitForTimeout(7000);
    const unsupported = await page.locator('adf-viewer-unknown-format').count();
    if (unsupported) console.log('  [scene] viewer showed its unsupported-format state');
    await caption(
      page,
      unsupported
        ? 'Upstream’s viewer, open — but it could not render this file, so this is its own error state.'
        : 'Upstream’s viewer, rendering the PDF itself, served from Nuxeo through the bridge.',
    );
    await revealAndHold(page, ['hxp-ui-document-viewer', 'adf-viewer'], 6500, { label: 'viewer' });
    await beat(page, 'document-viewer');
    await endBeat(page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1500);
  } else {
    console.log('  [scene] no preview button — viewer beat skipped');
  }

  // Beat 13 — the repository root, for the one bridge component only rendered there,
  // and then everything registered and on screen at once.
  await goBrowse(page, '/');
  await caption(
    page,
    'Back at the repository root. Every registered component on screen, in one pass.',
  );
  const all = await page.evaluate(() => window.__prov.revealAllOnScreen());
  if (all.missing.length) console.log(`  [scene] all-pass not drawn: ${all.missing.join(', ')}`);
  await hold(page, 6000);
  await beat(page, 'all-on-screen');

  // The counter's "upstream" total mixes adopted components, upstream internals and adf-core,
  // so it reads higher than the adopted count. These numbers are read back off the overlay and
  // the registry rather than typed, so the caption cannot drift from the outlines.
  const s = await page.evaluate(() => window.__prov.summary());
  console.log(`  [scene] all-pass breakdown: ${JSON.stringify(s)}`);
  await caption(
    page,
    `On this screen: ${s.adopted} of the ${ADOPTED_COUNT} adopted adf-hx components, ${s.internals} upstream internals, ` +
      `${s.core} from adf-core — and ${s.ours} of ours.`,
  );
  await hold(page, 7000);
  await beat(page, 'all-on-screen-breakdown');

  await caption(
    page,
    `Across the whole route: ${ADOPTED_COUNT} adf-hx components adopted, ${OURS_COUNT} of ours, 12 API ports behind them.`,
  );
  await hold(page, 5500);
  await beat(page, 'closing-live');

  // ---- One closing slide, for the number the overlay cannot show ----------
  //
  // Non-fatal. The deck's static server is on a port shared with the other scenes' harness
  // and went down mid-run once, which aborted the scene *after* all eighteen live beats had
  // been filmed. The live cut is the point of this scene; losing the closing slide is a
  // blemish, losing the recording is not acceptable.
  try {
    await page.goto(`${deckUrl}/deck.html?deck=01-provenance`);
    await page.waitForSelector('body[data-ready="true"]');
    await playDeck(page, { from: 7, to: 7 });
    await hold(page, 1500);
  } catch (error) {
    console.log(
      `  [scene] closing slide unavailable (${error.message.split('\n')[0]}) — live cut is complete`,
    );
  }
}
