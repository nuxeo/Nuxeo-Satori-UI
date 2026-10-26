import { InjectionToken, computed, inject, type Signal } from '@angular/core';

import { AppExtensionsService } from './app-extensions.service';
import { ExtensionRuleContextService } from './extension-rule-context.service';
import type { ExtensionRule } from './extension-rules';
import { EXTENSION_SLOTS, type ExtensionElement } from './extension-slots';

/**
 * A platform navigation entry, in a shape that owes nothing to Satori.
 *
 * The shell maps this to `SatNavigationItemWithIcon` when it renders. Keeping
 * the descriptor neutral means a customer's manifest and a customer's extension
 * library are written against our vocabulary, not against the nav component we
 * happen to use this quarter.
 */
export interface NavItemDescriptor extends ExtensionElement {
  /**
   * The entry's text, as a literal.
   *
   * Still required, still a literal, and still what a manifest's
   * `overrides[id].label` replaces. Nothing about this field changed when `labelKey` arrived,
   * which is the point: it is documented in `docs/extension-reference.md` with worked examples
   * a customer has copied, and reinterpreting it as a translation key would have turned every
   * one of those literals into a lookup that misses.
   *
   * When `labelKey` is present this is the **fallback**, used only if the key does not resolve.
   */
  readonly label: string;
  /**
   * A translation key for the entry's text, preferred over `label` when it resolves.
   *
   * ## Why a second field rather than treating `label` as a key
   *
   * `label` is published API — it is on eight interfaces in `docs/api/platform.api.md` and
   * documented as customer-settable. A customer writing `"label": "Repository"` expects that
   * string on screen. Piping it would make it a catalogue lookup that survives only by
   * ngx-translate's key passthrough, and a label containing a dot — `"v2.0 Archive"` — would
   * attempt a *nested* lookup and could resolve to something else entirely.
   *
   * So the packaged entries carry both: `labelKey` for translation, `label` for the English
   * text and for any consumer that has not been taught the key. A customer who only knows
   * about `label` keeps working unchanged.
   *
   * ## Which mechanism a customer should reach for
   *
   * | Want | Use | Scope |
   * | --- | --- | --- |
   * | One label, every language | `overrides[id].label` | Wins outright; bypasses translation |
   * | Replace the key's text | `labels['nav.item.browse']` in the manifest | Wherever the key resolves; same text in every language |
   *
   * Setting **both** means the override wins and the `labels` entry is silently inert. That is
   * the documented precedence, not an accident, and `docs/extension-reference.md` says so.
   */
  readonly labelKey?: string;
  /** Router path, e.g. `/browse`. */
  readonly path: string;
  /** Icon name understood by the shell's icon set. */
  readonly icon: string;
  /** When true, clicking opens the secondary drawer instead of navigating directly. */
  readonly hasDrawer?: boolean;
  /** Registered rule id gating visibility. */
  readonly rule?: ExtensionRule;
}

/**
 * The navigation the product ships with.
 *
 * Phase 2 took the compiled `const` that `apps/nuxeo-ui/src/app/platform-nav-items.ts`
 * held and **registered it into a slot** instead, so a manifest can reorder it, relabel
 * it, hide entries, gate them behind a rule, or add its own. Reproducing the pre-Phase-2
 * navigation exactly was that phase's requirement, and it did.
 *
 * One browse surface is offered, at `/browse`. The adf-hx proof of concept's
 * `app.navbar.browseAdfHx` stood beside it, with this entry disabled, until both its route and
 * its ID were retired. Anything reading this list as "what the user sees" must still filter it,
 * because a manifest can disable or gate any entry — `resolve()` does, `pageTitle` deliberately
 * does not.
 *
 * `order` is explicit and spaced by ten so a customer can insert between two
 * packaged entries without restating the list.
 */
export const PACKAGED_NAV_ITEMS: readonly NavItemDescriptor[] = [
  // Temporarily disabled: Knowledge Discovery
  // {
  //   id: 'app.navbar.knowledgeDiscovery',
  //   labelKey: 'nav.item.knowledge-discovery',
  //   label: 'Knowledge Discovery',
  //   path: '/knowledge-discovery',
  //   icon: 'star',
  //   order: 10,
  // },
  {
    id: 'app.navbar.dashboard',
    labelKey: 'nav.item.dashboard',
    label: 'Dashboard',
    path: '/dashboard',
    icon: 'dashboard',
    order: 20,
  },
  {
    id: 'app.navbar.browse',
    labelKey: 'nav.item.browse',
    label: 'Browse',
    path: '/browse',
    icon: 'folder',
    order: 30,
    hasDrawer: true,
  },
  {
    id: 'app.navbar.recentlyViewed',
    labelKey: 'nav.item.recently-viewed',
    label: 'Recently viewed',
    path: '/recently-viewed',
    icon: 'clock',
    order: 50,
    hasDrawer: true,
  },
  {
    id: 'app.navbar.search',
    labelKey: 'nav.item.search-filters',
    label: 'Search filters',
    path: '/search',
    icon: 'search',
    order: 60,
    hasDrawer: true,
  },
  {
    id: 'app.navbar.expiredQueue',
    labelKey: 'nav.item.expired-queue',
    label: 'Expired Queue',
    path: '/expired-queue',
    icon: 'timer',
    order: 70,
    hasDrawer: true,
  },
  {
    id: 'app.navbar.assets',
    labelKey: 'nav.item.assets',
    label: 'Assets',
    path: '/documents',
    icon: 'document',
    order: 80,
    hasDrawer: true,
  },
  {
    id: 'app.navbar.tasks',
    labelKey: 'nav.item.tasks',
    label: 'Tasks',
    path: '/tasks',
    icon: 'tasks',
    order: 90,
    hasDrawer: true,
  },
  {
    id: 'app.navbar.favorites',
    labelKey: 'nav.item.favorites',
    label: 'Favorites',
    path: '/favorites',
    icon: 'star',
    order: 100,
    hasDrawer: true,
  },
  {
    id: 'app.navbar.collections',
    labelKey: 'nav.item.collections',
    label: 'Collections',
    path: '/collections',
    icon: 'bookmark',
    order: 110,
    hasDrawer: true,
  },
  {
    id: 'app.navbar.personalSpace',
    labelKey: 'nav.item.personal-space',
    label: 'Personal Space',
    path: '/personal-space',
    icon: 'grid_view',
    order: 120,
    hasDrawer: true,
  },
  {
    id: 'app.navbar.clipboard',
    labelKey: 'nav.item.clipboard',
    label: 'Clipboard',
    path: '/clipboard',
    icon: 'notepad',
    order: 130,
    hasDrawer: true,
  },
  {
    id: 'app.navbar.trash',
    labelKey: 'nav.item.trash',
    label: 'Trash',
    path: '/trash',
    icon: 'trash',
    order: 140,
    hasDrawer: true,
  },
  {
    id: 'app.navbar.administration',
    labelKey: 'nav.item.administration',
    label: 'Administration',
    path: '/administration',
    icon: 'settings',
    order: 150,
    hasDrawer: true,
    // The only packaged entry carrying a rule. Before Phase 2 this was a
    // hardcoded `item.path === '/administration'` filter in the shell, which a
    // manifest could neither see nor relax.
    rule: 'app.rules.hasAdministrationAccess',
  },
];

/**
 * The navigation to render: packaged entries merged with the manifest's, with
 * overrides applied, rules evaluated and order honoured.
 *
 * A **signal** behind a token rather than a compiled array, for two reasons the
 * `const` could not satisfy. The manifest arrives asynchronously in
 * `APP_INITIALIZER`, so an eagerly evaluated array would capture the packaged
 * list; and nav rules such as `app.rules.isAdministrator` depend on the
 * signed-in user, so the answer changes after sign-in.
 */
export const APP_NAV_ITEMS = new InjectionToken<Signal<readonly NavItemDescriptor[]>>(
  'APP_NAV_ITEMS',
  {
    providedIn: 'root',
    factory: () => {
      const extensions = inject(AppExtensionsService);
      const ruleContext = inject(ExtensionRuleContextService);
      extensions.register(EXTENSION_SLOTS.navbar, PACKAGED_NAV_ITEMS);
      return computed(() =>
        extensions.resolve<NavItemDescriptor>(EXTENSION_SLOTS.navbar, ruleContext.context()),
      );
    },
  },
);
