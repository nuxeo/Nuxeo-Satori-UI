/**
 * Accessibility-only ESLint config, used by `npm run a11y` and the A11y workflow.
 *
 * ## Why this is a separate config rather than rules added to `eslint.config.mjs`
 *
 * The eleven `@angular-eslint/template` accessibility rules are currently either absent or
 * set to `warn` in this repository:
 *
 *   - the ten library configs set only `click-events-have-key-events` and
 *     `interactive-supports-focus`, both `warn`, so neither gates anything
 *   - `apps/nuxeo-ui` and `apps/nuxeo-satori-template` have no ESLint config at all, so
 *     their 27 templates get no template rule whatsoever — their `lint` targets pass while
 *     having nothing to say about HTML
 *
 * Turning them on in the shared config would change the existing `lint` gate and make it
 * red on pre-existing violations. This config keeps the a11y verdict independent of that
 * gate, so adopting it does not require fixing the debt first.
 *
 * Scan size is **89 tracked templates**. A local run reports 90: `apps/nuxeo-ui/src/
 * diagnostic.html` is gitignored, so it is present on a developer's disk and absent on a
 * runner. The counts differ for that reason alone and neither is wrong.
 *
 * Severities are all `error` here because this config's only consumer decides what to do
 * with them; `scripts/a11y-scan.mjs` owns the pass/fail policy, not the severity.
 *
 * ## Scope, stated because it is easy to over-read
 *
 * `.html` files only. Two known gaps:
 *
 *   1. 24 components declare inline `template:` strings despite CLAUDE.md's "templateUrl
 *      always". This config does not reach them.
 *   2. None of these eleven rules catches an `attr.`-prefixed literal attribute.
 *      `attr.aria-label="…"` without binding brackets renders a DOM attribute literally
 *      named `attr.aria-label`, leaving the control with no accessible name — verified
 *      against the one instance of that in this repository, which the preset reports
 *      nothing on.
 *
 * These are static rules over template source. They cannot see rendered output, so
 * `color-contrast` and anything layout-dependent is out of reach by construction; the
 * live-server axe harness in `scripts/beta-harness/steps/phase-6-a11y.mjs` covers that.
 */
// Imported from the `angular-eslint` meta-package, which is a declared devDependency, rather
// than from `@angular-eslint/eslint-plugin-template` and `@angular-eslint/template-parser`
// directly. Those two are undeclared transitives here, so importing them worked only because
// npm happened to hoist them — the class of thing that resolves locally and fails on a runner.
import { configs, templatePlugin, templateParser } from 'angular-eslint';

export default [
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/out-tsc/**', '**/.nx/**'],
  },
  {
    files: ['**/*.html'],
    languageOptions: { parser: templateParser },
    plugins: { '@angular-eslint/template': templatePlugin },
    // The plugin's own `accessibility` preset from the top-level configs export (angular-eslint v22+).
    // Taken wholesale rather than hand-listed, so a rule added to it upstream is picked up instead
    // of silently missed. Note: in v22+, configs.templateAccessibility is an array; we spread the
    // second element which contains the accessibility rules configuration.
    ...configs.templateAccessibility[1],
  },
];
