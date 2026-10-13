/**
 * NXSAT-526 / IBM 2190538001 — inline tag chip remove must not expose the cancel ligature as
 * visible label text competing with aria-label (WCAG 2.5.3 label-in-name).
 * Computed ::before glyph: `apps/nuxeo-ui/.../document-detail-tag-chip-remove-icon.spec.ts`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));
const templatePath = join(dir, 'document-detail.html');
const scssPath = join(dir, 'document-detail-tag-chip-remove-icon.scss');
const componentPath = join(dir, 'document-detail.ts');

describe('Document detail tag chip remove label in name (NXSAT-526)', () => {
  it('binds matChipRemove aria-label to shared.remove-tag and hides cancel ligature text', () => {
    const html = readFileSync(templatePath, 'utf8');
    const tagsBlock = html.match(/class="tags-suggestion-field"[\s\S]*?<\/mat-form-field>/)?.[0];
    expect(tagsBlock, 'tags suggestion field markup').toBeTruthy();
    const removeButton = tagsBlock!.match(/<button[\s\S]*?matChipRemove[\s\S]*?<\/button>/)?.[0];
    expect(removeButton, 'tag chip remove button').toBeTruthy();
    expect(removeButton).toContain(
      '[attr.aria-label]="\'shared.remove-tag\' | translate: { name: tag }"',
    );
    const iconMarkup = removeButton!.match(/<mat-icon[\s\S]*?<\/mat-icon>/)?.[0];
    expect(iconMarkup, 'tag chip remove mat-icon').toBeTruthy();
    expect(iconMarkup).toContain('class="detail-tag-chip-remove-icon"');
    expect(iconMarkup).toContain('aria-hidden="true"');
    expect(iconMarkup, 'ligature text must not appear as mat-icon content').not.toMatch(
      />\s*cancel\s*</,
    );
  });

  it('maps the tag chip remove icon to Material Icons cancel codepoint U+E5C9 in SCSS', () => {
    const scss = readFileSync(scssPath, 'utf8');
    expect(scss).toMatch(/mat-icon\.detail-tag-chip-remove-icon::before[\s\S]*content:\s*'\\e5c9'/);
  });

  it('loads tag chip remove icon styles through DocumentDetailComponent styleUrls', () => {
    const source = readFileSync(componentPath, 'utf8');
    expect(source).toMatch(/['"]\.\/document-detail-tag-chip-remove-icon\.scss['"]/);
  });
});
