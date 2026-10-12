/**
 * NXSAT-516 / IBM 1808686844 — document detail header Go back keyboard focus indicator.
 * Source-level IBM `style_focus_visible` contract (standalone `:focus` selector). Runtime
 * geometry and token wiring: `apps/nuxeo-ui/.../go-back-focus-ring.spec.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('DocumentDetailComponent — header Go back focus ring (NXSAT-516)', () => {
  const scssPath = join(import.meta.dirname, 'document-detail-go-back-focus.scss');
  const templatePath = join(import.meta.dirname, 'document-detail.html');
  const componentPath = join(import.meta.dirname, 'document-detail.ts');

  it('wires detail-header-go-back-btn on the production header Go back control', () => {
    const html = readFileSync(templatePath, 'utf8');
    const headerBlock = html.match(/class="detail-header"[\s\S]*?<div class="header-info">/)?.[0];
    expect(headerBlock, 'detail header markup').toBeTruthy();
    const clickIdx = headerBlock!.indexOf('(click)="goBack()"');
    expect(clickIdx, 'header Go back click handler').toBeGreaterThan(-1);
    const tagStart = headerBlock!.lastIndexOf('<button', clickIdx);
    expect(tagStart, 'goBack must live on a button opening tag').toBeGreaterThan(-1);
    const tagEnd = headerBlock!.indexOf('>', clickIdx);
    expect(tagEnd, 'Go back button opening tag must close').toBeGreaterThan(clickIdx);
    const openingTag = headerBlock!.slice(tagStart, tagEnd + 1);
    expect(openingTag).toContain('class="detail-header-go-back-btn"');
    expect(openingTag).toContain('mat-icon-button');
    expect(openingTag).toContain(
      '[attr.aria-label]="\'document-detail.document-detail.go-back\' | translate"',
    );
  });

  it('declares a standalone :focus ring on the header Go back control', () => {
    const scss = readFileSync(scssPath, 'utf8');
    expect(scss).toMatch(/\.detail-header-go-back-btn\.mat-mdc-icon-button:focus\s*\{/);
    expect(scss).not.toMatch(/\.detail-header-go-back-btn\.mat-mdc-icon-button:focus,\s/);
    expect(scss).toMatch(
      /\.detail-header-go-back-btn\.mat-mdc-icon-button:focus[\s\S]*outline:\s*2px\s+solid\s+var\(--agentic-document-detail-header-focus-outline\)/,
    );
  });

  it('loads go-back focus styles through DocumentDetailComponent styleUrls', () => {
    const source = readFileSync(componentPath, 'utf8');
    expect(source).toMatch(/styleUrls:\s*\[/);
    expect(source).toMatch(/['"]\.\/document-detail-go-back-focus\.scss['"]/);
  });
});
