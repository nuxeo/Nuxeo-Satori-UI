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
  const labelId = 'document-detail-inline-tags-label';
  const labelledByBinding = `[attr.aria-labelledby]="'${labelId}'"`;

  it('associates the tag chip grid and combobox input with the visible Tags label', () => {
    const html = readFileSync(templatePath, 'utf8');
    const tagsBlock = html.match(/class="tags-suggestion-field"[\s\S]*?<\/mat-form-field>/)?.[0];
    expect(tagsBlock, 'tags suggestion field markup').toBeTruthy();

    expect(html).toContain(`id="${labelId}"`);

    const chipGridOpen = tagsBlock!.match(/<mat-chip-grid[\s\S]*?>/)?.[0];
    expect(chipGridOpen, 'inline tag chip grid opening tag').toBeTruthy();
    expect(chipGridOpen).toContain(labelledByBinding);
    expect(chipGridOpen).not.toMatch(/\[attr\.aria-label\]/);

    const tagInput = tagsBlock!.match(/<input[\s\S]*?name="tagInput"[\s\S]*?\/>/)?.[0];
    expect(tagInput, 'inline tag chip input').toBeTruthy();
    expect(tagInput).toContain(labelledByBinding);
  });
});
