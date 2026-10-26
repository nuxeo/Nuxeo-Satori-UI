/**
 * Scene 2 — how a customer customises it.
 *
 * Slides explain the four layers; the live cuts show two of them actually taking
 * effect in the template. Layer 0 is demonstrated by editing `bootstrap.json` on
 * disk between two reloads, so the change is genuinely coming from configuration
 * rather than from a rebuild.
 *
 * The template is served from a **copy** under the evidence directory, not from
 * `dist/`, so the recording can mutate its config without touching build output.
 */

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A note on navigation waits.
 *
 * These used `waitUntil: 'networkidle'`, which is the wrong tool here: the template
 * once requested a Nuxeo manifest that 404'd, so "500ms of no network
 * activity" was not a reliable signal and the goto timed out at 30s. Waiting for
 * `load` and then for the navigation element it actually needs is both faster and
 * deterministic.
 */

const CONFIG = 'agentic-ui-config/bootstrap.json';

/**
 * Rewrite one branch of the template's bootstrap fragment. The served file is the
 * configuration servlet's envelope, and the template's values are its one fragment.
 */
function patchConfig(dir, mutate) {
  const path = join(dir, CONFIG);
  const envelope = JSON.parse(readFileSync(path, 'utf8'));
  mutate(envelope.fragments.at(-1).content);
  writeFileSync(path, `${JSON.stringify(envelope, null, 2)}\n`);
}

export default async function run({ page, deckUrl, serve, hold, playDeck, teardown, ROOT }) {
  const built = join(ROOT, 'dist', 'nuxeo-satori-template', 'browser');
  const stage = join(ROOT, 'dist', '.video-stage-02');
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  cpSync(built, stage, { recursive: true });

  const app = await serve(stage, 4412);
  teardown.push(app.stop);

  // ---- Slides 1-2: the four layers ---------------------------------------
  await page.goto(`${deckUrl}/deck.html?deck=02-customize`);
  await page.waitForSelector('body[data-ready="true"]');
  await hold(page, 1200);
  await playDeck(page, { from: 0, to: 1 });

  // ---- Slide 3, then Layer 0 taking effect live ---------------------------
  await page.evaluate(() => window.deck.show(2));
  await hold(page, 8000);

  // The packaged default first, so the change has a visible "before".
  patchConfig(stage, (c) => {
    c.branding = { applicationTitle: 'Nuxeo Satori', documentTitle: 'Nuxeo Satori' };
    c.defaultThemeId = 'nuxeo';
  });
  await page.goto(app.url, { waitUntil: 'load' });
  await page.waitForSelector('.shell__nav-link', { timeout: 45000 });
  await hold(page, 4000);

  // Now the customer's file. No rebuild between these two frames — only the JSON
  // changed, and the bundle bytes are identical.
  patchConfig(stage, (c) => {
    c.branding = { applicationTitle: 'Acme Content', documentTitle: 'Acme Content' };
    c.defaultThemeId = 'acme';
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.shell__nav-link', { timeout: 45000 });
  await hold(page, 5000);

  // ---- Slides 4-5: the manifest, and its limits ---------------------------
  await page.goto(`${deckUrl}/deck.html?deck=02-customize`);
  await page.waitForSelector('body[data-ready="true"]');
  await playDeck(page, { from: 3, to: 4 });

  // ---- Slide 6, then Layer 2 live: the registry-resolved surface ----------
  await page.evaluate(() => window.deck.show(5));
  await hold(page, 9000);

  await page.goto(app.url, { waitUntil: 'load' });
  await page.waitForSelector('.shell__nav-link', { timeout: 45000 });
  await hold(page, 2500);

  // Scroll the inventory panel into shot — every ID this build registered,
  // including the customer library's, read from the live registry.
  const inventory = page.locator('.home__panel').last();
  await inventory.scrollIntoViewIfNeeded().catch(() => {});
  await hold(page, 6000);

  // Follow the customer library's own entry, and land on its own panel.
  const acme = page.locator('.shell__nav-link:has-text("AcmeExtensions")');
  if (await acme.count()) {
    await acme.click().catch(() => {});
    await page.waitForTimeout(2500);
    await hold(page, 4500);
  }

  // ---- Slides 7-8: security, and the upgrade promise ----------------------
  await page.goto(`${deckUrl}/deck.html?deck=02-customize`);
  await page.waitForSelector('body[data-ready="true"]');
  await playDeck(page, { from: 6 });
  await hold(page, 1600);

  rmSync(stage, { recursive: true, force: true });
}
