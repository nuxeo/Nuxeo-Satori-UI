/**
 * NXENG-793 / IBM 326007366 — Content Lake ingest icon button must expose the same words in
 * matTooltip and the accessible name (WCAG 2.5.3 label-in-name). IBM counts mat-icon ligature
 * text as visible labelling when it is not aria-hidden.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const templatePath = join(dirname(fileURLToPath(import.meta.url)), 'document-detail.html');

const INGEST_KEY = 'document-detail.document-detail.ingest-to-content-lake';

function contentLakeIngestButtonMarkup(html: string): string {
  const classNeedle = 'class="content-lake-ingest-btn"';
  const classIndex = html.indexOf(classNeedle);
  expect(classIndex, 'Content Lake ingest button class').toBeGreaterThan(-1);

  const openIndex = html.lastIndexOf('<button', classIndex);
  expect(openIndex, 'Content Lake ingest button opening tag').toBeGreaterThan(-1);

  const closeIndex = html.indexOf('</button>', classIndex);
  expect(closeIndex, 'Content Lake ingest button closing tag').toBeGreaterThan(-1);

  return html.slice(openIndex, closeIndex + '</button>'.length);
}

function openingTag(markup: string): string {
  const tag = markup.match(/^<button[\s\S]*?>/);
  expect(tag, 'Content Lake ingest button opening tag').toBeTruthy();
  return tag![0];
}

function visuallyHiddenAccessibleName(markup: string): string {
  const span = markup.match(
    /<span class="cdk-visually-hidden" cdkAriaLive="off">[\s\S]*?<\/span>/,
  )?.[0];
  expect(span, 'Content Lake ingest visually hidden accessible name').toBeTruthy();
  return span!;
}

describe('Document detail Content Lake ingest label in name (NXENG-793)', () => {
  it('keeps ingest tooltip text in a cdk-visually-hidden span and hides the icon ligature', () => {
    const html = readFileSync(templatePath, 'utf8');
    const ingestButton = contentLakeIngestButtonMarkup(html);
    const ingestOpeningTag = openingTag(ingestButton);

    expect(ingestOpeningTag).toContain(`[matTooltip]="'${INGEST_KEY}' | translate"`);
    expect(ingestOpeningTag).not.toContain('[attr.aria-label]');

    const hiddenName = visuallyHiddenAccessibleName(ingestButton);
    expect(hiddenName).toContain(`'${INGEST_KEY}' | translate`);
    expect(ingestButton).toContain('svgIcon="cloud_upload"');
  });
});
