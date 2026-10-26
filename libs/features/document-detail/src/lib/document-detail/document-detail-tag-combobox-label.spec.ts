/**
 * NXSAT-540 / IBM 2646145795 — the tag combobox input must have an associated label
 * (IBM Equal Access `input_label_exists`, WCAG AA).
 *
 * The page's tag field is `nxs-tag-editor`, projected into the properties panel's Tags row; the
 * markup contract is that component's template, and its spec asserts the rendered names.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));
const templatePath = join(dir, 'document-detail.html');
const editorTemplatePath = join(
  dir,
  '../../../../../shared/satori-components/src/lib/tag-editor/tag-editor.component.html',
);

describe('Document detail tag combobox label (NXSAT-540)', () => {
  it('renders the tag field through nxs-tag-editor in the properties panel’s Tags row', () => {
    const html = readFileSync(templatePath, 'utf8');
    const open = html.indexOf('<nxs-tag-editor');
    expect(open, 'nxs-tag-editor in the page').toBeGreaterThan(-1);
    const tag = html.slice(open, html.indexOf('/>', open) + 2);
    expect(tag).toMatch(/\bnxsTags\b/);
  });

  it('names the chip grid and the combobox input', () => {
    const editor = readFileSync(editorTemplatePath, 'utf8');

    const chipGridOpen = editor.match(/<mat-chip-grid[\s\S]*?>/)?.[0];
    expect(chipGridOpen, 'tag chip grid opening tag').toBeTruthy();
    expect(chipGridOpen).toMatch(
      /\[attr\.aria-label\]="'satori-components\.tag-editor\.tags' \| translate"/,
    );

    const box = editor.match(/<input[\s\S]*?\[matChipInputFor\]="grid"[\s\S]*?\/>/)?.[0];
    expect(box, 'tag combobox input').toBeTruthy();
    expect(box).toMatch(/\[attr\.aria-label\]="'satori-components\.tag-editor\.add' \| translate"/);
  });

  it('keeps the combobox outside the chip grid, which may not contain one', () => {
    const editor = readFileSync(editorTemplatePath, 'utf8');
    const gridEnd = editor.indexOf('</mat-chip-grid>');
    const boxAt = editor.indexOf('[matChipInputFor]="grid"');
    expect(gridEnd).toBeGreaterThan(-1);
    expect(boxAt).toBeGreaterThan(gridEnd);
  });
});
