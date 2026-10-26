/**
 * NXENG-808 — Header toolbar icon button focus ring (IBM 673904446).
 *
 *   NUXEO_DOC_UID=<non-trashed document where Add to collection is visible> \
 *   EVIDENCE_PHASE=after \
 *   npm run evidence:collect -- NXENG-808 scripts/collect-evidence/NXENG-808.mjs
 */
export const summary =
  'Document detail header toolbar icon buttons show a visible keyboard focus ring';

const DOC_UID = process.env['NUXEO_DOC_UID']?.trim();
const TOOLBAR_BTN = '[data-action-id="app.toolbar.addToCollection"]';
const BACK_BTN =
  '.detail-header > button.mat-mdc-icon-button, .detail-header > button.mat-icon-button';
const WCAG_1411_MIN_RATIO = 3;
const MAX_TAB_STEPS = 120;

/** @param {import('@playwright/test').Page} page */
async function tabToToolbarAddToCollection(page) {
  const back = page.locator(BACK_BTN).first();
  await back.waitFor({ state: 'visible', timeout: 30000 });
  await back.focus();

  for (let step = 0; step <= MAX_TAB_STEPS; step++) {
    const onTarget = await page.evaluate((sel) => {
      const target = document.querySelector(sel);
      return target != null && document.activeElement === target;
    }, TOOLBAR_BTN);
    if (onTarget) {
      return { ok: true, steps: step };
    }
    if (step === MAX_TAB_STEPS) {
      break;
    }
    await page.keyboard.press('Tab');
  }
  return { ok: false, steps: MAX_TAB_STEPS };
}

/** @param {import('@playwright/test').Page} page */
async function focusRingContrastOnHeader(page) {
  return page.evaluate(
    ({ toolbarSel, headerSel, minRatio }) => {
      const btn = document.querySelector(toolbarSel);
      const header = document.querySelector(headerSel);
      if (!btn || !header) {
        return { ok: false, reason: 'missing toolbar button or detail header' };
      }

      const parseColor = (css) => {
        if (!css || css.trim() === 'transparent') return null;
        const m = /^rgba?\(([^)]+)\)$/.exec((css ?? '').trim());
        if (!m) return null;
        const parts = m[1]
          .split(/[,\s/]+/)
          .filter(Boolean)
          .map(Number);
        if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
        return { rgb: parts.slice(0, 3), alpha: parts.length > 3 ? parts[3] : 1 };
      };

      const compositeOver = (color, backdropRgb) =>
        color.rgb.map((c, i) => Math.round(c * color.alpha + backdropRgb[i] * (1 - color.alpha)));

      const lum = ([r, g, b]) => {
        const ch = (v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
      };

      const ratio = (fgRgb, bgRgb) => {
        const [hi, lo] = [lum(fgRgb), lum(bgRgb)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
      };

      const style = getComputedStyle(btn);
      const outline = parseColor(style.outlineColor);
      const headerColor = parseColor(getComputedStyle(header).backgroundColor);
      if (!outline || !headerColor) {
        return {
          ok: false,
          reason: `unparsed colours outline=${style.outlineColor} header=${getComputedStyle(header).backgroundColor}`,
        };
      }

      const paintedOutline = compositeOver(outline, headerColor.rgb);
      const contrast = ratio(paintedOutline, headerColor.rgb);
      return {
        ok: contrast >= minRatio,
        contrast: contrast.toFixed(2),
        outlineColor: style.outlineColor,
        headerBackground: getComputedStyle(header).backgroundColor,
      };
    },
    {
      toolbarSel: TOOLBAR_BTN,
      headerSel: '.detail-header',
      minRatio: WCAG_1411_MIN_RATIO,
    },
  );
}

export const scenes = [
  {
    act: 1,
    title: 'Open document detail header toolbar',
    intent: 'Reach toolbar actions such as Add to collection',
    criterion: 'AC-1',
    async run(page, h) {
      await h.login();
      await h.requirePrecondition(
        'NUXEO_DOC_UID is set',
        Boolean(DOC_UID),
        'Set NUXEO_DOC_UID to a non-trashed document where app.toolbar.addToCollection is visible',
      );
      await h.goToDoc(DOC_UID);
      await h.expectVisible('detail header', '.detail-header');
      await h.expectVisible('Add to collection toolbar action', TOOLBAR_BTN);
      await h.shot('header-context', { highlight: TOOLBAR_BTN, label: 'Header toolbar' });
    },
  },
  {
    act: 2,
    title: 'Tab to Add to collection',
    intent: 'Keyboard user reaches a header toolbar icon button via Tab',
    criterion: 'AC-2',
    hold: 2000,
    spotlight: { selector: TOOLBAR_BTN, label: 'Add to collection' },
    async run(page, h) {
      h.note(
        'Focus visibility verdict: a11y-scout journey document-detail (keyboard/focusChecks), not this capture.',
      );
      const nav = await tabToToolbarAddToCollection(page);
      h.check('Tab reached Add to collection', nav.ok, `steps=${nav.steps}`);

      const style = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const s = getComputedStyle(el);
        return {
          outlineStyle: s.outlineStyle,
          outlineWidth: s.outlineWidth,
          active: document.activeElement === el,
        };
      }, TOOLBAR_BTN);

      h.note(
        `observed focus on toolbar icon button: active=${style?.active} outline=${style?.outlineStyle} ${style?.outlineWidth}`,
      );
      await h.shot('toolbar-focused', { highlight: TOOLBAR_BTN, label: 'Toolbar button focused' });
    },
  },
  {
    act: 3,
    title: 'Focus ring on header surface',
    intent: 'Ring visible against .detail-header background (WCAG 1.4.11)',
    criterion: 'AC-2',
    async run(page, h) {
      h.note(
        'WCAG 1.4.11 contrast verdict: a11y-scout focusChecks on journey document-detail, not this capture.',
      );
      const nav = await tabToToolbarAddToCollection(page);
      h.check('Tab reached Add to collection', nav.ok, `steps=${nav.steps}`);

      const w = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el).outlineWidth : null;
      }, TOOLBAR_BTN);
      const contrast = await focusRingContrastOnHeader(page);
      h.note(`observed outline width: ${w ?? 'missing'}`);
      h.note(
        contrast.reason
          ? `observed contrast (informational): ${contrast.reason}`
          : `observed contrast (informational): ${contrast.contrast}:1 (${contrast.outlineColor} on ${contrast.headerBackground})`,
      );

      await h.expectNoConsoleErrors('header toolbar', [
        /automation\/AI\./,
        /bootstrap\.json/,
        /\/nuxeo\/logout/,
      ]);
      await h.shot('toolbar-ring-proof', { highlight: TOOLBAR_BTN, label: 'Focus ring' });
    },
  },
];
