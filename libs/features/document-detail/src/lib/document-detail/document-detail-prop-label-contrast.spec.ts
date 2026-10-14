/**
 * NXENG-858 / NXENG-891 / NXENG-895 — the field labels of `nxs-properties-panel` on the fixed light properties panel must meet WCAG 2.1 SC 1.4.3
 * (IBM 1792790291, 2951482449, 2993932592). Per-theme computed contrast is covered in
 * `apps/nuxeo-ui/.../prop-label-contrast.spec.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const WCAG_AA_NORMAL_TEXT = 4.5;

function scssBlock(source: string, className: string): string {
  const match = source.match(new RegExp(`\\.${className}\\s*\\{[^}]+\\}`, 's'));
  return match?.[0] ?? '';
}

function hostBlock(source: string): string {
  return source.match(/:host\s*\{[^}]+\}/s)?.[0] ?? '';
}

/** Drop SCSS comments so commented-out custom properties cannot satisfy lookups. */
function stripScssComments(block: string): string {
  return block.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function hostCustomProperty(source: string, name: string): string | null {
  const block = stripScssComments(hostBlock(source));
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = block.match(new RegExp(`(?:^|[\\s;{])--${escaped}\\s*:\\s*([^;]+);`, 'm'));
  return match?.[1]?.trim() ?? null;
}

function parseHex(css: string): [number, number, number] | null {
  const m = css.match(/#([0-9a-f]{6})\b/i);
  if (!m) return null;
  const hex = m[1];
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

function luminance([r, g, b]: readonly number[]): number {
  const s = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
}

function contrastRatio(fg: readonly number[], bg: readonly number[]): number {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('DocumentDetailComponent — prop-label text contrast (NXENG-858, NXENG-891, NXENG-895)', () => {
  const scssPath = join(import.meta.dirname, 'document-detail.scss');
  const scss = readFileSync(scssPath, 'utf8');
  const labelBlock = stripScssComments(scssBlock(scss, 'detail-properties'));
  const panelBlock = stripScssComments(scssBlock(scss, 'properties-panel'));
  const library = readFileSync(
    join(
      import.meta.dirname,
      '../../../../../shared/satori-components/src/lib/properties-panel/properties-panel.component.scss',
    ),
    'utf8',
  );

  it('selector rule assertions ignore commented-out declarations', () => {
    const brokenLabel = `.prop-label {
  /* color: var(--document-detail-properties-label-muted); */
  color: #888;
}`;
    const brokenPanel = `.properties-panel {
  /* background: var(--document-detail-properties-panel-surface); */
  background: var(--mat-sys-surface);
}`;
    const label = stripScssComments(brokenLabel);
    const panel = stripScssComments(brokenPanel);
    expect(label).not.toMatch(/var\(--document-detail-properties-label-muted\)/);
    expect(label).toMatch(/color:\s*#888/i);
    expect(panel).not.toMatch(/var\(--document-detail-properties-panel-surface\)/);
    expect(panel).toMatch(/var\(--mat-sys-surface/i);
  });

  it('reads host custom properties from live declarations only (ignores commented-out lines)', () => {
    const fixture = `:host {
  /* --document-detail-properties-label-muted: #888888; */
  --document-detail-properties-label-muted: #5c5f6b;
  --document-detail-properties-panel-surface: #ffffff;
}`;
    expect(hostCustomProperty(fixture, 'document-detail-properties-label-muted')).toBe('#5c5f6b');
    expect(hostCustomProperty(fixture, 'document-detail-properties-panel-surface')).toBe('#ffffff');
  });

  it('themes property labels through the light-panel host token, not global surface-variant', () => {
    expect(labelBlock).toMatch(
      /--nxs-properties-panel-label:\s*var\(--document-detail-properties-label-muted\)/,
    );
    expect(labelBlock).not.toMatch(/#888/i);
    expect(labelBlock).not.toMatch(/--mat-sys-on-surface-variant/);
    expect(hostCustomProperty(scss, 'document-detail-properties-label-muted')).toBe('#5c5f6b');
    expect(hostCustomProperty(scss, 'document-detail-properties-panel-surface')).toBe('#ffffff');
    expect(panelBlock).toMatch(
      /--nxs-details-panel-surface:\s*var\(--document-detail-properties-panel-surface\)/,
    );
    expect(panelBlock).not.toMatch(/var\(--mat-sys-surface/i);
  });

  it('the properties panel colours its field labels with that token', () => {
    expect(stripScssComments(scssBlock(library, 'nxs-properties-panel__label'))).toMatch(
      /color:\s*var\(--nxs-properties-panel-label\)/,
    );
  });

  it(`host token pair meets ${WCAG_AA_NORMAL_TEXT}:1 on the properties panel`, () => {
    const fgCss = hostCustomProperty(scss, 'document-detail-properties-label-muted');
    const bgCss = hostCustomProperty(scss, 'document-detail-properties-panel-surface');
    const fg = fgCss ? parseHex(fgCss) : null;
    const bg = bgCss ? parseHex(bgCss) : null;
    expect(fg).not.toBeNull();
    expect(bg).not.toBeNull();
    if (!fg || !bg) return;
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
  });

  it('legacy #888 on white fails WCAG AA (NXENG-891 / IBM 2951482449 reported 3.54:1)', () => {
    const fg = parseHex('#888888');
    const bg = parseHex('#ffffff');
    expect(fg).not.toBeNull();
    expect(bg).not.toBeNull();
    if (!fg || !bg) return;
    const ratio = contrastRatio(fg, bg);
    expect(ratio).toBeLessThan(WCAG_AA_NORMAL_TEXT);
    expect(ratio).toBeCloseTo(3.54, 1);
  });
});
