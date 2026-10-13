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
    const end = html.indexOf('@for (action of overflowActions()', start);
    expect(end, 'end of toolbarActions @for block').toBeGreaterThan(start);
    return html.slice(start, end);
  }

  it('wires extension toolbar icon buttons inside .header-actions on the production header', () => {
    const loop = toolbarActionsLoopMarkup(readFileSync(templatePath, 'utf8'));
    expect(loop).toContain('mat-icon-button');
    expect(loop).toContain('[attr.data-action-id]="action.id"');
    expect(loop).toMatch(/cdk-visually-hidden[\s\S]*toolbarActionLabel\(action\)/);
    expect(loop).toMatch(/<mat-icon\s+aria-hidden="true">\{\{\s*action\.icon\s*\}\}<\/mat-icon>/);
    const header = readFileSync(templatePath, 'utf8');
    const actionsStart = header.indexOf('class="header-actions"');
    const loopStart = header.indexOf('@for (action of toolbarActions()');
    expect(actionsStart, 'header-actions region').toBeGreaterThan(-1);
    expect(actionsStart).toBeLessThan(loopStart);
  });

  it('keeps the Karma host Edit toolbar button aligned with production markup', () => {
    const host = readFileSync(karmaHostPath, 'utf8');
    expect(host).toContain('class="header-actions"');
    expect(host).toContain('mat-icon-button');
    expect(host).toContain('data-action-id="app.toolbar.edit"');
    expect(host).toContain('aria-label="Edit"');
    expect(host).toMatch(/<mat-icon[^>]*>edit<\/mat-icon>/);
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
