/**
 * NXENG-812 / NXSAT-493 / NXSAT-507 — SCSS contract for `.info-label` on the fixed light
 * `.picture-cards` strip (IBM 716638997, IBM 1390196018, IBM 1668870227; was #777 ~4.48:1).
 *
 * Per-theme token wiring cross-check:
 * `apps/nuxeo-ui/.../document-viewer-info-label-contrast.spec.ts`. Published WCAG 2.1 AA
 * conformance for colour contrast: `npm run beta:evidence -- phase-6-a11y` (docs/accessibility.md).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function scssBlock(source: string, className: string): string {
  const match = source.match(new RegExp(`\\.${className}\\s*\\{[^}]+\\}`, 's'));
  return match?.[0] ?? '';
}

describe('DocumentViewerComponent — info-label SCSS contract (NXENG-812 / NXSAT-493 / NXSAT-507)', () => {
  it('pins .info-label to the light-strip muted token per NXENG-812 / NXSAT-493 / NXSAT-507', () => {
    const scssPath = join(import.meta.dirname, 'document-viewer.component.scss');
    const scss = readFileSync(scssPath, 'utf8');
    const label = scssBlock(scss, 'info-label');
    expect(label.length).toBeGreaterThan(0);
    expect(label).toMatch(/NXSAT-493/);
    expect(label).toMatch(/NXSAT-507/);
    expect(label).toMatch(/1390196018/);
    expect(label).toMatch(/1668870227/);
    expect(label).toMatch(/var\(--document-viewer-muted-on-light-surface\)/);
    expect(label).not.toMatch(/color:\s*#777/i);
    expect(label).not.toMatch(/var\(--mat-sys-on-surface-variant/i);
  });
});
