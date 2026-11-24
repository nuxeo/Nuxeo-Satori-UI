/**
 * A banner's tone is drawn in that tone's own colours.
 *
 * Material 3 has no warning role, and in this design system the tertiary colours are success's:
 * `nxs-status-tag` draws its success tone with them. A warning banner drawn with them read as a
 * success message, teal on mint, beside a success tag of the same colours. Satori's theme, which
 * the app loads with its own (`apps/nuxeo-ui/src/styles.scss`), defines the warning family.
 *
 * Source-level: jsdom resolves no custom properties. Measured in Chromium on the Nuxeo theme, the
 * warning text is 5.03:1 on its background in the light scheme and 6.09:1 in the dark one.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('NxsBannerComponent — tone colours', () => {
  const scss = readFileSync(join(import.meta.dirname, 'banner.component.scss'), 'utf8');

  function block(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return scss.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
  }

  it("draws a warning in Satori's warning colours", () => {
    const warning = block(":host([data-tone='warning'])");
    expect(warning).toMatch(/background:\s*var\(--sat-sys-warning-container\b/);
    expect(warning).toMatch(/color:\s*var\(--sat-sys-on-warning-container\b/);
  });

  it("never draws a warning in the tertiary colours, which are success's", () => {
    expect(block(":host([data-tone='warning'])")).not.toMatch(/tertiary/);
    expect(block(":host([data-tone='warning']) .nxs-banner__icon")).not.toMatch(/tertiary/);
  });

  it("gives a warning's icon Satori's warning icon colour", () => {
    expect(block(":host([data-tone='warning']) .nxs-banner__icon")).toMatch(
      /color:\s*var\(--sat-sys-warning-icon\b/,
    );
  });

  it('falls back to the neutral surface, not to another tone, where the warning family is absent', () => {
    const warning = block(":host([data-tone='warning'])");
    expect(warning).toMatch(
      /--sat-sys-warning-container,\s*var\(--mat-sys-surface-container-high\)/,
    );
    expect(warning).toMatch(/--sat-sys-on-warning-container,\s*var\(--mat-sys-on-surface\)/);
  });

  it('keeps an error in the error colours', () => {
    const error = block(":host([data-tone='error'])");
    expect(error).toMatch(/background:\s*var\(--mat-sys-error-container\)/);
    expect(error).toMatch(/color:\s*var\(--mat-sys-on-error-container\)/);
  });
});
