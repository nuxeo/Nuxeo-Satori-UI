import { expect, test } from './fixtures';

/**
 * WCAG 2.1 AA 1.4.11 Non-text Contrast on the dashboard's "Create or import" floating action
 * button (NXSAT-212). Non-text UI components and their meaningful graphics need at least 3:1
 * against the adjacent colours. axe's `color-contrast` rule checks text nodes only, so this
 * asserts the computed colours directly.
 *
 * Three pairs are checked, all against the colours the button actually sits on:
 *   - fill vs the page background,
 *   - fill vs the white card it overlaps,
 *   - the `+` glyph vs the fill.
 */

const FAB = 'button.dashboard-create-fab';
const WCAG_NON_TEXT_MIN = 3;

type Rgb = [number, number, number];

function parseRgb(value: string): Rgb {
  const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) {
    throw new Error(`not an rgb() colour: ${value}`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
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

  const colours = await fab.evaluate((element) => {
    const style = getComputedStyle(element);
    const icon = element.querySelector('mat-icon');
    const pageBackground = getComputedStyle(document.body).backgroundColor;
    return {
      fill: style.backgroundColor,
      glyph: icon ? getComputedStyle(icon).color : style.color,
      pageBackground,
      cardWhite: 'rgb(255, 255, 255)',
    };
  });

  const fillRgb = parseRgb(colours.fill);
  const glyphRgb = parseRgb(colours.glyph);
  const pageRgb = parseRgb(colours.pageBackground);
  const cardRgb = parseRgb(colours.cardWhite);

  const ratios = {
    fillVsPage: contrastRatio(fillRgb, pageRgb),
    fillVsCard: contrastRatio(fillRgb, cardRgb),
    glyphVsFill: contrastRatio(glyphRgb, fillRgb),
  };

  expect
    .soft(ratios.fillVsPage, `fill ${colours.fill} vs page ${colours.pageBackground}`)
    .toBeGreaterThanOrEqual(WCAG_NON_TEXT_MIN);
  expect
    .soft(ratios.fillVsCard, `fill ${colours.fill} vs card white`)
    .toBeGreaterThanOrEqual(WCAG_NON_TEXT_MIN);
  expect
    .soft(ratios.glyphVsFill, `glyph ${colours.glyph} vs fill ${colours.fill}`)
    .toBeGreaterThanOrEqual(WCAG_NON_TEXT_MIN);
});
