/**
 * NXENG-774 / NXENG-782 / NXENG-804 / NXENG-813 / NXENG-829 / NXENG-852 / NXENG-911 / NXENG-924 — the info-row labels (State, Version, …) of `nxs-properties-panel` must meet WCAG 2.1 SC 1.4.3
 * (IBM 280073873, IBM 1224611475, IBM 542201046, IBM 787384272, IBM 1741130194, IBM 3376112021, IBM 3883422420). Per-theme Karma coverage:
 * `apps/nuxeo-ui/src/app/document-detail/doc-info-label-contrast.spec.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const WCAG_AA_NORMAL_TEXT = 4.5;

function scssBlock(source: string, className: string): string {
  const match = source.match(new RegExp(`\\.${className}\\s*\\{[^}]+\\}`, 's'));
  return match?.[0] ?? '';
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    Number.parseInt(h.slice(0, 2), 16),
    Number.parseInt(h.slice(2, 4), 16),
    Number.parseInt(h.slice(4, 6), 16),
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

describe('DocumentDetailComponent — info-row label text contrast (NXENG-774 / NXENG-782 / NXENG-804 / NXENG-813 / NXENG-829 / NXENG-852 / NXENG-911 / NXENG-924)', () => {
  it('pins the properties panel labels to the light properties-panel host tokens', () => {
    const scssPath = join(import.meta.dirname, 'document-detail.scss');
    const scss = readFileSync(scssPath, 'utf8');
    const hostBlock = scss.match(/:host\s*\{[^}]+\}/s)?.[0] ?? '';
    const properties = scssBlock(scss, 'detail-properties');
    const panel = scssBlock(scss, 'properties-panel');
    expect(hostBlock).toMatch(/--document-detail-properties-panel-surface:\s*#fff/i);
    expect(hostBlock).toMatch(/--document-detail-properties-label-muted:\s*#5c5f6b/i);
    expect(properties).toMatch(
      /--nxs-properties-panel-label:\s*var\(--document-detail-properties-label-muted\)/,
    );
    expect(properties).not.toMatch(/#888/i);
    expect(properties).not.toMatch(/var\(--mat-sys-on-surface-variant/i);
    expect(panel).toMatch(
      /--nxs-details-panel-surface:\s*var\(--document-detail-properties-panel-surface\)/,
    );
    expect(panel).not.toMatch(/var\(--mat-sys-surface/i);
  });

  it('the properties panel colours its info-row labels with that token', () => {
    const library = readFileSync(
      join(
        import.meta.dirname,
        '../../../../../shared/satori-components/src/lib/properties-panel/properties-panel.component.scss',
      ),
      'utf8',
    );
    expect(scssBlock(library, 'nxs-properties-panel__label')).toMatch(
      /color:\s*var\(--nxs-properties-panel-label\)/,
    );
  });

  it(`fallback #5c5f6b on white meets ${WCAG_AA_NORMAL_TEXT}:1`, () => {
    const fg = parseHex('#5c5f6b');
    const bg = parseHex('#ffffff');
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
  });

  it('legacy #888 on white fails WCAG AA (documents the reported defect)', () => {
    const fg = parseHex('#888888');
    const bg = parseHex('#ffffff');
    const ratio = contrastRatio(fg, bg);
    expect(ratio).toBeLessThan(WCAG_AA_NORMAL_TEXT);
    expect(ratio).toBeCloseTo(3.54, 1);
  });
});
