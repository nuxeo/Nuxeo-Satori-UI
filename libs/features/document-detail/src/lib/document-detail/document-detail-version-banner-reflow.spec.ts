/**
 * NXSAT-332 — the version banner reflows at 320 CSS pixels (WCAG 2.1 SC 1.4.10).
 *
 * Since the migration to SatBanner, reflow is handled internally by the Satori component.
 * This spec now verifies the hook classes survive on the sat-banner elements (specs and
 * Playwright selectors depend on them) and that the styleUrls entry is still present.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('DocumentDetailComponent — version banner (NXSAT-332)', () => {
  const template = readFileSync(join(import.meta.dirname, 'document-detail.html'), 'utf8');

  it('preserves .version-banner, .version-banner-latest, .version-banner-restore as hook classes', () => {
    expect(template).toContain('class="version-banner"');
    expect(template).toContain('class="version-banner-latest"');
    expect(template).toContain('class="version-banner-restore"');
  });

  it('renders the version banner as a sat-banner', () => {
    expect(template).toMatch(/sat-banner[^>]*class="version-banner"/);
  });

  it('loads the banner styles through DocumentDetailComponent styleUrls', () => {
    const source = readFileSync(join(import.meta.dirname, 'document-detail.ts'), 'utf8');
    expect(source).toMatch(/['"]\.\/document-detail-version-banner\.scss['"]/);
  });
});
