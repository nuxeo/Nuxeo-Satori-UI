/**
 * NXSAT-496 — footer icon buttons (Preview, Download, …) must show a keyboard focus indicator
 * on the fixed light `.viewer-footer` strip (IBM `style_focus_visible` / 1425495611, WCAG 2.4.7).
 *
 * Runtime focus visibility and per-theme contrast:
 * `apps/nuxeo-ui/.../document-viewer-footer-focus-ring.spec.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('DocumentViewerComponent — footer focus ring (NXSAT-496)', () => {
  const scss = readFileSync(join(import.meta.dirname, 'document-viewer.component.scss'), 'utf8');

  function footerIconButtonFocusRule(): string {
    const rule = scss.match(
      /\.viewer-footer-actions button\.mat-mdc-icon-button:focus\s*\{[^}]+\}/,
    )?.[0];
    expect(rule).toBeTruthy();
    return rule!;
  }

  it('routes the footer ring through the light-strip focus token', () => {
    const rule = footerIconButtonFocusRule();
    expect(rule).toMatch(/var\(--document-viewer-focus-on-light-surface\)/);
    expect(rule).not.toMatch(/--mat-sys-primary/);
  });

  it('declares a standalone :focus ring on .viewer-footer-actions button.mat-mdc-icon-button', () => {
    expect(scss).toMatch(/\.viewer-footer-actions button\.mat-mdc-icon-button:focus\s*\{/);
    // Comma lists are not resolved by the IBM scanner — reject both `:focus, …` and `…, :focus`.
    expect(scss).not.toMatch(/\.viewer-footer-actions button\.mat-mdc-icon-button:focus,\s/);
    expect(scss).not.toMatch(/,\s*\.viewer-footer-actions button\.mat-mdc-icon-button:focus\s*\{/);
    const rule = footerIconButtonFocusRule();
    expect(rule).toMatch(/outline:\s*2px\s+solid/);
    expect(rule).toMatch(/outline-offset:\s*2px/);
  });
});
