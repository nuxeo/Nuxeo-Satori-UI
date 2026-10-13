/**
 * NXSAT-544 / IBM 2834597055 — document detail details-panel toggle keyboard focus indicator.
 * Source-level IBM `style_focus_visible` contract (standalone `:focus` selector). Runtime
 * contrast and geometry: `apps/nuxeo-ui/.../panel-toggle-focus-ring.spec.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('DocumentDetailComponent — panel toggle focus ring (NXSAT-544)', () => {
  const scssPath = join(import.meta.dirname, 'document-detail-panel-toggle-focus.scss');
  const templatePath = join(import.meta.dirname, 'document-detail.html');
  const componentPath = join(import.meta.dirname, 'document-detail.ts');

  it('wires panel-toggle-btn on the production details panel toggle control', () => {
    const html = readFileSync(templatePath, 'utf8');
    const clickIdx = html.indexOf('(click)="propertiesPanelOpen.set(!propertiesPanelOpen())"');
    expect(clickIdx, 'panel toggle click handler').toBeGreaterThan(-1);
    const tagStart = html.lastIndexOf('<button', clickIdx);
    expect(tagStart, 'panel toggle must be a button').toBeGreaterThan(-1);
    const tagEnd = html.indexOf('>', clickIdx);
    expect(tagEnd, 'panel toggle opening tag must close').toBeGreaterThan(clickIdx);
    const openingTag = html.slice(tagStart, tagEnd + 1);
    expect(openingTag).toContain('class="panel-toggle-btn"');
    expect(openingTag).toContain('mat-icon-button');
    expect(openingTag).toContain('[attr.aria-label]="detailsPanelToggleLabelKey() | translate"');
  });

  it('declares a standalone :focus ring on the details panel toggle control', () => {
    const scss = readFileSync(scssPath, 'utf8');
    expect(scss).toMatch(/\.panel-toggle-btn\.mat-mdc-icon-button:focus\s*\{/);
    expect(scss).not.toMatch(/\.panel-toggle-btn\.mat-mdc-icon-button:focus,\s/);
    expect(scss).toMatch(
      /\.panel-toggle-btn\.mat-mdc-icon-button:focus[\s\S]*outline-color:\s*var\(--agentic-document-detail-panel-toggle-focus-outline\)/,
    );
  });

  it('loads panel-toggle focus styles through DocumentDetailComponent styleUrls', () => {
    const source = readFileSync(componentPath, 'utf8');
    expect(source).toMatch(/styleUrls:\s*\[/);
    expect(source).toMatch(/['"]\.\/document-detail-panel-toggle-focus\.scss['"]/);
  });
});
