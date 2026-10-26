/**
 * NXSAT-488 / IBM 1235130066 — document detail tab keyboard focus indicator. The tabs are
 * `nxs-tabs`; the library draws the ring in `--nxs-tabs-focus-outline` and the page pins that
 * token to the indigo that holds on its fixed white tab header. Runtime contrast:
 * `apps/nuxeo-ui/.../detail-tab-focus-ring.spec.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const LIBRARY_SCSS = join(
  import.meta.dirname,
  '../../../../../shared/satori-components/src/lib/tabs/tabs.component.scss',
);

describe('DocumentDetailComponent — detail tab focus ring (NXSAT-488)', () => {
  it('pins the tab ring token to the indigo used on the white tab header', () => {
    const host = readFileSync(join(import.meta.dirname, 'document-detail.scss'), 'utf8');
    const tabs = host.match(/\.detail-tabs\s*\{[^}]+\}/s)?.[0] ?? '';
    expect(tabs).toMatch(
      /--nxs-tabs-focus-outline:\s*var\(--agentic-document-detail-panel-toggle-focus-outline\)/,
    );
    expect(tabs).toMatch(/--nxs-tabs-header-surface:\s*#fff\b/i);
  });

  it('the tabs declare a standalone :focus ring on each tab in that token', () => {
    const library = readFileSync(LIBRARY_SCSS, 'utf8');
    expect(library).toMatch(/\.mat-mdc-tab:focus\s*\{/);
    expect(library).not.toMatch(/\.mat-mdc-tab:focus,\s/);
    const focusBlock = library.match(/\.mat-mdc-tab:focus\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(focusBlock).toMatch(/outline:\s*2px\s+solid\s+var\(--nxs-tabs-focus-outline\)/);
  });
});
