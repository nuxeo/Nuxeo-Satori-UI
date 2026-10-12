/**
 * NXENG-806 / NXENG-825 / NXSAT-494 — SCSS contract for `.format-size` on the fixed light picture-cards strip
 * (IBM Issue IDs 626137632, 1088600166, 1406866183 / NXENG-837; was hardcoded #999 ~2.85:1).
 *
 * Per-theme contrast regression cross-check:
 * `apps/nuxeo-ui/.../document-viewer-format-type-contrast.spec.ts`. Published WCAG 2.1 AA
 * conformance: `npm run beta:evidence -- phase-6-a11y` (docs/accessibility.md).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Rule blocks whose selector prelude includes `.className` (compound/pseudo included). */
function scssBlocks(source: string, className: string): { prelude: string; body: string }[] {
  const re = new RegExp(`([^{}]*\\.${className}\\b[^{]*)\\{([^}]+)\\}`, 'gs');
  return [...source.matchAll(re)].map((match) => ({
    prelude: match[1].trim(),
    body: match[2],
  }));
}

const WCAG_AA_NORMAL_TEXT = 4.5;

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

function relativeLuminance([r, g, b]: readonly number[]): number {
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: readonly number[], b: readonly number[]): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('DocumentViewerComponent — format-size SCSS contract (NXENG-806, NXENG-825, NXSAT-494)', () => {
  it('scssBlocks catches compound and pseudo-class .format-size selectors', () => {
    const sample = [
      '.format-size { color: var(--document-viewer-muted-on-light-surface); }',
      '.picture-cards .format-size { color: var(--document-viewer-muted-on-light-surface); }',
      '.format-size.regressed { color: #999; }',
    ].join('\n');
    const blocks = scssBlocks(sample, 'format-size');
    expect(blocks).toHaveLength(3);
    expect(blocks.some(({ body }) => /#999/i.test(body))).toBe(true);
  });

  it('pins every .format-size block to the light-strip muted token per NXENG-806 / NXENG-825 / NXSAT-494', () => {
    const scssPath = join(import.meta.dirname, 'document-viewer.component.scss');
    const scss = readFileSync(scssPath, 'utf8');
    const sizeBlocks = scssBlocks(scss, 'format-size');
    expect(sizeBlocks.length, '.format-size declarations in SCSS').toBeGreaterThan(0);
    for (const { body } of sizeBlocks) {
      expect(body).toMatch(/var\(--document-viewer-muted-on-light-surface\)/);
      expect(body).not.toMatch(/#999/i);
    }
  });

  it('documents IBM 1406866183: legacy #999 on white fails AA; host muted token passes', () => {
    const white: [number, number, number] = [255, 255, 255];
    const legacy = parseHex('#999999');
    const muted = parseHex('#5c5f6b');
    expect(legacy).not.toBeNull();
    expect(muted).not.toBeNull();
    if (!legacy || !muted) return;
    expect(contrastRatio(legacy, white)).toBeCloseTo(2.85, 1);
    expect(contrastRatio(muted, white)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
  });
});
