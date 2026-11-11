/**
 * NXSAT-491 / IBM 1365203900 — source-level IBM `style_focus_visible` contract for the Content
 * Lake ingest header icon button. Runtime geometry lives in
 * `apps/nuxeo-ui/.../content-lake-ingest-focus-ring.spec.ts`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const scssPath = join(dirname(fileURLToPath(import.meta.url)), 'document-detail.scss');
const globalFocusPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../../apps/nuxeo-ui/src/app/document-detail/document-detail-header-toolbar-focus.scss',
);

describe('Document detail Content Lake ingest focus ring (NXSAT-491)', () => {
  it('declares header focus token on .detail-header', () => {
    const scss = readFileSync(scssPath, 'utf8');
    expect(scss).toMatch(/--agentic-document-detail-header-focus-outline:\s*#3f51b5/);
  });

  it('covers Content Lake ingest via the global header toolbar mat-icon-button :focus ring', () => {
    const scss = readFileSync(globalFocusPath, 'utf8');
    expect(scss).toMatch(/NXSAT-491/);
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
