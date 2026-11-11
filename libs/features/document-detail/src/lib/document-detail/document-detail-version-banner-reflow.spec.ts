/**
 * NXSAT-332 — the version banner reflows at 320 CSS pixels (WCAG 2.1 SC 1.4.10).
 *
 * The reflow rules live on the banner's own stylesheet, which `banner-reflow.spec.ts` checks in
 * `nxs-banner`. This spec checks that the page keeps the hook classes specs and Playwright
 * selectors depend on, and that the banner is rendered by its ID with `nxs-banner` as the fallback.
 * The hook classes are now the buttons' `cssClass`, set in the component, not in the template.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('DocumentDetailComponent — version banner (NXSAT-332)', () => {
  const template = readFileSync(join(import.meta.dirname, 'document-detail.html'), 'utf8');
  const source = readFileSync(join(import.meta.dirname, 'document-detail.ts'), 'utf8');

  it('preserves .version-banner, .version-banner-latest, .version-banner-restore as hook classes', () => {
    expect(template).toContain('class="version-banner"');
    expect(source).toContain("cssClass: 'version-banner-latest'");
    expect(source).toContain("cssClass: 'version-banner-restore'");
  });

  it('renders the version banner through its ID, with nxs-banner as the fallback', () => {
    expect(template).toMatch(
      /<div class="version-banner">\s*<lib-extension-outlet[^>]*\[componentId\]="bannerId"[\s\S]*?<nxs-banner/,
    );
  });

  it('loads the banner styles through DocumentDetailComponent styleUrls', () => {
    expect(source).toMatch(/['"]\.\/document-detail-version-banner\.scss['"]/);
  });
});
