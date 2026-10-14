/**
 * NXSAT-538 / IBM 2615333894 — Remove main file footer icon must not expose tooltip or ligature
 * text that competes with the accessible name (WCAG 2.5.3 label-in-name).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const templatePath = join(
  dirname(fileURLToPath(import.meta.url)),
  'document-viewer.component.html',
);

const REMOVE_KEY = 'shared-ui.document-viewer.remove-main-file';

function removeMainFileButtonMarkup(html: string): string {
  const needle = `'${REMOVE_KEY}' | translate`;
  const tooltipIndex = html.indexOf(`[matTooltip]="${needle}"`);
  expect(tooltipIndex, 'Remove main file button matTooltip').toBeGreaterThan(-1);

  const openIndex = html.lastIndexOf('<button', tooltipIndex);
  expect(openIndex, 'Remove main file button opening tag').toBeGreaterThan(-1);

  const closeIndex = html.indexOf('</button>', tooltipIndex);
  expect(closeIndex, 'Remove main file button closing tag').toBeGreaterThan(-1);

  return html.slice(openIndex, closeIndex + '</button>'.length);
}

describe('Document viewer Remove main file label in name (NXSAT-538)', () => {
  it('keeps Remove main file tooltip text in a cdk-visually-hidden span and hides the icon ligature', () => {
    const html = readFileSync(templatePath, 'utf8');
    const removeButton = removeMainFileButtonMarkup(html);
    const openingTag = removeButton.match(/^<button[\s\S]*?>/)?.[0] ?? '';

    expect(openingTag).toContain(`[matTooltip]="'${REMOVE_KEY}' | translate"`);
    expect(openingTag).not.toContain('[attr.aria-label]');
    expect(removeButton).toContain('class="footer-remove-btn"');

    const hiddenName = removeButton.match(
      /<span class="cdk-visually-hidden" cdkAriaLive="off">[\s\S]*?<\/span>/,
    )?.[0];
    expect(hiddenName, 'Remove main file visually hidden accessible name').toBeTruthy();
    expect(hiddenName).toContain(`'${REMOVE_KEY}' | translate`);
    expect(removeButton).toContain('<mat-icon aria-hidden="true">cancel</mat-icon>');
  });
});
