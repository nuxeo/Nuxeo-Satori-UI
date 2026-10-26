import { inject, type EnvironmentProviders } from '@angular/core';

import {
  EXTENSION_SLOTS,
  provideSatoriExtensions,
  type NavItemDescriptor,
  type SatoriExtensionContributions,
} from '@nuxeo/satori-platform/extensions';

import { AcmeRulesService } from './rules.service';

/**
 * Every ID this library registers.
 *
 * Exported and asserted by the spec, so the list cannot drift from what is
 * actually registered. IDs are a **public contract**: once a manifest references
 * one, renaming it is a breaking change. The `acme.` prefix keeps them
 * from ever colliding with the platform's `app.` IDs.
 */
export const ACME_EXTENSIONS_EXTENSION_IDS = Object.freeze({
  navbar: ['acme.navbar.acmeExtensions'],
  rules: [
    'acme.rules.canUseAcme',
    'acme.rules.isLegalTeam',
    // satori:ids:rules — `nx g ...:extension-rule` inserts here. Keep the marker.
  ],
  actions: [
    'acme.actions.acmeExtensionsExport',
    'acme.actions.exportClaim',
    // satori:ids:actions — `nx g ...:extension-action` inserts here. Keep the marker.
  ],
  components: [
    'acme.panel.acmeExtensions',
    'acme.panel.policySummary',
    // satori:ids:components — `nx g ...:extension-component` inserts here. Keep the marker.
  ],
} as const);

/**
 * Navigation contributed by this library.
 *
 * A typed `const` rather than an inline literal inside `slots`, and that matters:
 * `slots` is typed `Record<ExtensionSlotId, readonly ExtensionElement[]>`, and
 * `ExtensionElement` carries only `id`, `disabled` and `order`. An inline literal
 * is a *fresh* object literal, so TypeScript applies excess property checking and
 * rejects `label`, `path` and `icon` with TS2418. Assigning an already-typed
 * `readonly NavItemDescriptor[]` is fine, because it is not fresh.
 */
const NAV_ITEMS: readonly NavItemDescriptor[] = [
  {
    id: ACME_EXTENSIONS_EXTENSION_IDS.navbar[0],
    label: 'AcmeExtensions',
    path: '/acme-extensions',
    icon: 'build',
    // Spaced by ten so a manifest can insert between entries without restating
    // the list. Absent `order` sorts after any ordinary number, stably.
    order: 500,
    rule: ACME_EXTENSIONS_EXTENSION_IDS.rules[0],
  },
];

/**
 * Contribute this library's slots, rules, actions and components.
 *
 * Add to an application's `providers`. Nothing here runs until then — a Layer 2
 * library is inert until an application opts in, which is what keeps installing
 * one from changing behaviour by surprise.
 *
 * The **factory form** is used because the rule needs `inject()`. A rule that
 * only reads its argument can use the plain-object form:
 * `provideSatoriExtensions({ rules: { ... } })`.
 */
export function provideAcmeExtensions(): EnvironmentProviders {
  return provideSatoriExtensions((): SatoriExtensionContributions => {
    // Runs inside an injection context, so contributions may depend on services.
    const rules = inject(AcmeRulesService);

    return {
      slots: {
        [EXTENSION_SLOTS.navbar]: NAV_ITEMS,
      },

      rules: {
        [ACME_EXTENSIONS_EXTENSION_IDS.rules[0]]: (context) => rules.canUse(context),
        'acme.rules.isLegalTeam': (context) => rules.isLegalTeam(context),
        // satori:register:rules
      },

      /**
       * Deny when unregistered rather than permit.
       *
       * An unknown rule ID normally evaluates to `true`, deliberately, so a
       * manifest typo cannot silently strip working actions out of the UI. That
       * default is wrong for a rule gating a surface, because the unsafe window is
       * exactly the one before registration completes.
       *
       * This is **not** a security control. Nuxeo evaluates the real permission
       * server-side on every operation; hiding a control does not protect it.
       */
      failClosedRules: [...ACME_EXTENSIONS_EXTENSION_IDS.rules],

      components: {
        // Behind a dynamic import, so the chunk is only fetched if a manifest
        // actually places the panel somewhere.
        [ACME_EXTENSIONS_EXTENSION_IDS.components[0]]: () =>
          import('./panel/acme-panel').then((m) => m.AcmePanelComponent),
        'acme.panel.policySummary': () =>
          import('./policy-summary/policy-summary').then((m) => m.PolicySummaryComponent),
        // satori:register:components
      },

      actions: {
        [ACME_EXTENSIONS_EXTENSION_IDS.actions[0]]: {
          execute: (context) => rules.exportSummary(context),
        },
        'acme.actions.exportClaim': {
          execute: (context) => rules.exportClaim(context),
        },
        // satori:register:actions
      },
    };
  });
}
