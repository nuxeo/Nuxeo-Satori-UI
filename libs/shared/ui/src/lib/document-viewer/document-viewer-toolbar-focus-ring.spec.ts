/**
 * NXENG-799 / NXENG-816 / NXENG-817 / NXSAT-524 — image toolbar icon buttons (including Zoom
 * out) must show a keyboard focus indicator (IBM `style_focus_visible` / 922184956, 2140832667,
 * WCAG 2.4.7). Material suppresses the default
 * ring.
 *
 * Computed focus visibility and per-theme contrast:
 * `apps/nuxeo-ui/.../document-viewer-toolbar-focus-ring.spec.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('DocumentViewerComponent — image toolbar focus ring (NXENG-799 / NXENG-816 / NXENG-817)', () => {
  const scss = readFileSync(join(import.meta.dirname, 'document-viewer.component.scss'), 'utf8');

  function toolbarIconButtonFocusRule(): string {
    const rule = scss.match(/\.viewer-toolbar button\.mat-mdc-icon-button:focus\s*\{[^}]+\}/)?.[0];
    expect(rule).toBeTruthy();
    return rule!;
  }

  it('routes the toolbar ring through the light-strip focus token', () => {
    const rule = toolbarIconButtonFocusRule();
    expect(rule).toMatch(/var\(--document-viewer-focus-on-light-surface\)/);
    expect(rule).not.toMatch(/--mat-sys-primary/);
  });

  it('declares a standalone :focus ring on .viewer-toolbar button.mat-mdc-icon-button', () => {
    expect(scss).toMatch(/\.viewer-toolbar button\.mat-mdc-icon-button:focus\s*\{/);
    expect(scss).not.toMatch(/\.viewer-toolbar button\.mat-mdc-icon-button:focus,\s/);
    expect(scss).not.toMatch(/,\s*\.viewer-toolbar button\.mat-mdc-icon-button:focus\s*\{/);
    const rule = toolbarIconButtonFocusRule();
    expect(rule).toMatch(/outline:\s*2px\s+solid/);
    expect(rule).toMatch(/outline-offset:\s*2px/);
  });
});
