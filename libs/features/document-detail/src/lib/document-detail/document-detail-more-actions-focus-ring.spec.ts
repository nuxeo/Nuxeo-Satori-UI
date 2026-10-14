/**
 * NXSAT-535 / IBM 2589851771 — document detail header "More actions" keyboard focus indicator.
 * Source-level IBM `style_focus_visible` contract (production template + global toolbar ring).
 * The trigger is `nxs-document-toolbar`'s, which the page renders as `.header-actions`.
 * Computed outline geometry: `apps/nuxeo-ui/.../more-actions-focus-ring.spec.ts`.
 * Live-route focus visibility: `a11y/specs/journey.a11y.spec.ts` journey screen
 * `document-detail-more-actions` (NXSAT-535; Add to collection remains on `document-detail` for NXENG-808).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('DocumentDetailComponent — header More actions focus ring (NXSAT-535)', () => {
  const templatePath = join(import.meta.dirname, 'document-detail.html');
  const toolbarTemplatePath = join(
    import.meta.dirname,
    '../../../../../shared/satori-components/src/lib/document-toolbar/document-toolbar.component.html',
  );
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
    const toolbarIdx = headerBlock!.indexOf('<nxs-document-toolbar');
    expect(toolbarIdx, 'header toolbar').toBeGreaterThan(-1);
    const toolbarTag = headerBlock!.slice(toolbarIdx, headerBlock!.indexOf('>', toolbarIdx) + 1);
    expect(toolbarTag, 'the toolbar is the header-actions region').toContain(
      'class="header-actions"',
    );

    const toolbar = readFileSync(toolbarTemplatePath, 'utf8');
    const menuIdx = toolbar.indexOf('[matMenuTriggerFor]="moreMenu"');
    expect(menuIdx, 'header overflow menu trigger').toBeGreaterThan(-1);
    const tagStart = toolbar.lastIndexOf('<button', menuIdx);
    expect(tagStart, 'More actions must live on a button opening tag').toBeGreaterThan(-1);
    const tagEnd = toolbar.indexOf('>', menuIdx);
    expect(tagEnd, 'More actions button opening tag must close').toBeGreaterThan(menuIdx);
    const openingTag = toolbar.slice(tagStart, tagEnd + 1);
    expect(openingTag).toContain('mat-icon-button');
    expect(openingTag).not.toMatch(/\[attr\.aria-label\]/);
    const button = toolbar.slice(tagStart, toolbar.indexOf('</button>', tagEnd) + 9);
    expect(button).toMatch(
      /cdk-visually-hidden[\s\S]*satori-components\.document-toolbar\.more-actions/,
    );
    expect(button).toContain('<mat-icon aria-hidden="true">more_vert</mat-icon>');
  });

  it('keeps the Karma host More actions trigger aligned with production markup', () => {
    const host = readFileSync(karmaHostPath, 'utf8');
    expect(host).toContain('class="detail-header');
    expect(host).toMatch(/<nxs-document-toolbar[^>]*class="header-actions"/);
    expect(host).not.toContain('aria-label="More actions"');
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
