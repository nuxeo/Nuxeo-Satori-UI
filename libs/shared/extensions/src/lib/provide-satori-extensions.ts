import {
  type EnvironmentProviders,
  inject,
  provideEnvironmentInitializer,
  runInInjectionContext,
  Injector,
} from '@angular/core';

import { ExtensionActionRegistry, type ExtensionActionHandler } from './extension-actions';
import {
  ExtensionComponentRegistry,
  type ExtensionComponentSource,
} from './extension-component-registry.service';
import { ExtensionRuleRegistry, type ExtensionRuleEvaluator } from './extension-rules';
import { ExtensionSlotRegistry } from './extension-slot-registry.service';
import type { ExtensionElement, ExtensionSlotId } from './extension-slots';

/**
 * Everything a layer may contribute to the addressable surface, in one object.
 *
 * This is the **Layer 2 contract** — the shape a customer's extension library
 * hands us, and our equivalent of ACA's `setComponents`, `setEvaluators` and
 * `setActions`. It is deliberately one declarative object rather than four
 * imperative calls against four registries: a customer should not have to know
 * that slots, rules, components and handlers live in different services, nor
 * which of them must be touched before the first slot resolves.
 *
 * Every field is optional, so a library contributing only a rule writes
 * `{ rules: { ... } }`.
 */
export interface SatoriExtensionContributions {
  /**
   * Descriptors per slot — *where* something appears and *when*.
   *
   * Keys are slot ids. {@link ExtensionSlotId} is `string` by construction, so a
   * slot this build has never heard of is registerable and a later release can
   * read it; see the note on additive slots in `extension-slots.ts`.
   */
  readonly slots?: Readonly<Record<ExtensionSlotId, readonly ExtensionElement[]>>;

  /**
   * Named predicates a manifest may reference by id.
   *
   * Re-registering a packaged id overrides it, which is how a customer changes
   * when an action is offered without forking the descriptor.
   */
  readonly rules?: Readonly<Record<string, ExtensionRuleEvaluator>>;

  /**
   * Rule ids that must **deny** when unregistered rather than permit.
   *
   * An unknown rule id normally fails *open*, because Layer 1 visibility is not
   * an authorisation boundary and a manifest typo must not strip working actions
   * out of the UI. That default is wrong for a rule that gates an
   * administrative surface: the unsafe window is precisely the one before
   * registration happens, and failing open there once offered Administration to
   * every user. Declare those ids here.
   *
   * This is **not** a security control on its own — the server-side Nuxeo
   * permission still decides whether an operation succeeds.
   */
  readonly failClosedRules?: readonly string[];

  /**
   * Components a manifest may place by id — *what renders*.
   *
   * A `() => Promise<Type>` loader keeps the component in its own lazy chunk, so
   * contributing one does not pull it into the initial bundle.
   */
  readonly components?: Readonly<Record<string, ExtensionComponentSource>>;

  /** Handlers a descriptor names — *what an action does*. */
  readonly actions?: Readonly<Record<string, ExtensionActionHandler>>;
}

/**
 * Contributions, or a factory that produces them inside an injection context.
 *
 * The factory form exists because real contributions need dependencies: the
 * application's own `app.rules.hasAdministrationAccess` reads `AuthService`, and
 * a customer's action handler is normally an injectable service. A plain object
 * cannot `inject()`; a factory can.
 *
 * The factory runs before the configuration loads, and a configuration token
 * keeps the first value it resolves to. So a service that reads one when it is
 * constructed — every `NuxeoApiBase` service reads `NUXEO_API_ORIGIN` — belongs
 * behind an `Injector` lookup inside the rule or handler, not in the factory.
 */
export type SatoriExtensionContributor =
  SatoriExtensionContributions | (() => SatoriExtensionContributions);

/**
 * Register a layer's contributions to the addressable surface.
 *
 * Call it in `bootstrapApplication`'s providers, once per contributing layer:
 *
 * ```ts
 * bootstrapApplication(AppComponent, {
 *   providers: [
 *     ...provideAppConfig(),
 *     provideSatoriExtensions(PACKAGED_CONTRIBUTIONS),
 *     provideSatoriExtensions(() => {
 *       const injector = inject(Injector);
 *       return {
 *         rules: { 'acme.rules.isPilotUser': () => injector.get(AcmeService).isPilot() },
 *         components: { 'acme.sidebar.reports': () => import('./reports').then((m) => m.Reports) },
 *       };
 *     }),
 *   ],
 * });
 * ```
 *
 * ## Ordering, which is the reason this is a provider and not a service call
 *
 * Contributions are applied in an **environment initializer**, so every id is
 * registered before the first component resolves a slot. Registering from a
 * component constructor instead leaves a window in which a rule id is unknown,
 * and an unknown rule fails open — which is how the Administration nav entry
 * came to flash for a non-administrator. An environment initializer runs earlier
 * than `APP_INITIALIZER`, so it closes that window rather than narrowing it.
 *
 * Multiple calls **layer** in provider order, and later wins per id, which is
 * what makes a customer layer able to override a packaged rule, component or
 * handler. Slot descriptors accumulate rather than replace; use the manifest's
 * `overrides` to hide or reorder a packaged entry.
 *
 * Returns `EnvironmentProviders`, so it cannot be mistakenly listed in a
 * component's `providers` — where it would run too late to be worth anything.
 */
export function provideSatoriExtensions(
  contributor: SatoriExtensionContributor,
): EnvironmentProviders {
  return provideEnvironmentInitializer(() => {
    const injector = inject(Injector);
    const slots = inject(ExtensionSlotRegistry);
    const rules = inject(ExtensionRuleRegistry);
    const components = inject(ExtensionComponentRegistry);
    const actions = inject(ExtensionActionRegistry);

    // The factory runs in *this* injection context, so a contributed rule may
    // `inject()` its own dependencies. `runInInjectionContext` rather than a
    // bare call, because a factory declared in a customer library has no
    // ambient context of its own.
    const contributions =
      typeof contributor === 'function'
        ? runInInjectionContext(injector, contributor)
        : contributor;

    // `failClosed` is declared before the evaluators register, because the
    // window it guards is the one *before* registration. The registry accepts
    // the declaration in either order for exactly this reason.
    if (contributions.failClosedRules?.length) {
      rules.declareFailClosed(contributions.failClosedRules);
    }
    if (contributions.rules) {
      rules.registerRules(contributions.rules);
    }
    if (contributions.components) {
      components.register(contributions.components);
    }
    if (contributions.actions) {
      actions.register(contributions.actions);
    }
    for (const [slot, entries] of Object.entries(contributions.slots ?? {})) {
      slots.register(slot, entries);
    }
  });
}
