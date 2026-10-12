import {
  APP_INITIALIZER,
  DestroyRef,
  Injector,
  type EnvironmentProviders,
  type Provider,
  type Type,
  effect,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';

import {
  AppExtensionsService,
  EXTENSION_SLOTS,
  ExtensionRuleContextService,
  PACKAGED_BROWSE_COLUMNS,
  PACKAGED_BROWSE_CONTEXT_MENU,
  PACKAGED_BULK_ACTIONS,
  PACKAGED_DOCUMENT_TABS,
  PACKAGED_DOCUMENT_TOOLBAR_ACTIONS,
  provideExtensionRoutes,
  provideSatoriExtensions,
  type ExtensionActionHandler,
} from '@nuxeo-satori/platform/extensions';
import { AppConfigService } from '@nuxeo-satori/platform/app-config';
import {
  NXS_PERMISSIONS_PANEL_ID,
  NxsPermissionsPanelComponent,
} from '@nuxeo-satori/platform/components';
import { SelectionService } from '@nuxeo-satori/platform/nuxeo-client';

import { AuthService } from '../auth/auth.service';

type BulkActionModule = typeof import('./bulk-action.services');

/**
 * A handler that loads its action service on first use.
 *
 * The registration runs eagerly, and the action services pull in dialogs from
 * `@nuxeo-satori/platform/ui`. Importing them statically moved ~440 kB of dialog
 * code out of the lazily-loaded shell chunk and into the initial bundle, which
 * the build budget correctly refused. Deferring the import to the click keeps the
 * registration eager — so the descriptors are always addressable — while the
 * code stays where it was.
 */
function bulkHandler(injector: Injector, name: keyof BulkActionModule): ExtensionActionHandler {
  return {
    execute: (context) => {
      void import('./bulk-action.services')
        // The keyed lookup widens to a union of the six service classes, which
        // `Injector.get` cannot narrow; they all satisfy the handler interface.
        .then((module) =>
          injector.get(module[name] as Type<ExtensionActionHandler>).execute(context),
        )
        .catch((error) => console.error(`Failed to load bulk action ${name}`, error));
    },
  };
}

/**
 * The application's own Layer 1 contributions, declared through the **public**
 * Layer 2 contract.
 *
 * This deliberately goes through `provideSatoriExtensions()` rather than
 * injecting the four registries by hand. The mechanism a customer's extension
 * library is documented to use is then the same one the product itself uses, so
 * it cannot rot into a surface nothing exercises — and the shape here is exactly
 * what `docs/extension-reference.md` tells a customer to write.
 *
 * The factory form is required, not stylistic: two of the rules read
 * `AuthService` and all six action handlers close over an `Injector`.
 *
 * `AuthService` is looked up when a rule is evaluated, not here. This factory
 * runs in an environment initializer, before the configuration loads, and
 * constructing `AuthService` resolves configuration tokens that keep their first
 * value — the Nuxeo API origin and the SSO settings would stay at their defaults.
 */
function provideAppContributions(): EnvironmentProviders {
  return provideSatoriExtensions(() => {
    const injector = inject(Injector);
    const auth = () => injector.get(AuthService);

    return {
      // Rules that need shell-owned state. These are exactly the shape a
      // customer's Layer 2 library registers.
      //
      // Not listed in `failClosedRules`: both ids are already in
      // `SECURITY_RELEVANT_RULE_IDS`, which the registry seeds itself. Declaring
      // them again here would read as if the protection came from this call.
      rules: {
        'app.rules.hasAdministrationAccess': () => auth().hasAdministrationAccess(),
        'app.rules.isPowerUser': () => auth().isPowerUser(),
      },

      slots: {
        // The bulk-action surface: descriptors say where and when, handlers say
        // what. Adding a seventh action is these two registrations and nothing
        // else — no output on the topbar, no method on the shell.
        [EXTENSION_SLOTS['bulk-actions']]: PACKAGED_BULK_ACTIONS,
        // Browse document-list columns. Registered here rather than in the
        // browse library so the ids exist before any component resolves the
        // slot, and a manifest override is in force on the first render instead
        // of after a reflow.
        [EXTENSION_SLOTS.documentList]: PACKAGED_BROWSE_COLUMNS,
        // The document-detail toolbar, its overflow menu and its tab strip, and
        // the browse document context menu. Registered here for the same reason
        // as the columns: the ids must exist before the surface first resolves
        // the slot. The *handlers* are not here — they close over the component
        // that owns the behaviour, so `DocumentDetailComponent` and
        // `BrowseComponent` register and withdraw their own.
        [EXTENSION_SLOTS.toolbar]: PACKAGED_DOCUMENT_TOOLBAR_ACTIONS,
        [EXTENSION_SLOTS.tabs]: PACKAGED_DOCUMENT_TABS,
        [EXTENSION_SLOTS.contextMenu]: PACKAGED_BROWSE_CONTEXT_MENU,
      },

      actions: {
        'app.bulkActions.downloadZip': bulkHandler(injector, 'BulkDownloadZipActionService'),
        'app.bulkActions.addToCollection': bulkHandler(
          injector,
          'BulkAddToCollectionActionService',
        ),
        'app.bulkActions.compare': bulkHandler(injector, 'BulkCompareActionService'),
        'app.bulkActions.addToClipboard': bulkHandler(injector, 'BulkAddToClipboardActionService'),
        'app.bulkActions.publish': bulkHandler(injector, 'BulkPublishActionService'),
        'app.bulkActions.delete': bulkHandler(injector, 'BulkDeleteActionService'),
      },

      // Drawer panels that live in lazy-loaded feature libraries, so a manifest
      // can place one without the shell statically importing it.
      components: {
        'app.sidebar.assets': () =>
          import('@agentic-ui/feature-assets/assets-drawer').then((m) => m.AssetsDrawerComponent),
        'app.sidebar.searchFilters': () =>
          import('@agentic-ui/feature-search').then((m) => m.SearchFiltersDrawerComponent),
        'app.sidebar.trashFilters': () =>
          import('@agentic-ui/feature-trash').then((m) => m.TrashFiltersDrawerComponent),

        /**
         * A whole PAGE a manifest can route to, not a drawer panel.
         *
         * Added because the `routes` slot went live in `7fd5e46` and **the product registered no
         * component for a manifest route to resolve** — so the slot was live and unusable here, which
         * is the "registered surface with no consumer" failure this programme has already been caught
         * by twice. A manifest can now contribute both the route and the nav entry:
         *
         *   "routes": [{ "id": "app.page.contracts", "path": "contracts" }]
         *   "navbar": [{ "id": "acme.navbar.contracts", "label": "Contracts", "path": "/contracts" }]
         *
         * `app.routes.ts` also maps `/contracts` statically, and both paths reach the same component.
         * That is deliberate for now: the static route is what the packaged app ships, and this
         * registration is what makes the page addressable to a customer who wants it somewhere else,
         * renamed, or rule-gated.
         */
        'app.page.contracts': () =>
          import('../features/contracts/contracts-page.component').then(
            (m) => m.ContractsPageComponent,
          ),

        // The local and inherited half of the document-detail and browse Permissions tabs.
        // Re-registering this ID replaces the panel in both. By class, not behind `import()`:
        // `app.config.ts` imports the library eagerly for `provideNxsComponents()`, so a lazy
        // import of it would load nothing later, and the module-boundary rule rejects the mix.
        [NXS_PERMISSIONS_PANEL_ID]: NxsPermissionsPanelComponent,
      },
    };
  });
}

/**
 * Keep the rule context live.
 *
 * Separate from the contributions above because this is not registration: it is
 * shell-owned state being pushed into `ExtensionRuleContextService` for the
 * lifetime of the application.
 *
 * `ExtensionRuleContextService.selection` is still not populated.
 * `SelectionService` tracks ids, labels and previews — not documents — so the
 * permission rules over a selection have nothing to read, and filling the list
 * with approximations would make `app.rules.canRemoveSelection` look implemented
 * while always answering `false`. `selectionCount` **is** populated, because the
 * cardinality is knowable from the ids alone, which is what makes
 * `app.rules.hasSelection` and `app.rules.hasMultipleSelection` genuinely live.
 *
 * `.document` is populated by whichever surface owns a focused document —
 * `DocumentDetailComponent` — rather than here, and cleared when it is destroyed.
 *
 * `AuthService` and `SelectionService` are resolved only once the configuration
 * has loaded. Constructing either resolves configuration tokens whose factories
 * read the configuration once — the Nuxeo API origin, through `NuxeoApiBase`, and
 * the SSO settings — so resolved in this factory they would keep their defaults.
 */
function provideRuleContextWiring(): Provider {
  return {
    provide: APP_INITIALIZER,
    multi: true,
    useFactory: () => {
      // Injected for its constructor, which registers `DOCUMENT_RULE_EVALUATORS`.
      // Eager construction here is what guarantees the document rules are
      // known before any surface resolves a rule-gated entry; an unknown rule
      // id fails open, so a lazy construction would leave that window open.
      inject(AppExtensionsService);

      const config = inject(AppConfigService);
      const ruleContext = inject(ExtensionRuleContextService);
      const router = inject(Router);
      const injector = inject(Injector);
      const destroyRef = inject(DestroyRef);

      return async () => {
        await config.load();
        const auth = injector.get(AuthService);
        const selection = injector.get(SelectionService);
        effect(
          () => {
            ruleContext.username.set(auth.username());
            ruleContext.isAdministrator.set(auth.isAdministrator());
            ruleContext.selectionCount.set(selection.selectedCount());
          },
          { injector },
        );

        // `Router.url` is not a signal, so the URL half of the context has to be
        // pushed on navigation rather than read reactively.
        ruleContext.url.set(router.url.split('?')[0]);
        router.events
          .pipe(
            filter((event): event is NavigationEnd => event instanceof NavigationEnd),
            takeUntilDestroyed(destroyRef),
          )
          .subscribe((event) => ruleContext.url.set(event.urlAfterRedirects.split('?')[0]));
      };
    },
  };
}

/** Layer 1 registration, the live rule context, and manifest-declared routes. */
export function provideAppExtensions(): (Provider | EnvironmentProviders)[] {
  return [provideAppContributions(), provideRuleContextWiring(), provideExtensionRoutes()];
}
