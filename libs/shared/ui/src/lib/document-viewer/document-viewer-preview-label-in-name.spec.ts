/**
 * NXSAT-512 / IBM 1759794337 — Preview footer icon must not expose the visibility ligature as
 * visible label text competing with aria-label (WCAG 2.5.3 label-in-name).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const templatePath = join(
  dirname(fileURLToPath(import.meta.url)),
  'document-viewer.component.html',
);

const PREVIEW_KEY = 'shared-ui.document-viewer.preview';

function previewButtonMarkup(html: string): string {
  const needle = `'${PREVIEW_KEY}' | translate`;
  const tooltipIndex = html.indexOf(`[matTooltip]="${needle}"`);
  expect(tooltipIndex, 'Preview button matTooltip').toBeGreaterThan(-1);

  const openIndex = html.lastIndexOf('<button', tooltipIndex);
  expect(openIndex, 'Preview button opening tag').toBeGreaterThan(-1);

  const closeIndex = html.indexOf('</button>', tooltipIndex);
  expect(closeIndex, 'Preview button closing tag').toBeGreaterThan(-1);

  return html.slice(openIndex, closeIndex + '</button>'.length);
}

describe('Document viewer Preview label in name (NXSAT-512)', () => {
  it('keeps Preview tooltip text in a cdk-visually-hidden span and hides the icon ligature', () => {
    const html = readFileSync(templatePath, 'utf8');
    const previewButton = previewButtonMarkup(html);
    const openingTag = previewButton.match(/^<button[\s\S]*?>/)?.[0] ?? '';

    expect(openingTag).toContain(`[matTooltip]="'${PREVIEW_KEY}' | translate"`);
    expect(openingTag).not.toContain('[attr.aria-label]');

    const hiddenName = previewButton.match(
      /<span class="cdk-visually-hidden" cdkAriaLive="off">[\s\S]*?<\/span>/,
    )?.[0];
    expect(hiddenName, 'Preview visually hidden accessible name').toBeTruthy();
    expect(hiddenName).toContain(`'${PREVIEW_KEY}' | translate`);
    expect(previewButton).toContain('<mat-icon aria-hidden="true">visibility</mat-icon>');
  });
});
