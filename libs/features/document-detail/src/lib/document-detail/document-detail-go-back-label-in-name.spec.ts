/**
 * NXENG-826 / IBM 1125713158 — header Go back must not expose icon ligature as visible label
 * text competing with aria-label (WCAG 2.5.3 label-in-name). MatIcon adds aria-hidden by default,
 * but IBM still counts ligature text nodes as visible labelling.
 *
 * Computed ::before glyph: `apps/nuxeo-ui/.../document-detail-go-back-icon.spec.ts`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));
const templatePath = join(dir, 'document-detail.html');
const scssPath = join(dir, 'document-detail-go-back-icon.scss');
const componentPath = join(dir, 'document-detail.ts');

describe('Document detail Go back label in name (NXENG-826)', () => {
  it('renders the header back glyph without Material ligature text in the DOM', () => {
    const html = readFileSync(templatePath, 'utf8');
    const headerBlock = html.match(/class="detail-header"[\s\S]*?<div class="header-info">/)?.[0];
    expect(headerBlock, 'detail header markup').toBeTruthy();
    const backButton = headerBlock!.match(/<button[\s\S]*?mat-icon-button[\s\S]*?<\/button>/)?.[0];
    expect(backButton, 'header go back button').toBeTruthy();
    expect(backButton).toContain(
      '[attr.aria-label]="\'document-detail.document-detail.go-back\' | translate"',
    );
    const iconMarkup = backButton!.match(/<mat-icon[\s\S]*?<\/mat-icon>/)?.[0];
    expect(iconMarkup, 'header back mat-icon').toBeTruthy();
    expect(iconMarkup).toContain('class="detail-header-go-back-icon"');
    expect(iconMarkup).toContain('aria-hidden="true"');
    expect(iconMarkup, 'ligature text must not appear as mat-icon content').not.toMatch(
      />\s*arrow_back\s*</,
    );
    expect(iconMarkup).not.toContain('fontIcon=');
  });

  it('maps the header back icon to Material Icons arrow_back codepoint U+E5C4 in SCSS', () => {
    const scss = readFileSync(scssPath, 'utf8');
    expect(scss).toMatch(
      /\.detail-header mat-icon\.detail-header-go-back-icon::before[\s\S]*content:\s*'\\e5c4'/,
    );
  });

  it('loads go-back icon styles through DocumentDetailComponent styleUrls', () => {
    const source = readFileSync(componentPath, 'utf8');
    expect(source).toMatch(/styleUrls:\s*\[/);
    expect(source).toMatch(/['"]\.\/document-detail-go-back-icon\.scss['"]/);
  });
});
