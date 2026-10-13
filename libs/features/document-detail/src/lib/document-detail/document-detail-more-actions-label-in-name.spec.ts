/**
 * NXSAT-539 / IBM 2618099297 — header More actions must not expose the more_vert ligature as
 * visible label text that conflicts with the accessible name (WCAG 2.5.3 label-in-name).
 *
 * The trigger is `nxs-document-toolbar`'s; the page passes it its wording.
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

const MORE_ACTIONS_KEY = 'document-detail.document-detail.more-actions';
const MORE_NAME = `ownMoreLabel() || ('satori-components.document-toolbar.more-actions' | translate)`;

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

const squash = (text: string): string => text.replace(/\s+/g, ' ');

describe('Document detail header More actions label in name (NXSAT-539)', () => {
  it('keeps More actions tooltip text in a cdk-visually-hidden span and hides the icon ligature', () => {
    const moreButton = headerMoreActionsButtonMarkup(readFileSync(toolbarTemplatePath, 'utf8'));
    const moreOpeningTag = openingTag(moreButton);

    expect(squash(moreOpeningTag)).toContain(squash(`[matTooltip]=" ${MORE_NAME} "`));
    expect(moreOpeningTag).not.toContain('[attr.aria-label]');

    const hiddenName = visuallyHiddenAccessibleName(moreButton);
    expect(squash(hiddenName)).toContain(MORE_NAME);
    expect(moreButton).toContain('<mat-icon aria-hidden="true">more_vert</mat-icon>');
  });

  it('gives the trigger the page’s own translated wording', () => {
    const html = readFileSync(templatePath, 'utf8');
    const open = html.indexOf('<nxs-document-toolbar');
    const tag = html.slice(open, html.indexOf('>', open) + 1);
    expect(tag).toContain(`[moreLabel]="'${MORE_ACTIONS_KEY}' | translate"`);
  });
});
