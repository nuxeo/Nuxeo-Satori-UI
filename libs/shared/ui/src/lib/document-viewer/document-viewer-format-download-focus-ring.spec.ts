/**
 * NXENG-781 / NXENG-786 / NXENG-800 / NXSAT-505 / NXSAT-527 — additional-format download icon
 * buttons (e.g. Download Thumbnail / Download OriginalJpeg, IBM 1635062655 / 2294099067) must show
 * a keyboard focus indicator (IBM `style_focus_visible`, WCAG 2.4.7). Material suppresses the default ring.
 *
 * Computed focus visibility and per-theme contrast: `apps/nuxeo-ui/.../document-viewer-format-download-focus-ring.spec.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('DocumentViewerComponent — format download focus ring (NXENG-781 / NXENG-786 / NXENG-800 / NXSAT-505 / NXSAT-527)', () => {
  const scss = readFileSync(join(import.meta.dirname, 'document-viewer.component.scss'), 'utf8');

  function formatDownloadBtnFocusRule(): string {
    const rule = scss.match(/\.format-download-btn\.mat-mdc-icon-button:focus\s*\{[^}]+\}/)?.[0];
    expect(rule).toBeTruthy();
    return rule!;
  }

  /** Comment block immediately above the `:focus` rule (ticket / IBM traceability). */
  function formatDownloadBtnFocusRuleTraceComment(): string {
    const selector = '.format-download-btn.mat-mdc-icon-button:focus';
    const selectorIndex = scss.indexOf(selector);
    expect(selectorIndex).toBeGreaterThan(-1);
    const lines = scss.slice(0, selectorIndex).split(/\r?\n/);
    const commentLines: string[] = [];
    for (let i = lines.length - 1; i >= 0; i--) {
      const trimmed = lines[i].trim();
      if (trimmed === '') {
        if (commentLines.length > 0) {
          break;
        }
        continue;
      }
      if (trimmed.startsWith('//')) {
        commentLines.unshift(lines[i]);
        continue;
      }
      break;
    }
    expect(commentLines.length).toBeGreaterThan(0);
    return commentLines.join('\n');
  }

  it('declares a light-strip focus token and routes the ring through it', () => {
    expect(scss).toMatch(/--document-viewer-focus-on-light-surface:\s*#[0-9a-f]{6}/i);
    const focusRule = formatDownloadBtnFocusRule();
    expect(focusRule).toMatch(/var\(--document-viewer-focus-on-light-surface\)/);
    expect(focusRule).not.toMatch(/--mat-sys-primary/);
  });

  it('declares a standalone :focus ring on .format-download-btn.mat-mdc-icon-button (IBM style_focus_visible)', () => {
    expect(scss).toMatch(/\.format-download-btn\.mat-mdc-icon-button:focus\s*\{/);
    // Comma lists are not resolved by the IBM scanner — reject both `:focus, …` and `…, :focus`.
    expect(scss).not.toMatch(/\.format-download-btn\.mat-mdc-icon-button:focus,\s/);
    expect(scss).not.toMatch(/,\s*\.format-download-btn\.mat-mdc-icon-button:focus\s*\{/);

    const focusRule = formatDownloadBtnFocusRule();
    expect(focusRule).toMatch(/outline:\s*2px\s+solid/);
    expect(focusRule).toMatch(/outline-offset:\s*2px/);

    const traceComment = formatDownloadBtnFocusRuleTraceComment();
    expect(traceComment).toMatch(/NXSAT-505/);
    expect(traceComment).toMatch(/NXSAT-527/);
    expect(traceComment).toMatch(/2294099067/);
  });
});
