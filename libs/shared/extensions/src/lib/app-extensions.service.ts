import { Injectable, computed, inject } from '@angular/core';

import { AppConfigService } from '@nuxeo/satori-platform/app-config';

import {
  resolveExtensionLayers,
  type ExtensionConfig,
  type ResolvedExtensionConfig,
} from './extension-config';
import { DOCUMENT_RULE_EVALUATORS } from './document-rules';
import type { ExtensionRouteDescriptor } from './extension-actions';
import {
  partitionExtensionRouteDescriptors,
  type RejectedExtensionRoute,
} from './extension-route-paths';
import {
  EMPTY_EXTENSION_RULE_CONTEXT,
  ExtensionRuleRegistry,
  type ExtensionRule,
  type ExtensionRuleContext,
  type ExtensionRuleEvaluator,
} from './extension-rules';
import {
  ExtensionSlotRegistry,
  type ExtensionSlotOverrides,
} from './extension-slot-registry.service';
import { EXTENSION_SLOTS, type ExtensionElement, type ExtensionSlotId } from './extension-slots';
import { SURFACE_RULE_EVALUATORS } from './surface-rules';

/**
 * The single thing the application injects to read the addressable surface.
 *
 * It joins the two halves: descriptors and rules registered in **code** at
 * bootstrap, and contributions and overrides loaded from the **manifest** by
 * `AppConfigService`. Everything a consumer needs is `resolve(slot, context)`.
 *
 * The packaged document rules are registered in the constructor, so any
 * injector that reaches this service has them — a consumer cannot forget to
 * bootstrap the rules and then silently resolve every rule-gated entry to
 * `true`.
 */
@Injectable({ providedIn: 'root' })
export class AppExtensionsService {
  private readonly appConfig = inject(AppConfigService);
  private readonly slots = inject(ExtensionSlotRegistry);
  private readonly rules = inject(ExtensionRuleRegistry);

  /** The merged Layer 1 config, recomputed when the manifest signal changes. */
  private readonly resolved = computed<ResolvedExtensionConfig>(() =>
    resolveExtensionLayers(this.appConfig.manifest().extensionLayers),
  );

  readonly config = computed<ExtensionConfig>(() => this.resolved().config);

  /** Layer names referenced but not resolvable — surfaced rather than swallowed. */
  readonly missingLayers = computed<readonly string[]>(() => this.resolved().missing);

  /**
   * `routes` entries dropped because the router would not have matched their path.
   *
   * Same channel as {@link missingLayers}, for the same reason: an entry that
   * disappears without a word is a manifest you debug by bisection. Recomputes with
   * the manifest signal, which is where a customer-authored path comes from; the
   * packaged descriptors registered at bootstrap are compiled in and valid.
   */
  readonly invalidRoutes = computed<readonly RejectedExtensionRoute[]>(
    () =>
      partitionExtensionRouteDescriptors(
        this.resolve<ExtensionRouteDescriptor>(EXTENSION_SLOTS.routes),
      ).rejected,
  );

  private readonly overrides = computed<ExtensionSlotOverrides>(() => {
    const config = this.config();
    return {
      byId: config.overrides ?? {},
      additions: config.slots ?? {},
    };
  });

  constructor() {
    this.rules.registerRules(DOCUMENT_RULE_EVALUATORS);
    this.rules.registerRules(SURFACE_RULE_EVALUATORS);
  }

  /** Contribute packaged descriptors to a slot. See {@link ExtensionSlotRegistry.register}. */
  register<T extends ExtensionElement>(slot: ExtensionSlotId, entries: readonly T[]): void {
    this.slots.register(slot, entries);
  }

  /** Contribute rule evaluators — the Layer 2 entry point for customer code. */
  registerRules(evaluators: Readonly<Record<string, ExtensionRuleEvaluator>>): void {
    this.rules.registerRules(evaluators);
  }

  /**
   * The descriptors a slot should render right now.
   *
   * Not memoised: the rule context is caller-supplied and changes with the
   * focused document and the selection, so a cache keyed on the slot alone
   * would serve a stale answer. Resolution is a filter and a sort over a list
   * that is tens of entries long at most.
   */
  resolve<T extends ExtensionElement>(
    slot: ExtensionSlotId,
    context: ExtensionRuleContext = EMPTY_EXTENSION_RULE_CONTEXT,
  ): readonly T[] {
    return this.slots.resolve<T>(slot, this.overrides(), context);
  }

  /** Evaluate a rule reference directly, for a template that gates one control. */
  evaluateRule(rule: ExtensionRule | null | undefined, context: ExtensionRuleContext): boolean {
    return this.rules.evaluate(rule, context);
  }

  /** Every registered id, for the extension reference doc and diagnostics. */
  inventory(): Readonly<Record<string, readonly string[]>> {
    const inventory: Record<string, readonly string[]> = {
      'rules (evaluator ids)': this.rules.registeredRuleIds(),
    };
    for (const slot of this.slots.registeredSlotIds()) {
      inventory[slot] = this.slots.registeredIds(slot);
    }
    return inventory;
  }
}
