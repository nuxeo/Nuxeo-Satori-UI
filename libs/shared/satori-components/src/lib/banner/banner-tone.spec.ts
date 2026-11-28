/**
 * A banner's tone is drawn in that tone's own colours.
 *
 * Material 3 has no warning role, and in this design system the tertiary colours are success's:
 * `nxs-status-tag` draws its success tone with them. A warning banner drawn with them read as a
 * success message, teal on mint, beside a success tag of the same colours.
 *
 * A theme gives a warning its colours through `--nxs-banner-warning-*`; the app's theme maps them
 * to Satori's warning family (`apps/nuxeo-ui/src/styles.scss`). The banner never names a Satori
 * token itself: this library's default Storybook is published, and `storybook-publication-gate`
 * fails it on any `--sat-*` token. The first fix named them here, and every pull request's
 * `storybook` check failed on it.
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

  it('names no Satori token, so its published Storybook stays free of Satori', () => {
    const declarations = scss.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(declarations).not.toMatch(/--sat-/);
  });

  it("draws a warning in the theme's warning colours", () => {
    const warning = block(":host([data-tone='warning'])");
    expect(warning).toMatch(/background:\s*var\(--nxs-banner-warning-background\b/);
    expect(warning).toMatch(/color:\s*var\(--nxs-banner-warning-foreground\b/);
    expect(block(":host([data-tone='warning']) .nxs-banner__icon")).toMatch(
      /color:\s*var\(--nxs-banner-warning-icon\b/,
    );
  });

  it("never draws a warning in the tertiary colours, which are success's", () => {
    expect(block(":host([data-tone='warning'])")).not.toMatch(/tertiary/);
    expect(block(":host([data-tone='warning']) .nxs-banner__icon")).not.toMatch(/tertiary/);
  });

  it('falls back to the neutral banner, not to another tone, where a theme sets no warning colours', () => {
    const warning = block(":host([data-tone='warning'])");
    expect(warning).toMatch(
      /--nxs-banner-warning-background,\s*var\(--mat-sys-surface-container-high\)/,
    );
    expect(warning).toMatch(/--nxs-banner-warning-foreground,\s*var\(--mat-sys-on-surface\)/);
    expect(block(":host([data-tone='warning']) .nxs-banner__icon")).toMatch(
      /--nxs-banner-warning-icon,\s*currentColor\)/,
    );
  });

  it('keeps an error in the error colours', () => {
    const error = block(":host([data-tone='error'])");
    expect(error).toMatch(/background:\s*var\(--mat-sys-error-container\)/);
    expect(error).toMatch(/color:\s*var\(--mat-sys-on-error-container\)/);
  });

  it("draws a success in the tertiary colours, which are success's, as a success tag is", () => {
    const success = block(":host([data-tone='success'])");
    expect(success).toMatch(/background:\s*var\(--mat-sys-tertiary-container\)/);
    expect(success).toMatch(/color:\s*var\(--mat-sys-on-tertiary-container\)/);
  });
});
