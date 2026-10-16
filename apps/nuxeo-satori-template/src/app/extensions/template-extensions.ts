import { inject, type EnvironmentProviders } from '@angular/core';

import {
  EXTENSION_SLOTS,
  provideSatoriExtensions,
  type NavItemDescriptor,
  type SatoriExtensionContributions,
} from '@nuxeo/satori-platform/extensions';

import { TemplateSessionService } from '../template-session.service';

/**
 * Everything this template contributes in **code** — Layer 2.
 *
 * This file is the one a fork edits first, and it exercises all five kinds of
 * contribution deliberately, so that a customer copying it has a worked example
 * of each rather than a shape they have to infer:
 *
 * | Contribution      | Demonstrated by                                              |
 * | ----------------- | ------------------------------------------------------------ |
 * | `slots`           | two navbar entries, one of them rule-gated                    |
 * | `rules`           | `template.rules.isSignedIn`, closing over a service           |
 * | `failClosedRules` | the same rule, so an unregistered build denies rather than permits |
 * | `components`      | a lazily-loaded panel addressable by id from the manifest      |
 * | `actions`         | a handler the manifest can place in any slot                   |
 *
 * The **factory form** is used rather than a plain object because the rule needs
 * `inject()`. That is not a contrived example: two of the product's own rules
 * read `AuthService` and all six of its bulk handlers close over an
 * `Injector`, so a real customer hits this on the first non-trivial rule.
 */
/**
 * Declared as a typed `const` rather than inline in `slots`, and that is load
 * bearing rather than stylistic.
 *
 * `SatoriExtensionContributions.slots` is typed `Record<ExtensionSlotId, readonly
 * ExtensionElement[]>`, and `ExtensionElement` carries only `id`, `disabled` and
 * `order` — the fields the registry itself honours for every slot. Writing these
 * objects inline makes them *fresh literals*, so TypeScript applies excess
 * property checking and rejects `label`, `path` and `icon` with TS2418.
 *
 * Assigning an already-typed `readonly NavItemDescriptor[]` is fine, because
 * `NavItemDescriptor extends ExtensionElement` and the check does not apply to a
 * non-fresh value. So: give every slot's descriptors their real type, then
 * reference them. That is also how a customer discovers which fields a slot
 * expects, instead of guessing.
 */
const NAV_ITEMS: readonly NavItemDescriptor[] = [
  {
    // The customer's own document browser, reading the real repository. Gated on
    // the session for the same reason as `reports`: with no credential every
    // request 401s, and offering a link that can only fail is worse than hiding it.
    id: 'template.navbar.documents',
    label: 'Documents',
    path: '/documents',
    icon: 'folder',
    order: 10,
    rule: 'template.rules.isSignedIn',
  },
  {
    id: 'template.navbar.search',
    label: 'Search',
    path: '/search',
    icon: 'search',
    order: 20,
    rule: 'template.rules.isSignedIn',
  },
  {
    // The ECM surface. Rule-gated like the other repository-backed pages: with no credential
    // every request 401s, and offering a link that can only fail is worse than hiding it.
    id: 'template.navbar.caseFile',
    label: 'Case File',
    path: '/case-file',
    icon: 'folder_special',
    order: 15,
    rule: 'template.rules.isSignedIn',
  },
  {
    id: 'template.navbar.components',
    label: 'UI Components',
    path: '/components',
    icon: 'widgets',
    order: 25,
  },
  {
    id: 'template.navbar.stats',
    label: 'Statistics',
    path: '/stats',
    icon: 'bar_chart',
    order: 22,
  },
  {
    id: 'template.navbar.home',
    label: 'Diagnostics',
    path: '/home',
    icon: 'home',
    order: 30,
  },
  {
    id: 'template.navbar.reports',
    label: 'Reports',
    path: '/reports',
    icon: 'assessment',
    order: 40,
    // Gated in code. A manifest can still hide it outright, reorder it or
    // relabel it without this file changing.
    rule: 'template.rules.isSignedIn',
  },
];

export function provideTemplateExtensions(): EnvironmentProviders {
  return provideSatoriExtensions((): SatoriExtensionContributions => {
    // Runs inside an injection context, so a contribution may depend on services.
    const session = inject(TemplateSessionService);

    return {
      slots: {
        [EXTENSION_SLOTS.navbar]: NAV_ITEMS,
      },

      rules: {
        'template.rules.isSignedIn': () => session.isSignedIn(),
      },

      // Without this, an unregistered `template.rules.isSignedIn` would evaluate
      // to `true` — the deliberate fail-open default that stops a manifest typo
      // stripping working actions out of the UI. Wrong for a rule that gates a
      // surface, so it is declared fail-closed. Note this is a UI affordance, not
      // an authorisation boundary: Nuxeo still evaluates the real permission.
      failClosedRules: ['template.rules.isSignedIn'],

      components: {
        // Addressable by id from the manifest, and behind a dynamic import so the
        // chunk is only fetched if something actually places it.
        'template.sidebar.reports': () =>
          import('../pages/reports/reports-panel').then((m) => m.ReportsPanelComponent),
      },

      actions: {
        // `execute` receives the rule context — the focused document, the
        // selection, the current url, the signed-in user.
        'template.actions.exportSummary': {
          execute: (context) => {
            // `warn`, not `info`: this is a placeholder a fork replaces, so
            // "not implemented" is genuinely a warning — and it is the level the
            // workspace lint rule allows, so the template stays warning-clean.
            console.warn('[template] exportSummary is not implemented yet', {
              url: context.url,
              selectionCount: context.selectionCount,
            });
          },
        },
      },
    };
  });
}
