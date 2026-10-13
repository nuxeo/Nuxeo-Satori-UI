/**
 * NXSAT-545 / IBM 2851011211 — document detail `.version-select` keyboard focus indicator.
 * Source-level IBM `style_focus_visible` contract (standalone `:focus` selector). Runtime
 * contrast and inset geometry: `apps/nuxeo-ui/.../version-select-focus-ring.spec.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('DocumentDetailComponent — version-select focus ring (NXSAT-545)', () => {
  const scssPath = join(import.meta.dirname, 'document-detail-version-select-focus.scss');
  const componentPath = join(import.meta.dirname, 'document-detail.ts');
  it('declares a standalone :focus ring on the version selector', () => {
    const scss = readFileSync(scssPath, 'utf8');
    expect(scss).toMatch(/\.version-select:focus\s*\{/);
    expect(scss).not.toMatch(/\.version-select:focus,\s/);
    expect(scss).toMatch(
      /\.version-select:focus[\s\S]*outline:\s*2px\s+solid\s+var\(--document-detail-properties-label-muted\)/,
    );
    expect(scss).toMatch(/NXSAT-545[\s\S]*2851011211/);
  });

  it('loads version-select focus styles through DocumentDetailComponent styleUrls', () => {
    const source = readFileSync(componentPath, 'utf8');
    expect(source).toMatch(/['"]\.\/document-detail-version-select-focus\.scss['"]/);
  });

  it('pins version-select fill to the light properties panel surface', () => {
    const scss = readFileSync(scssPath, 'utf8');
    expect(scss).toMatch(
      /\.version-select[\s\S]*background:\s*var\(--document-detail-properties-panel-surface\)/,
    );
  });
});
