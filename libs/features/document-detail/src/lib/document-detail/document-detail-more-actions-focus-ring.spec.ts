/**
 * NXSAT-535 / IBM 2589851771 — document detail header "More actions" keyboard focus indicator.
 * Source-level IBM `style_focus_visible` contract (production template + global toolbar ring).
 * Runtime geometry: `apps/nuxeo-ui/.../more-actions-focus-ring.spec.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('DocumentDetailComponent — header More actions focus ring (NXSAT-535)', () => {
  const templatePath = join(import.meta.dirname, 'document-detail.html');
  const globalFocusPath = join(
    import.meta.dirname,
    '../../../../../../apps/nuxeo-ui/src/app/document-detail/document-detail-header-toolbar-focus.scss',
  );
  const karmaHostPath = join(
    import.meta.dirname,
    '../../../../../../apps/nuxeo-ui/src/app/document-detail/more-actions-focus-ring.spec.html',
  );

  it('wires mat-icon-button More actions inside .header-actions on the production header', () => {
    const html = readFileSync(templatePath, 'utf8');
    const headerBlock = html.match(/class="detail-header"[\s\S]*?<div class="detail-body">/)?.[0];
    expect(headerBlock, 'detail header markup').toBeTruthy();
    const menuIdx = headerBlock!.indexOf('[matMenuTriggerFor]="moreMenu"');
    expect(menuIdx, 'header overflow menu trigger').toBeGreaterThan(-1);
    const tagStart = headerBlock!.lastIndexOf('<button', menuIdx);
    expect(tagStart, 'More actions must live on a button opening tag').toBeGreaterThan(-1);
    const tagEnd = headerBlock!.indexOf('>', menuIdx);
    expect(tagEnd, 'More actions button opening tag must close').toBeGreaterThan(menuIdx);
    const openingTag = headerBlock!.slice(tagStart, tagEnd + 1);
    expect(openingTag).toContain('mat-icon-button');
    expect(openingTag).toContain(
      '[attr.aria-label]="\'document-detail.document-detail.more-actions\' | translate"',
    );
    const actionsStart = headerBlock!.indexOf('class="header-actions"');
    expect(actionsStart, 'header-actions region').toBeGreaterThan(-1);
    expect(actionsStart).toBeLessThan(tagStart);
  });

  it('keeps the Karma host More actions trigger aligned with production markup', () => {
    const host = readFileSync(karmaHostPath, 'utf8');
    expect(host).toContain('class="header-actions"');
    expect(host).toContain('mat-icon-button');
    expect(host).toContain('[matMenuTriggerFor]="moreMenu"');
    expect(host).toContain('aria-label="More actions"');
    expect(host).toContain('more_vert');
  });

  it('traces NXSAT-535 / IBM 2589851771 on the global header toolbar mat-icon-button :focus ring', () => {
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
