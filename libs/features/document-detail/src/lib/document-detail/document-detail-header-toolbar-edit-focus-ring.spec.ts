/**
 * NXSAT-542 / IBM 2714359167 — document detail header Edit toolbar action keyboard focus
 * indicator. Source-level IBM `style_focus_visible` contract (production template + global
 * toolbar ring). Runtime geometry: `apps/nuxeo-ui/.../toolbar-icon-focus-ring.spec.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('DocumentDetailComponent — header Edit toolbar focus ring (NXSAT-542)', () => {
  const templatePath = join(import.meta.dirname, 'document-detail.html');
  const globalFocusPath = join(
    import.meta.dirname,
    '../../../../../../apps/nuxeo-ui/src/app/document-detail/document-detail-header-toolbar-focus.scss',
  );
  const karmaHostPath = join(
    import.meta.dirname,
    '../../../../../../apps/nuxeo-ui/src/app/document-detail/toolbar-icon-focus-ring.spec.html',
  );

  function toolbarActionsLoopMarkup(html: string): string {
    const start = html.indexOf('@for (action of toolbarActions()');
    expect(start, 'toolbarActions @for block').toBeGreaterThan(-1);
    let end = html.indexOf('@for (action of overflowActions()', start);
    if (end === -1) {
      end = html.indexOf('[matMenuTriggerFor]="moreMenu"', start);
    }
    expect(end, 'end of toolbarActions @for block').toBeGreaterThan(start);
    return html.slice(start, end);
  }

  function headerActionsMarkup(headerBlock: string): string {
    const open = headerBlock.indexOf('<div class="header-actions">');
    expect(open, 'header-actions opening tag').toBeGreaterThan(-1);
    let depth = 0;
    for (let i = open; i < headerBlock.length; i++) {
      if (headerBlock.startsWith('<div', i)) {
        depth++;
      }
      if (headerBlock.startsWith('</div>', i)) {
        depth--;
        if (depth === 0) {
          return headerBlock.slice(open, i + 6);
        }
      }
    }
    throw new Error('header-actions closing </div> not found');
  }

  it('wires extension toolbar icon buttons inside .header-actions on the production header', () => {
    const header = readFileSync(templatePath, 'utf8');
    const headerBlock = header.match(/class="detail-header"[\s\S]*?<div class="detail-body">/)?.[0];
    expect(headerBlock, 'detail header markup').toBeTruthy();
    const actionsBlock = headerActionsMarkup(headerBlock!);
    const loopStart = actionsBlock.indexOf('@for (action of toolbarActions()');
    expect(loopStart, 'toolbarActions @for block inside header-actions').toBeGreaterThan(-1);
    const moreIdx = actionsBlock.indexOf('[matMenuTriggerFor]="moreMenu"', loopStart);
    expect(moreIdx, 'toolbar loop before More actions trigger').toBeGreaterThan(loopStart);
    const loop = toolbarActionsLoopMarkup(actionsBlock);
    expect(loop).toContain('mat-icon-button');
    expect(loop).toContain('[attr.data-action-id]="action.id"');
    expect(loop).toMatch(/cdk-visually-hidden[\s\S]*toolbarActionLabel\(action\)/);
    expect(loop).toMatch(/<mat-icon\s+aria-hidden="true">\{\{\s*action\.icon\s*\}\}<\/mat-icon>/);
  });

  it('keeps the Karma host Edit toolbar button aligned with production markup', () => {
    const host = readFileSync(karmaHostPath, 'utf8');
    expect(host).toContain('class="header-actions"');
    expect(host).toContain('mat-icon-button');
    expect(host).toContain('data-action-id="app.toolbar.edit"');
    expect(host).not.toContain('aria-label="Edit"');
    expect(host).toMatch(/cdk-visually-hidden[\s\S]*Edit/);
    expect(host).toMatch(/<mat-icon[^>]*aria-hidden="true"[^>]*>edit<\/mat-icon>/);
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
