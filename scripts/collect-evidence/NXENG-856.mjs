/** NXENG-856 — Preview tab `.format-type` label WCAG 1.4.3 AA contrast. */

export const summary = 'Document detail Preview tab format-type label meets WCAG AA text contrast';

const DOC_UID = process.env['NUXEO_DOC_UID']?.trim();

/**
 * Leave View on another tab, then activate View with keyboard (Enter) so AC-3 is not a no-op.
 * @param {import('@playwright/test').Page} page
 */
async function openViewTabWithKeyboard(page) {
  const viewTab = page.getByRole('tab', { name: /view|preview/i }).first();
  const tabs = page.getByRole('tab');
  const tabCount = await tabs.count();
  if (tabCount < 2 || !(await viewTab.isVisible().catch(() => false))) {
    return { ok: false, reason: 'need a visible View tab and at least one other tab' };
  }

  let otherTab = null;
  for (let i = 0; i < tabCount; i += 1) {
    const candidate = tabs.nth(i);
    const label = (await candidate.innerText()).trim();
    if (!/view|preview/i.test(label)) {
      otherTab = candidate;
      break;
    }
  }
  if (!otherTab) {
    return { ok: false, reason: 'no non-View tab found to switch away from View' };
  }

  await otherTab.focus();
  await page.keyboard.press('Enter');
  const viewSelectedAfterLeave = await viewTab.getAttribute('aria-selected');
  const otherSelectedAfterLeave = await otherTab.getAttribute('aria-selected');
  if (viewSelectedAfterLeave === 'true' || otherSelectedAfterLeave !== 'true') {
    return {
      ok: false,
      reason: `after leaving View: view aria-selected=${viewSelectedAfterLeave}, other aria-selected=${otherSelectedAfterLeave}`,
    };
  }

  await viewTab.focus();
  await page.keyboard.press('Enter');
  const viewSelected = await viewTab.getAttribute('aria-selected');
  const otherSelected = await otherTab.getAttribute('aria-selected');
  const formatTypeVisible = await page
    .locator('lib-document-viewer .format-type')
    .first()
    .isVisible()
    .catch(() => false);
  if (viewSelected !== 'true' || otherSelected === 'true' || !formatTypeVisible) {
    return {
      ok: false,
      reason: `after keyboard View: view aria-selected=${viewSelected}, other aria-selected=${otherSelected}, .format-type visible=${formatTypeVisible}`,
    };
  }
  return { ok: true };
}

/** @param {import('@playwright/test').Page} page */
async function contrastRatioFor(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { ok: false, reason: 'missing element' };
    const fg = getComputedStyle(el).color;
    const parseColor = (css) => {
      if (!css || css.trim() === 'transparent') return null;
      const m = /^rgba?\(([^)]+)\)$/.exec(css.trim());
      if (!m) return null;
      const parts = m[1]
        .split(/[,\s/]+/)
        .filter(Boolean)
        .map(Number);
      if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
      return { rgb: parts.slice(0, 3), alpha: parts.length > 3 ? parts[3] : 1 };
    };
    let node = el.parentElement;
    let bg = 'rgb(255, 255, 255)';
    while (node) {
      const c = getComputedStyle(node).backgroundColor;
      const parsed = parseColor(c);
      if (parsed && parsed.alpha === 1) {
        bg = c;
        break;
      }
      node = node.parentElement;
    }
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
    const fgColor = parseColor(fg);
    const bgColor = parseColor(bg);
    if (!fgColor || !bgColor || bgColor.alpha !== 1) {
      return { ok: false, reason: `unmeasurable colours fg=${fg} bg=${bg}`, fg, bg };
    }
    const painted = compositeOver(fgColor, bgColor.rgb);
    const r = ratio(painted, bgColor.rgb);
    return { ok: true, ratio: r, fg, bg, text: el.textContent?.trim() ?? '' };
  }, selector);
}

export const scenes = [
  {
    act: 1,
    title: 'Open a picture on Document detail',
    intent: 'Review additional renditions in the Preview tab viewer strip',
    criterion: 'AC-3',
    async run(page, h) {
      await h.login();
      await h.requirePrecondition(
        'NUXEO_DOC_UID is set',
        Boolean(DOC_UID),
        'Set NUXEO_DOC_UID to a Picture with Additional formats',
      );
      await h.goToDoc(DOC_UID);
      await h.expectVisible('document detail loads', 'lib-document-detail');
      const keyboardResult = await openViewTabWithKeyboard(page);
      h.check(
        'View tab opens from keyboard after leaving another tab',
        keyboardResult.ok === true,
        keyboardResult.reason ?? 'View selected and lib-document-viewer visible',
      );
      await h.shot('doc-detail', { highlight: 'lib-document-detail', label: 'Document detail' });
    },
  },
  {
    act: 2,
    title: 'Read the format label in Additional formats',
    intent: 'The uppercase format name beside each rendition size',
    criterion: 'AC-1',
    hold: 2500,
    spotlight: { selector: 'lib-document-viewer .format-type', label: 'Format type label' },
    async run(page, h) {
      const viewTab = page.getByRole('tab', { name: /view|preview/i }).first();
      if (await viewTab.isVisible().catch(() => false)) {
        await viewTab.click({ timeout: 15000 });
      }
      await h.expectVisible('document viewer', 'lib-document-viewer');
      const format = page
        .locator('lib-document-viewer .format-type')
        .filter({ hasText: /\S/ })
        .first();
      await format.waitFor({ state: 'visible', timeout: 30000 });
      await format.scrollIntoViewIfNeeded();
      h.check(
        'format-type label visible',
        await format.isVisible(),
        'lib-document-viewer .format-type',
      );
      const text = (await format.innerText()).trim();
      h.check('format label is non-empty', text.length > 0, `reads "${text}"`);
      await h.shot('format-type-row', {
        highlight: 'lib-document-viewer .format-row',
        label: 'Additional formats row',
      });
    },
  },
  {
    act: 3,
    title: 'Measure contrast on the format-type label',
    intent: 'WCAG 2.1 SC 1.4.3 AA requires 4.5:1 for 11px body text',
    criterion: 'AC-1',
    hold: 2000,
    spotlight: { selector: 'lib-document-viewer .format-type', label: 'Format type label' },
    async run(page, h) {
      const viewTab = page.getByRole('tab', { name: /view|preview/i }).first();
      if (await viewTab.isVisible().catch(() => false)) {
        await viewTab.click({ timeout: 15000 }).catch(() => {});
      }
      await h.expectVisible('format-type label', 'lib-document-viewer .format-type');
      const result = await contrastRatioFor(page, 'lib-document-viewer .format-type');
      h.check(
        'contrast ratio is measurable',
        result.ok === true,
        result.reason ?? `fg ${result.fg} on ${result.bg}`,
      );
      if (result.ok) {
        h.check(
          'format-type meets WCAG AA 4.5:1',
          result.ratio >= 4.5,
          `${result.ratio.toFixed(2)}:1 for "${result.text}"`,
        );
      }
      await h.expectNoConsoleErrors('view tab', [
        /automation\/AI\./,
        '/nuxeo/logout',
        '/agentic-ui-config/bootstrap.json',
        '/agentic-ui-config/manifest.json',
      ]);
      await h.shot('format-type-contrast', {
        highlight: 'lib-document-viewer .format-type',
        label: 'Format type label',
      });
    },
  },
];
