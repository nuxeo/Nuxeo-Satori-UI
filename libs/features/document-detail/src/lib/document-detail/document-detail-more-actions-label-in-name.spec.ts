/**
 * NXSAT-539 / IBM 2618099297 — header More actions must not expose the more_vert ligature as
 * visible label text while aria-label names "More actions" (WCAG 2.5.3 label-in-name).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const templatePath = join(dirname(fileURLToPath(import.meta.url)), 'document-detail.html');

const MORE_ACTIONS_KEY = 'document-detail.document-detail.more-actions';

function headerMoreActionsButtonMarkup(html: string): string {
  const needle = '[matMenuTriggerFor]="moreMenu"';
  const index = html.indexOf(needle);
  expect(index, 'header More actions menu trigger').toBeGreaterThan(-1);

  const openIndex = html.lastIndexOf('<button', index);
  expect(openIndex, 'More actions button opening tag').toBeGreaterThan(-1);

  const closeIndex = html.indexOf('</button>', index);
  expect(closeIndex, 'More actions button closing tag').toBeGreaterThan(-1);

  return html.slice(openIndex, closeIndex + '</button>'.length);
}

function openingTag(markup: string): string {
  const tag = markup.match(/^<button[\s\S]*?>/);
  expect(tag, 'More actions button opening tag').toBeTruthy();
  return tag![0];
}

function visuallyHiddenAccessibleName(markup: string): string {
  const span = markup.match(
    /<span class="cdk-visually-hidden" cdkAriaLive="off">[\s\S]*?<\/span>/,
  )?.[0];
  expect(span, 'More actions visually hidden accessible name').toBeTruthy();
  return span!;
}

describe('Document detail header More actions label in name (NXSAT-539)', () => {
  it('keeps More actions tooltip text in a cdk-visually-hidden span and hides the icon ligature', () => {
    const html = readFileSync(templatePath, 'utf8');
    const moreButton = headerMoreActionsButtonMarkup(html);
    const moreOpeningTag = openingTag(moreButton);

    expect(moreOpeningTag).toContain(`[matTooltip]="'${MORE_ACTIONS_KEY}' | translate"`);
    expect(moreOpeningTag).not.toContain('[attr.aria-label]');

    const hiddenName = visuallyHiddenAccessibleName(moreButton);
    expect(hiddenName).toContain(`'${MORE_ACTIONS_KEY}' | translate`);
    expect(moreButton).toContain('<mat-icon aria-hidden="true">more_vert</mat-icon>');
  });
});
