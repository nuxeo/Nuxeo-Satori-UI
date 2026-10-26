/** NXENG-930 — Preview tab `.format-type` label WCAG 1.4.3 AA contrast (IBM 4250318785). */

export const summary = 'Document detail Preview tab format-type label meets WCAG AA text contrast';

const DOC_UID = process.env['NUXEO_DOC_UID']?.trim();

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
      await h.shot('doc-detail-preview', {
        highlight: 'lib-document-viewer',
        label: 'Preview viewer',
      });
    },
  },
  {
    act: 2,
    title: 'Measure contrast on the format-type label',
    intent: 'WCAG 2.1 SC 1.4.3 AA requires 4.5:1 for 11px body text',
    criterion: 'AC-1',
    hold: 2500,
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
      await h.shot('format-type-contrast', {
        highlight: 'lib-document-viewer .format-type',
        label: 'Format type label',
      });
    },
  },
  {
    act: 3,
    title: 'Confirm preview tab layout after the contrast fix',
    intent: 'Smoke check that the viewer footer still renders on document detail',
    criterion: 'AC-3',
    async run(page, h) {
      await h.expectVisible('viewer footer still present', 'lib-document-viewer .viewer-footer');
      const url = page.url();
      h.check('still on document detail route', /#\/doc\//.test(url), url);
      await h.shot('viewer-footer-intact', {
        highlight: 'lib-document-viewer .viewer-footer',
        label: 'Viewer footer',
      });
      await h.expectNoConsoleErrors('document detail preview', [
        /automation\/AI\./,
        '/nuxeo/logout',
        '/agentic-ui-config/bootstrap.json',
        '/agentic-ui-config/manifest.json',
      ]);
    },
  },
];
