import { expect, test } from './fixtures';

/**
 * WCAG 2.1 AA 1.4.11 Non-text Contrast on the dashboard's "Create or import" floating action
 * button (NXSAT-212). Non-text UI components and their meaningful graphics need at least 3:1
 * against the adjacent colours. axe's `color-contrast` rule checks text nodes only, so this
 * asserts the computed colours directly.
 *
 * Three pairs are checked, all against the colours the button actually sits on:
 *   - fill vs the page background,
 *   - fill vs the rendered dashboard card (a `.widget` from `lib-widget-container`) it overlaps,
 *   - the `+` glyph vs the fill.
 *
 * Every colour must be fully opaque. A translucent colour depends on what is behind it, and
 * dropping its alpha would let a transparent fill measure as opaque, so the test fails instead.
 */

const FAB = 'button.dashboard-create-fab';
const CARD = 'lib-widget-container .widget';
const WCAG_NON_TEXT_MIN = 3;

type Rgb = [number, number, number];

/** Parses a computed `rgb()`/`rgba()` value. Throws on any alpha below 1. */
function parseOpaqueRgb(value: string): Rgb {
  const match = value.match(/rgba?\(([^)]+)\)/);
  if (!match) {
    throw new Error(`not an rgb() colour: ${value}`);
  }
  const parts = match[1].split(',').map((part) => Number(part.trim()));
  const [r, g, b, alpha = 1] = parts;
  if (alpha !== 1) {
    throw new Error(`translucent colour ${value}: composite it over its backdrop before measuring`);
  }
  return [r, g, b];
}

function relativeLuminance([r, g, b]: Rgb): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

test('dashboard Create or import button meets WCAG 1.4.11 non-text contrast', async ({
  signedIn: page,
}) => {
  await page.goto('/#/dashboard', { waitUntil: 'load' });

  const fab = page.locator(FAB).filter({ hasText: 'Create or import' });
  await expect(fab).toBeVisible();
  const card = page.locator(CARD).first();
  await expect(card).toBeVisible();

  const colours = await fab.evaluate((element) => {
    const style = getComputedStyle(element);
    const icon = element.querySelector('mat-icon');
    return {
      fill: style.backgroundColor,
      glyph: icon ? getComputedStyle(icon).color : style.color,
    };
  });
  const pageBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const cardBackground = await card.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );

  const fillRgb = parseOpaqueRgb(colours.fill);
  const glyphRgb = parseOpaqueRgb(colours.glyph);
  const pageRgb = parseOpaqueRgb(pageBackground);
  const cardRgb = parseOpaqueRgb(cardBackground);

  const ratios = {
    fillVsPage: contrastRatio(fillRgb, pageRgb),
    fillVsCard: contrastRatio(fillRgb, cardRgb),
    glyphVsFill: contrastRatio(glyphRgb, fillRgb),
  };

  expect
    .soft(ratios.fillVsPage, `fill ${colours.fill} vs page ${pageBackground}`)
    .toBeGreaterThanOrEqual(WCAG_NON_TEXT_MIN);
  expect
    .soft(ratios.fillVsCard, `fill ${colours.fill} vs card ${cardBackground}`)
    .toBeGreaterThanOrEqual(WCAG_NON_TEXT_MIN);
  expect
    .soft(ratios.glyphVsFill, `glyph ${colours.glyph} vs fill ${colours.fill}`)
    .toBeGreaterThanOrEqual(WCAG_NON_TEXT_MIN);
});
