/**
 * NXSAT-488 / IBM 1235130066 — document detail Material tab keyboard focus indicator.
 * Source-level IBM `style_focus_visible` contract (standalone `:focus` selector). Runtime
 * contrast: `apps/nuxeo-ui/.../detail-tab-focus-ring.spec.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('DocumentDetailComponent — detail tab focus ring (NXSAT-488)', () => {
  it('declares a standalone :focus ring on Material tabs in .detail-tabs', () => {
    const scss = readFileSync(join(import.meta.dirname, 'document-detail-tab-focus.scss'), 'utf8');
    expect(scss).toMatch(/\.mat-mdc-tab:focus\s*\{/);
    expect(scss).not.toMatch(/\.mat-mdc-tab:focus,\s/);
    expect(scss).toMatch(
      /\.mat-mdc-tab:focus[\s\S]*outline:\s*2px\s+solid\s+var\(--agentic-document-detail-panel-toggle-focus-outline\)/,
    );
  });

  it('loads document-detail-tab-focus.scss on DocumentDetailComponent', () => {
    const source = readFileSync(join(import.meta.dirname, 'document-detail.ts'), 'utf8');
    expect(source).toMatch(/['"]\.\/document-detail-tab-focus\.scss['"]/);
  });
});
