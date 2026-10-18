/**
 * Phase 1 remediation — removing the residual `!important` declarations.
 *
 * `.sat-tag` and the Material dialog title kept their `!important` flags in
 * Phase 1 because Satori's and Material's own stylesheets genuinely outrank the
 * app's. Removing them was approved with an appearance change accepted, but
 * "accepted" is not "unmeasured": this capture records the computed styles and
 * geometry of the affected surfaces so before and after can be compared as
 * numbers rather than impressions.
 *
 * It is deliberately not an assertion of *equality* across the change. The point
 * is to detect a **material** regression — a tag that lost its background or its
 * shape, a label that is unreadably small or clipped, a dialog title that
 * reverted to Material's ~2rem display-medium. Those are the thresholds below.
 * Everything else is reported as a measurement for a human to compare.
 *
 * Surfaces were chosen because they were verified to actually render a
 * `.sat-tag` on a stock local instance: the browse details panel renders the
 * document lifecycle state as a `sat-status-tag`. The `Type` column that also
 * renders a `sat-category-tag` is not in the default column set, and the local
 * repository has no collections, so neither is a dependable capture surface.
 *
 * Run it once before removing the flags and once after, and diff the reported
 * `[measure]` lines:
 *   npm run beta:evidence -- phase-1-tag-styles
 *
 * Prerequisites:
 *   docker start nuxeo          (container `nuxeo`, published on 8080)
 *   npx nx serve nuxeo-ui       (separate terminal)
 */

const ENVIRONMENTAL_ERRORS = [
  /automation\/AI\./,
  '/nuxeo/logout',
  '/agentic-ui-config/bootstrap.json',
  '/agentic-ui-config/manifest.json',
];

/** Material's unstyled dialog title is display-medium, about 2rem. */
const MATERIAL_DEFAULT_TITLE_PX = 30;

/**
 * Measure the first `.sat-tag` on the page: every declaration the `!important`
 * block used to force, plus the geometry that shows whether it still reads as a
 * tag.
 *
 * @param {import('@playwright/test').Page} page
 */
function measureTag(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.sat-tag');
    if (!el) return null;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const label = el.querySelector('.sat-tag-label');
    return {
      text: el.textContent?.trim().slice(0, 40) ?? '',
      display: s.display,
      alignItems: s.alignItems,
      justifyContent: s.justifyContent,
      padding: s.padding,
      borderRadius: s.borderRadius,
      background: s.backgroundColor,
      border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`,
      color: s.color,
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
      lineHeight: s.lineHeight,
      boxShadow: s.boxShadow,
      minHeight: s.minHeight,
      labelFontSize: label ? getComputedStyle(label).fontSize : null,
      width: Math.round(r.width),
      height: Math.round(r.height),
      clipped: el.scrollWidth > el.clientWidth + 1,
    };
  });
}

/**
 * Record the measurement, then assert only that nothing regressed materially.
 *
 * @param {ReturnType<import('../helpers.mjs').createHelpers>} h
 * @param {string} surface where the tag was found, for the report
 * @param {Awaited<ReturnType<typeof measureTag>>} m
 */
function assertStillATag(h, surface, m) {
  if (!h.check(`${surface}: a tag is rendered to measure`, m !== null, 'no .sat-tag on the page')) {
    return;
  }
  console.log(`  [measure] ${surface} ${JSON.stringify(m)}`);
  const fontPx = parseFloat(m.fontSize);
  const radiusPx = parseFloat(m.borderRadius);
  h.check(
    `${surface}: the tag keeps a visible background`,
    m.background !== 'rgba(0, 0, 0, 0)' && m.background !== 'transparent',
    `background-color was ${m.background}`,
  );
  h.check(
    `${surface}: the tag keeps a rounded shape`,
    radiusPx > 0,
    `border-radius was ${m.borderRadius}`,
  );
  h.check(
    `${surface}: the label stays legible`,
    fontPx >= 10 && fontPx <= 16,
    `font-size was ${m.fontSize}`,
  );
  h.check(
    `${surface}: the label is not clipped`,
    !m.clipped,
    `scrollWidth exceeded clientWidth on "${m.text}"`,
  );
  h.check(
    `${surface}: the tag keeps sane box dimensions`,
    m.width > 0 && m.height >= 14 && m.height <= 48,
    `${m.width}x${m.height}px`,
  );
}

/**
 * Open the browse details panel, which is what renders the lifecycle-state tag.
 *
 * @param {import('@playwright/test').Page} page
 */
async function openDetailsPanel(page) {
  // The toggle is a toggle: the panel's open state survives navigation, so
  // clicking unconditionally closes it as often as it opens it. `Close panel`
  // only exists while the panel is open, which makes this idempotent.
  const close = page.locator('button[aria-label="Close panel"]');
  if ((await close.count()) > 0) return true;
  const toggle = page.locator('button[aria-label="Toggle details panel"]').first();
  if ((await toggle.count()) === 0) return false;
  await toggle.click();
  await page.waitForTimeout(2000);
  return (await close.count()) > 0;
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {ReturnType<import('../helpers.mjs').createHelpers>} h
 */
export default async function run(page, h) {
  await h.step('Tags on the browse details panel');
  await h.login();
  await h.goTo('/#/browse/default-domain');
  await h.expectVisible('browse page rendered', 'lib-browse');
  h.check('the details panel opens', await openDetailsPanel(page));
  assertStillATag(h, 'browse', await measureTag(page));
  await h.screenshot('tags-browse-details-panel');
  const firstTag = page.locator('.sat-tag').first();
  if (await firstTag.count()) {
    await h.screenshot('tags-browse-closeup', firstTag);
  }

  await h.step('Tags on a populated folder');
  await h.goTo('/#/browse/default-domain/workspaces');
  await h.expectVisible('workspaces folder rendered', 'lib-browse');
  await openDetailsPanel(page);
  assertStillATag(h, 'workspaces', await measureTag(page));
  await h.screenshot('tags-workspaces');

  await h.step('Shared dialog title');
  await h.goTo('/#/browse/default-domain');
  const edit = page.locator('button[mattooltip="Edit"]').first();
  h.check('an action that opens a shared dialog is available', (await edit.count()) > 0);
  await edit.click();
  await page.waitForTimeout(2000);
  const title = await page.evaluate(() => {
    const el = document.querySelector('.mat-mdc-dialog-title, [mat-dialog-title]');
    if (!el) return null;
    const s = getComputedStyle(el);
    return {
      text: el.textContent?.trim().slice(0, 60) ?? '',
      fontSize: s.fontSize,
      lineHeight: s.lineHeight,
      fontWeight: s.fontWeight,
      letterSpacing: s.letterSpacing,
    };
  });
  if (h.check('a dialog title is rendered to measure', title !== null, 'no dialog title found')) {
    console.log(`  [measure] dialog title ${JSON.stringify(title)}`);
    h.check(
      'the dialog title stays compact, not Material display-medium',
      parseFloat(title.fontSize) < MATERIAL_DEFAULT_TITLE_PX,
      `font-size was ${title.fontSize}; Material's unstyled default is about ${MATERIAL_DEFAULT_TITLE_PX}px`,
    );
    h.check(
      'the dialog title is still larger than body text',
      parseFloat(title.fontSize) >= 16,
      `font-size was ${title.fontSize}`,
    );
  }
  await h.screenshot('dialog-title');

  await h.step('Health');
  h.expectNoConsoleErrors('no unexpected browser console errors', ENVIRONMENTAL_ERRORS);
}
