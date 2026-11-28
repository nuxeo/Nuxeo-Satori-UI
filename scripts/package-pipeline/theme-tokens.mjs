/**
 * The themes a Layer 0 fragment may start from, and the colour tokens the application reads: the
 * one list the package pipeline's step 2 holds a `bootstrap.json` to (`configuration.mjs`), and
 * that `CUSTOMISING.md` and the app builder skill print for a person or an agent rebranding the app.
 *
 * A theme's `tokens` are CSS custom properties. The application writes each one whose name begins
 * with `--` on the document's root, over the compiled palette its `base` names
 * (`apps/nuxeo-ui/src/app/theme/app-theme.service.ts`, `applyTheme`), and drops a value that is
 * not a string (`libs/shared/app-config/src/lib/bootstrap-config.ts`, `readTokens`). A base it
 * does not have falls back to `nuxeo` (`resolveThemeAttribute`), and a `defaultThemeId` that names
 * no theme falls back to the first one (`resolveTheme`). Each of those is a change that does
 * nothing, with nothing said, so step 2 refuses it.
 *
 * The colour tokens are the ones the application's styles, or Satori's, read with `var()`, counted
 * on 28 November 2026 (`apps/**` and `libs/**` SCSS, and `@hylandsoftware/satori-ui`). Other
 * tokens, such as a component's own `--nxs-*`, are taken as they are: their values are not
 * colours.
 */

/** The four palettes compiled into the application, which a theme's `base` names. */
export const SHIPPED_THEMES = ['nuxeo', 'dark', 'kawaii', 'light'];

/**
 * The colour tokens a customer sets to rebrand the application, each with what it changes. Set a
 * colour and the one read on it together (`--mat-sys-primary` with `--mat-sys-on-primary`): the
 * related shades stay the base palette's.
 */
export const COLOUR_TOKENS = new Map([
  [
    '--mat-sys-primary',
    'the main colour: buttons, links and focus outlines, and the side navigation, unless --sat-platform-nav-background is set',
  ],
  ['--mat-sys-on-primary', 'text and icons on the main colour, the navigation’s labels and icons'],
  ['--mat-sys-primary-container', 'selected and tonal fills, and a link’s hover'],
  ['--mat-sys-on-primary-container', 'text on those fills'],
  ['--mat-sys-secondary-container', 'selected chips and list items'],
  ['--mat-sys-on-secondary-container', 'text on selected chips and list items'],
  ['--mat-sys-tertiary', 'the second colour, the nearest to an accent'],
  ['--mat-sys-tertiary-container', 'fills in the second colour'],
  ['--mat-sys-on-tertiary-container', 'text on those fills'],
  ['--mat-sys-surface', 'the page’s background'],
  ['--mat-sys-surface-container-lowest', 'the lightest panels'],
  ['--mat-sys-surface-container-low', 'cards and panels'],
  ['--mat-sys-surface-container', 'panels'],
  ['--mat-sys-surface-container-high', 'raised panels, menus'],
  ['--mat-sys-surface-container-highest', 'the most raised panels'],
  ['--mat-sys-on-surface', 'the main text'],
  ['--mat-sys-on-surface-variant', 'secondary text and icons'],
  ['--mat-sys-outline', 'strong borders'],
  ['--mat-sys-outline-variant', 'borders and dividers'],
  ['--mat-sys-error', 'errors and badges'],
  ['--mat-sys-on-error', 'text on an error'],
  ['--mat-sys-error-container', 'an error’s background'],
  ['--sat-sys-warning-container', 'a warning banner’s background'],
  ['--sat-sys-on-warning-container', 'a warning banner’s text'],
  ['--sat-sys-warning-icon', 'a warning banner’s icon'],
  ['--sat-platform-nav-background', 'the side navigation’s background only'],
  ['--sat-platform-nav-on-background', 'the side navigation’s labels and icons only'],
]);

/**
 * Whether `value` is a CSS colour as a token's value is written: a hex colour of 3, 4, 6 or 8
 * digits, `rgb()`, `rgba()`, `hsl()` or `hsla()`, or `var(--…)`, another token. Anything else the
 * browser drops, and the palette's colour stays.
 */
export function isColour(value) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  return (
    /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(text) ||
    /^(?:rgba?|hsla?)\(\s*[-0-9.%a-z\s,/]+\)$/i.test(text) ||
    /^var\(\s*--[A-Za-z0-9_-]+\s*(?:,[^;{}]*)?\)$/.test(text)
  );
}
