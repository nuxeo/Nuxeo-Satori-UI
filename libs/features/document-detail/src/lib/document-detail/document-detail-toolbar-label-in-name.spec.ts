/**
 * NXSAT-528 / IBM 2301747460 — header toolbar icon buttons must not expose Material icon
 * ligature text as visible labelling that conflicts with the accessible name (WCAG 2.5.3
 * label-in-name). Same pattern as Content Lake ingest (NXENG-793) and dashboard FAB.
 *
 * The page renders its toolbar through `nxs-document-toolbar`, so the markup contract is that
 * component's template; its spec asserts the rendered names.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const templatePath = join(here, 'document-detail.html');
const toolbarTemplatePath = join(
  here,
  '../../../../../shared/satori-components/src/lib/document-toolbar/document-toolbar.component.html',
);

function inlineLoopMarkup(html: string): string {
  const start = html.indexOf('@for (action of inline()');
  expect(start, 'inline actions @for block').toBeGreaterThan(-1);
  const end = html.indexOf('@if (overflow().length > 0)', start);
  expect(end, 'end of inline actions @for block').toBeGreaterThan(start);
  return html.slice(start, end);
}

function moreButtonMarkup(html: string): string {
  const triggerIndex = html.indexOf('[matMenuTriggerFor]="moreMenu"');
  expect(triggerIndex, 'More actions menu trigger').toBeGreaterThan(-1);
  const openIndex = html.lastIndexOf('<button', triggerIndex);
  const closeIndex = html.indexOf('</button>', triggerIndex);
  return html.slice(openIndex, closeIndex + '</button>'.length);
}

describe('Document detail toolbar label in name (NXSAT-528)', () => {
  it('renders the header toolbar through nxs-document-toolbar with the translated entries', () => {
    const html = readFileSync(templatePath, 'utf8');
    const open = html.indexOf('<nxs-document-toolbar');
    expect(open, 'nxs-document-toolbar in the page').toBeGreaterThan(-1);
    const tag = html.slice(open, html.indexOf('>', open) + 1);
    expect(tag).toContain('class="header-actions"');
    expect(tag).toContain('[actions]="toolbarEntries()"');
    expect(tag).toContain('(selected)="runToolbarEntry($event)"');
  });

  it('names toolbar icon buttons via cdk-visually-hidden text and hides icon ligatures', () => {
    const loop = inlineLoopMarkup(readFileSync(toolbarTemplatePath, 'utf8'));
    expect(loop).toMatch(/\[matTooltip\]="tooltipOf\(action\)"/);
    expect(loop).not.toMatch(/\[attr\.aria-label\]/);
    expect(loop).toMatch(/cdk-visually-hidden[\s\S]*nameOf\(action\)/);
    expect(loop).toMatch(/<mat-icon\s+aria-hidden="true">\{\{\s*action\.icon\s*\}\}<\/mat-icon>/);
  });

  it('names the More actions menu trigger without a conflicting icon ligature', () => {
    const moreBlock = moreButtonMarkup(readFileSync(toolbarTemplatePath, 'utf8'));
    expect(moreBlock).toMatch(/cdk-visually-hidden/);
    expect(moreBlock).toContain('satori-components.document-toolbar.more-actions');
    expect(moreBlock).not.toMatch(/\[attr\.aria-label\]/);
    expect(moreBlock).toMatch(/<mat-icon\s+aria-hidden="true">more_vert<\/mat-icon>/);
  });

  it('passes the page’s own More actions wording to the toolbar', () => {
    const html = readFileSync(templatePath, 'utf8');
    const open = html.indexOf('<nxs-document-toolbar');
    const tag = html.slice(open, html.indexOf('>', open) + 1);
    expect(tag).toContain(
      `[moreLabel]="'document-detail.document-detail.more-actions' | translate"`,
    );
  });

  it('keeps data-action-id on toolbar buttons for IBM scan selectors (e.g. app.toolbar.addToCollection)', () => {
    const loop = inlineLoopMarkup(readFileSync(toolbarTemplatePath, 'utf8'));
    expect(loop).toContain('[attr.data-action-id]="action.id"');
  });
});
