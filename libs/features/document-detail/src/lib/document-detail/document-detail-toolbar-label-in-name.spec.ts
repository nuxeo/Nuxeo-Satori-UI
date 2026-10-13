/**
 * NXSAT-528 / IBM 2301747460 — header toolbar icon buttons must not expose Material icon
 * ligature text as visible labelling that conflicts with the accessible name (WCAG 2.5.3
 * label-in-name). Same pattern as Content Lake ingest (NXENG-793) and dashboard FAB.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const templatePath = join(dirname(fileURLToPath(import.meta.url)), 'document-detail.html');

function toolbarActionsLoopMarkup(html: string): string {
  const start = html.indexOf('@for (action of toolbarActions()');
  expect(start, 'toolbarActions @for block').toBeGreaterThan(-1);
  const end = html.indexOf('@for (action of overflowActions()', start);
  expect(end, 'end of toolbarActions @for block').toBeGreaterThan(start);
  return html.slice(start, end);
}

describe('Document detail toolbar label in name (NXSAT-528)', () => {
  it('names extension toolbar icon buttons via cdk-visually-hidden text and hides icon ligatures', () => {
    const loop = toolbarActionsLoopMarkup(readFileSync(templatePath, 'utf8'));
    expect(loop).toMatch(/\[matTooltip\]="toolbarActionTooltip\(action\)"/);
    expect(loop).not.toMatch(/\[attr\.aria-label\]="action \| descriptorLabel"/);
    expect(loop).toMatch(/cdk-visually-hidden[\s\S]*toolbarActionLabel\(action\)/);
    expect(loop).toMatch(/<mat-icon\s+aria-hidden="true">\{\{\s*action\.icon\s*\}\}<\/mat-icon>/);
  });

  it('names the More actions menu trigger without a conflicting icon ligature', () => {
    const html = readFileSync(templatePath, 'utf8');
    const triggerIndex = html.indexOf('[matMenuTriggerFor]="moreMenu"');
    expect(triggerIndex, 'More actions menu trigger').toBeGreaterThan(-1);
    const openIndex = html.lastIndexOf('<button', triggerIndex);
    const closeIndex = html.indexOf('</button>', triggerIndex);
    const moreBlock = html.slice(openIndex, closeIndex + '</button>'.length);
    expect(moreBlock).toMatch(/cdk-visually-hidden/);
    expect(moreBlock).toContain('document-detail.document-detail.more-actions');
    expect(moreBlock).not.toMatch(/\[attr\.aria-label\]/);
    expect(moreBlock).toMatch(/<mat-icon\s+aria-hidden="true">more_vert<\/mat-icon>/);
  });

  it('uses toolbarActionTooltip for hover and toolbarActionLabel for the accessible name', () => {
    const loop = toolbarActionsLoopMarkup(readFileSync(templatePath, 'utf8'));
    expect(loop).toMatch(/toolbarActionTooltip\(action\)/);
    expect(loop).toMatch(/toolbarActionLabel\(action\)/);
    expect(loop).not.toMatch(/toolbarTooltip\(action\)\s*\?\?/);
    expect(loop).not.toMatch(/toolbarTooltip\(action\)\s*\|\|/);
  });

  it('keeps data-action-id on toolbar buttons for IBM scan selectors (e.g. app.toolbar.addToCollection)', () => {
    const loop = toolbarActionsLoopMarkup(readFileSync(templatePath, 'utf8'));
    expect(loop).toContain('[attr.data-action-id]="action.id"');
  });
});

