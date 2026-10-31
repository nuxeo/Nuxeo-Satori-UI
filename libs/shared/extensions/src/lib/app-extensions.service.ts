import { Injectable, computed, effect, inject } from '@angular/core';

import { AppConfigService } from '@nuxeo/satori-platform/app-config';

import {
  resolveExtensionLayers,
  type ExtensionConfig,
  type RefusedExtensionEntry,
  type ResolvedExtensionLayers,
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
  private readonly resolved = computed<ResolvedExtensionLayers>(() =>
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

  /**
   * Slot entries the manifest read refused, each naming the slot, the reason and the
   * contribution that wrote it.
   *
   * The third signal on this channel, and for the reason {@link invalidRoutes} states: a
   * malformed slot or entry changed what a customer saw and said nothing anywhere, so a
   * manifest with a typo was debugged by bisection or not at all (NXSAT-755).
   *
   * What it reports is only what the **read** refused — a slot that is not a list, an entry
   * that cannot be addressed, and a repeated `id` inside one contributed list. A same-`id`
   * entry across contributions is the documented override mechanism and is deliberately
   * absent; `readSlotEntries` in `extension-config.ts` argues that line in full.
   */
  readonly refusedSlotEntries = computed<readonly RefusedExtensionEntry[]>(
    () => this.resolved().refused,
  );

  /**
   * The refusal list last written to the console, so a recomputation cannot repeat it.
   *
   * {@link refusedSlotEntries} is a `computed` over the manifest signal, which recomputes
   * whenever that signal changes — a preset being selected, a second load. Logging from inside
   * it would restate the same typo every time, which is the mistake
   * `AppConfigService.noteRefusedLogos` carries a comment about.
   *
   * The whole **list**, not a set of individual refusals. Two contributions may declare the same
   * `$name`, so two identical typos in them produce refusals equal in every field, and a set
   * keyed on those fields silently collapsed them into one line — the console under-reporting
   * how many problems there were while the signal held both (review of PR 534). Suppressing a
   * distinct refusal is the silence this ticket exists to remove, so it is the worse of the two
   * errors.
   *
   * The trade this makes: a manifest value whose refusals are not identical to the last one
   * re-states all of them, not only the new ones. That is "once per load" as the ticket asked
   * for it, and in this application it never arises — `AppConfigService.load()` memoises, so
   * there is one manifest value per page.
   */
  private lastNotedRefusals = '';

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
    // An `effect`, not a call here, for the reason `provideExtensionRoutes` gives: the manifest
    // is fetched by an `APP_INITIALIZER` and nothing guarantees it has landed when this service
    // is first injected, so a refusal read now would usually be a refusal read from an empty
    // manifest. And it is needed at all because the product application has no page showing
    // diagnostics — without it the console stays silent unless a host happens to render
    // `refusedSlotEntries`, and `nuxeo-ui` does not.
    effect(() => this.noteRefusedSlotEntries(this.refusedSlotEntries()));
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

  /** Write the refusals unless this exact list has been written. See {@link lastNotedRefusals}. */
  private noteRefusedSlotEntries(refused: readonly RefusedExtensionEntry[]): void {
    if (refused.length === 0) return;
    const key = JSON.stringify(refused);
    if (key === this.lastNotedRefusals) return;
    this.lastNotedRefusals = key;
    for (const entry of refused) {
      warn(`slots.${entry.slot} in ${entry.source}: ${entry.reason}`);
    }
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

/**
 * The product app has no page showing diagnostics, so the console is where support finds them.
 *
 * Module-local, which is the convention the two libraries that already do this follow —
 * `[agentic-ui-config]` in `app-config.service.ts` and `[agentic-ui-layouts]` in
 * `document-layout.service.ts`. The prefix is `extension-outlet.component.ts`'s, so this
 * library speaks with one voice; extracting a shared helper is a tidy-up worth doing when a
 * third module in here needs it.
 */
function warn(message: string): void {
  console.warn(`[agentic-ui-extensions] ${message}`);
}
