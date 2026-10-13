/**
 * NXSAT-540 / IBM 2646145795 — inline tag combobox input must have an associated label
 * (IBM Equal Access `input_label_exists`, WCAG AA).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));
const templatePath = join(dir, 'document-detail.html');

describe('Document detail tag combobox label (NXSAT-540)', () => {
  it('associates the tag chip input with the visible Tags field label via aria-labelledby', () => {
    const html = readFileSync(templatePath, 'utf8');
    const tagsBlock = html.match(/class="tags-suggestion-field"[\s\S]*?<\/mat-form-field>/)?.[0];
    expect(tagsBlock, 'tags suggestion field markup').toBeTruthy();

    expect(html).toContain('id="document-detail-inline-tags-label"');

    const tagInput = tagsBlock!.match(/<input[\s\S]*?name="tagInput"[\s\S]*?\/>/)?.[0];
    expect(tagInput, 'inline tag chip input').toBeTruthy();
    expect(tagInput).toContain('[attr.aria-labelledby]="\'document-detail-inline-tags-label\'"');
    expect(tagsBlock).not.toMatch(/<mat-chip-grid[^>]*\[attr\.aria-label\]/);
  });
});
