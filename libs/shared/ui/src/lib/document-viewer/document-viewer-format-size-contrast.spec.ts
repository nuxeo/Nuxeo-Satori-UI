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

function hostBlock(source: string): string {
  return source.match(/:host\s*\{[^}]+\}/s)?.[0] ?? '';
}

function stripScssComments(block: string): string {
  return block.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function hostCustomProperty(source: string, name: string): string | null {
  const block = stripScssComments(hostBlock(source));
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = block.match(new RegExp(`(?:^|[\\s;{])--${escaped}\\s*:\\s*([^;]+);`, 'm'));
  return match?.[1]?.trim() ?? null;
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

  it('IBM 1406866183: host muted token is authored on :host and wired through .format-size', () => {
    const scssPath = join(import.meta.dirname, 'document-viewer.component.scss');
    const scss = readFileSync(scssPath, 'utf8');
    const mutedToken = hostCustomProperty(scss, 'document-viewer-muted-on-light-surface');
    expect(mutedToken).toMatch(/^#[0-9a-f]{6}$/i);
    expect(mutedToken).not.toMatch(/#999/i);
    for (const { body } of scssBlocks(scss, 'format-size')) {
      expect(body).toMatch(/var\(--document-viewer-muted-on-light-surface\)/);
    }
  });
});
