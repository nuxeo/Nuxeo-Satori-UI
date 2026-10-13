/**
 * NXSAT-332 — the version banner reflows at 320 CSS pixels (WCAG 2.1 SC 1.4.10).
 *
 * Source-level: jsdom has no layout. Measured in Chromium at a 320 px viewport before the
 * wrap was added, both actions' labels were clipped (`scrollWidth > clientWidth`) as the
 * banner squeezed them onto one line; with it, they move to lines of their own.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('DocumentDetailComponent — version banner reflow (NXSAT-332)', () => {
  const scss = readFileSync(
    join(import.meta.dirname, 'document-detail-version-banner.scss'),
    'utf8',
  );

  function block(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return scss.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
  }

  it('lets the banner wrap rather than squeeze its actions', () => {
    expect(block('.version-banner')).toMatch(/flex-wrap:\s*wrap/);
    expect(block('.version-banner-text')).toMatch(/flex:\s*1\s+1\s+\S+/);
  });

  it('keeps each action whole instead of shrinking it', () => {
    expect(block('.version-banner-restore')).toMatch(/flex-shrink:\s*0/);
    expect(scss).toMatch(
      /\.version-banner-latest,\s*\.version-banner-restore\s*\{[^}]*flex-shrink:\s*0/,
    );
  });

  it('loads the banner styles through DocumentDetailComponent styleUrls', () => {
    const source = readFileSync(join(import.meta.dirname, 'document-detail.ts'), 'utf8');
    expect(source).toMatch(/['"]\.\/document-detail-version-banner\.scss['"]/);
  });
});
