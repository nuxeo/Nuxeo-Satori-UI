/**
 * NXSAT-332 — a banner reflows at 320 CSS pixels (WCAG 2.1 SC 1.4.10). Ported from the version
 * banner's stylesheet, which this component replaces.
 *
 * Source-level: jsdom has no layout. Measured in Chromium at a 320 px viewport before the wrap was
 * added, both actions' labels were clipped (`scrollWidth > clientWidth`) as the banner squeezed them
 * onto one line; with it, they move to lines of their own.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('NxsBannerComponent — reflow (NXSAT-332)', () => {
  const scss = readFileSync(join(import.meta.dirname, 'banner.component.scss'), 'utf8');

  function block(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return scss.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
  }

  it('lets the banner wrap rather than squeeze its actions', () => {
    expect(block(':host')).toMatch(/flex-wrap:\s*wrap/);
    expect(block('.nxs-banner__message')).toMatch(/flex:\s*1\s+1\s+\S+/);
  });

  it('caps the actions group at the banner width so its buttons can wrap', () => {
    expect(block('.nxs-banner__actions')).toMatch(/max-width:\s*100%/);
  });

  it('keeps the actions whole instead of shrinking them', () => {
    expect(block('.nxs-banner__actions')).toMatch(/flex-shrink:\s*0/);
    expect(block('.nxs-banner__actions')).toMatch(/flex-wrap:\s*wrap/);
  });
});
