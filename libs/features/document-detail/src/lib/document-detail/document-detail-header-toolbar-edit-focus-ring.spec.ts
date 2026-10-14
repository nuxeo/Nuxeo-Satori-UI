/**
 * NXSAT-542 / IBM 2714359167 — document detail header Edit toolbar action keyboard focus
 * indicator. Source-level IBM `style_focus_visible` contract (production template + global
 * toolbar ring). Runtime geometry: `apps/nuxeo-ui/.../toolbar-icon-focus-ring.spec.ts`. The
 * buttons are `nxs-document-toolbar`'s, which the page renders as `.header-actions`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('DocumentDetailComponent — header Edit toolbar focus ring (NXSAT-542)', () => {
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
    '../../../../../../apps/nuxeo-ui/src/app/document-detail/toolbar-icon-focus-ring.spec.html',
  );

  function inlineLoopMarkup(html: string): string {
    const start = html.indexOf('@for (action of inline()');
    expect(start, 'inline actions @for block').toBeGreaterThan(-1);
    const end = html.indexOf('[matMenuTriggerFor]="moreMenu"', start);
    expect(end, 'end of inline actions @for block').toBeGreaterThan(start);
    return html.slice(start, end);
  }

  it('wires extension toolbar icon buttons inside .header-actions on the production header', () => {
    const header = readFileSync(templatePath, 'utf8');
    const headerBlock = header.match(/class="detail-header"[\s\S]*?<div class="detail-body">/)?.[0];
    expect(headerBlock, 'detail header markup').toBeTruthy();
    const open = headerBlock!.indexOf('<nxs-document-toolbar');
    expect(open, 'header toolbar').toBeGreaterThan(-1);
    const tag = headerBlock!.slice(open, headerBlock!.indexOf('>', open) + 1);
    expect(tag, 'the toolbar is the header-actions region').toContain('class="header-actions"');
    expect(tag).toContain('[actions]="toolbarEntries()"');

    const loop = inlineLoopMarkup(readFileSync(toolbarTemplatePath, 'utf8'));
    expect(loop).toContain('mat-icon-button');
    expect(loop).toContain('[attr.data-action-id]="action.id"');
    expect(loop).toMatch(/cdk-visually-hidden[\s\S]*nameOf\(action\)/);
    expect(loop).toMatch(/<mat-icon\s+aria-hidden="true">\{\{\s*action\.icon\s*\}\}<\/mat-icon>/);
  });

  it('keeps the Karma host Edit toolbar button aligned with production markup', () => {
    const host = readFileSync(karmaHostPath, 'utf8');
    expect(host).toContain('class="detail-header');
    expect(host).toMatch(/<nxs-document-toolbar[^>]*class="header-actions"/);
    expect(host).not.toContain('aria-label="Edit"');
  });

  it('traces NXSAT-542 / IBM 2714359167 on the global header toolbar mat-icon-button :focus ring', () => {
    const scss = readFileSync(globalFocusPath, 'utf8');
    expect(scss).toMatch(/NXSAT-542/);
    expect(scss).toMatch(/2714359167/);
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
