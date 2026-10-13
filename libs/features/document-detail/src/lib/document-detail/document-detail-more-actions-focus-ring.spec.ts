/**
 * NXSAT-535 / IBM 2589851771 — source-level IBM `style_focus_visible` contract for the document
 * detail header "More actions" mat-icon-button. Runtime geometry lives in
 * `apps/nuxeo-ui/.../more-actions-focus-ring.spec.ts`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const globalFocusPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../../apps/nuxeo-ui/src/app/document-detail/document-detail-header-toolbar-focus.scss',
);

describe('Document detail More actions focus ring (NXSAT-535)', () => {
  it('traces the More actions control to IBM 2589851771 in the global header toolbar focus ring', () => {
    const scss = readFileSync(globalFocusPath, 'utf8');
    expect(scss).toMatch(/NXSAT-535/);
    expect(scss).toMatch(/2589851771/);
    expect(scss).toMatch(/\.detail-header \.header-actions button\.mat-mdc-icon-button:focus\s*\{/);
    expect(scss).not.toMatch(
      /\.detail-header \.header-actions button\.mat-mdc-icon-button:focus,\s/,
    );
    const focusBlock =
      scss.match(
        /\.detail-header \.header-actions button\.mat-mdc-icon-button:focus\s*\{([^}]*)\}/,
      )?.[1] ?? '';
    expect(focusBlock).toMatch(
      /outline:\s*2px\s+solid\s+var\(--agentic-document-detail-header-focus-outline\)/,
    );
  });
});
