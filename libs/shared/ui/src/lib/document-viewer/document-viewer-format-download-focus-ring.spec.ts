/**
 * NXENG-781 / NXENG-786 / NXENG-800 / NXSAT-505 — additional-format download icon buttons
 * (e.g. Download Thumbnail / Download Small, IBM 1635062655 / 368748540) must show a keyboard
 * focus indicator (IBM `style_focus_visible`, WCAG 2.4.7). Material suppresses the default ring.
 *
 * Computed focus visibility and per-theme contrast: `apps/nuxeo-ui/.../document-viewer-format-download-focus-ring.spec.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('DocumentViewerComponent — format download focus ring (NXENG-781 / NXENG-786 / NXENG-800 / NXSAT-505)', () => {
  const scss = readFileSync(join(import.meta.dirname, 'document-viewer.component.scss'), 'utf8');

  it('declares a light-strip focus token and routes the ring through it', () => {
    expect(scss).toMatch(/--document-viewer-focus-on-light-surface:\s*#[0-9a-f]{6}/i);
    expect(scss).toMatch(
      /\.format-download-btn\.mat-mdc-icon-button:focus[\s\S]*var\(--document-viewer-focus-on-light-surface\)/,
    );
    expect(scss).not.toMatch(
      /\.format-download-btn\.mat-mdc-icon-button:focus[\s\S]*--mat-sys-primary/,
    );
  });

  it('declares standalone :focus and :focus-visible rings on .format-download-btn.mat-mdc-icon-button', () => {
    expect(scss).toMatch(/\.format-download-btn\.mat-mdc-icon-button:focus-visible\s*\{/);
    expect(scss).toMatch(/\.format-download-btn\.mat-mdc-icon-button:focus\s*\{/);
    expect(scss).not.toMatch(/\.format-download-btn\.mat-mdc-icon-button:focus,\s/);
    expect(scss).not.toMatch(/\.format-download-btn\.mat-mdc-icon-button:focus-visible,\s/);
    expect(scss).toMatch(
      /\.format-download-btn\.mat-mdc-icon-button:focus[\s\S]*outline:\s*2px\s+solid/,
    );
    expect(scss).toMatch(
      /\.format-download-btn\.mat-mdc-icon-button:focus[\s\S]*outline-offset:\s*2px/,
    );
    expect(scss).toMatch(/NXSAT-505/);
  });
});
