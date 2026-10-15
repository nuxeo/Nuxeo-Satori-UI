import { Injectable } from '@angular/core';

import type { ExtensionRule, ExtensionRuleContext } from './extension-rules';
import type { ExtensionElement } from './extension-slots';

/**
 * A user-invocable action, as a descriptor rather than as markup.
 *
 * The shape follows adf-hx's action services (`content-delete`,
 * `content-share`, `single-item-download`, `permissions-management` in the
 * published package's `/ui` entry point): a declarative descriptor naming a
 * service that performs the work. It was matched so that adopting those
 * components would not mean migrating the action surface twice; adf-hx was
 * removed instead, and the shape stays because handlers are written against it.
 *
 * **A descriptor is not a permission.** `rule` decides what the interface
 * offers; Nuxeo evaluates the real permission server-side on every operation.
 * Hiding an action does not prevent the corresponding REST call.
 */
export interface ExtensionActionDescriptor extends ExtensionElement {
  /** Text shown in a menu, and the accessible name of an icon-only control. */
  readonly label: string;
  /**
   * A translation key for the text, preferred over `label` when it resolves.
   *
   * `label` stays a literal and stays what a manifest's `overrides[id].label` replaces. See
   * `NavItemDescriptor.labelKey` for why this is a second field rather than a reinterpretation
   * of a published one, and `ExtensionSlotRegistry.applyOverride` for why an override clears it.
   */
  readonly labelKey?: string;
  /** Icon name understood by the host's icon set. */
  readonly icon?: string;
  /** Hover text. Falls back to `label`. */
  readonly tooltip?: string;
  /** Registered rule id, or a nested rule reference, gating visibility. */
  readonly rule?: ExtensionRule;
  /**
   * Registered rule deciding whether the control is **enabled**.
   *
   * Distinct from `rule` because "offered but not currently applicable" and
   * "not offered at all" are different affordances, and today's UI uses both —
   * bulk Compare is visible and disabled below two selected documents. Absent
   * means always enabled.
   */
  readonly enabledRule?: ExtensionRule;
  /**
   * Render in the overflow menu rather than inline on the toolbar.
   *
   * A manifest promotes an overflow item to the toolbar by contributing an
   * entry with the same id and `"overflow": false`, which merges over ours.
   */
  readonly overflow?: boolean;
  /**
   * Registered handler id. Defaults to the descriptor `id`, so the common case
   * — one descriptor, one handler — needs no second identifier.
   */
  readonly action?: string;
}

/** A column of a document list, addressable so a customer can change the set. */
export interface ExtensionColumnDescriptor extends ExtensionElement {
  readonly label: string;
  /**
   * A translation key for the text, preferred over `label` when it resolves.
   *
   * `label` stays a literal and stays what a manifest's `overrides[id].label` replaces. See
   * `NavItemDescriptor.labelKey` for why this is a second field rather than a reinterpretation
   * of a published one, and `ExtensionSlotRegistry.applyOverride` for why an override clears it.
   */
  readonly labelKey?: string;
  /** Property key the host reads off a document, e.g. `dc:title`. */
  readonly field: string;
  readonly sortable?: boolean;
  readonly rule?: ExtensionRule;
  /**
   * Not shown until the user turns it on, but still offered in the column picker.
   *
   * Deliberately **not** `disabled`, which the registry drops from the resolved
   * list entirely. The two are different affordances and browse already uses both:
   * eight of its twelve columns ship switched off yet selectable, whereas a column
   * a customer has genuinely removed should not appear in the picker at all.
   * Collapsing them would make "hide by default" indistinguishable from "delete",
   * and a manifest could then only ever remove a column, never pre-fold one.
   */
  readonly hiddenByDefault?: boolean;
}

/**
 * A document-detail tab.
 *
 * A packaged tab's content is compiled in and keyed by `id`. A tab a manifest
 * adds names a **registered component** instead, which `ExtensionOutletComponent`
 * resolves — so contributing a tab is a manifest edit plus a Layer 2 component,
 * not a change to the host template.
 */
export interface ExtensionTabDescriptor extends ExtensionElement {
  readonly label: string;
  /**
   * A translation key for the text, preferred over `label` when it resolves.
   *
   * `label` stays a literal and stays what a manifest's `overrides[id].label` replaces. See
   * `NavItemDescriptor.labelKey` for why this is a second field rather than a reinterpretation
   * of a published one, and `ExtensionSlotRegistry.applyOverride` for why an override clears it.
   */
  readonly labelKey?: string;
  /** Icon rendered before the label. Absent renders a text-only tab. */
  readonly icon?: string;
  readonly rule?: ExtensionRule;
  /**
   * Registered component id rendering the tab body.
   *
   * Ignored for the packaged ids, whose content is markup in the host template.
   * Defaults to the descriptor `id`, so a customer who registers a component
   * under the same id as the tab needs only one identifier.
   */
  readonly componentId?: string;
}

/**
 * What the document-detail View tab renders for the documents a rule selects.
 *
 * The host resolves the `documentView` slot against the focused document and renders the
 * first entry, by `order`, whose component is registered. Nothing resolving leaves the
 * packaged view in place, so a manifest that contributes nothing changes nothing.
 *
 * `rule` is what makes it per type: `{ "type": "app.rules.isType", "parameters": ["Claim"] }`.
 * Any registered rule works. An entry with no rule matches every document.
 *
 * The rendered component receives the focused document as a `document` input when it
 * declares one, plus `inputs`. `document` is the host's: an `inputs.document` is overwritten,
 * so a manifest cannot hand a view a document other than the one on screen.
 */
export interface ExtensionDocumentViewDescriptor extends ExtensionElement {
  readonly rule?: ExtensionRule;
  /** Registered component id rendering the View tab body. Defaults to the descriptor `id`. */
  readonly componentId?: string;
  /** Static values set on the component's declared inputs. Unknown keys are ignored. */
  readonly inputs?: Readonly<Record<string, unknown>>;
}

/**
 * Replaces a document type's layout in one mode for the documents a rule selects: the type's
 * section of the Properties panel (`documentMetadata`), the edit form (`documentEdit`) or the
 * create form (`documentCreate`).
 *
 * Resolved like `documentView`: the first entry, by `order`, whose rule passes and whose
 * component is registered renders; nothing resolving leaves the layout — a contributed file or
 * the generated one — in place. For `documentCreate` the rule reads the type being created,
 * not the folder it is created in.
 *
 * What the rendered component receives depends on the mode, and the host's values overwrite
 * `inputs` of the same name: `document` for metadata and edit; `type` and `parentPath` for
 * create; and, for edit and create, `showErrors` and an `onChange` callback taking a
 * {@link DocumentLayoutChange}. The host still owns Save.
 */
export interface ExtensionDocumentLayoutDescriptor extends ExtensionElement {
  readonly rule?: ExtensionRule;
  /** Registered component id rendering the layout. Defaults to the descriptor `id`. */
  readonly componentId?: string;
  /** Static values set on the component's declared inputs. Unknown keys are ignored. */
  readonly inputs?: Readonly<Record<string, unknown>>;
}

/**
 * What a `documentEdit` or `documentCreate` component reports through its `onChange` input,
 * each time its values change: the properties to save, by xpath, and whether they may be.
 *
 * For an edit, send only what the user changed; for a create, everything the new document
 * should have. While `valid` is `false` the host does not save, and the component shows why.
 */
export interface DocumentLayoutChange {
  readonly properties: Readonly<Record<string, unknown>>;
  readonly valid: boolean;
}

/**
 * A route contributed by id — `path` plus the component that answers it.
 *
 * The component is resolved through `ExtensionComponentRegistry`, so a manifest
 * can only place a component that is already compiled in; contributing a new one
 * is Layer 2. Guards are deliberately absent: a route a manifest can add must
 * not be able to claim it has *removed* access to anything, because the surface
 * it renders is still gated by Nuxeo server-side.
 */
export interface ExtensionRouteDescriptor extends ExtensionElement {
  /** Path relative to the host route, e.g. `contracts` or `reports/:id`. */
  readonly path: string;
  /** Registered component id. Defaults to the descriptor `id`. */
  readonly componentId?: string;
  /** Inputs set on the rendered component. Unknown keys are ignored. */
  readonly inputs?: Readonly<Record<string, unknown>>;
}

/**
 * What a registered action does.
 *
 * Deliberately an object with `execute` rather than a bare function, because
 * that is adf-hx's shape and because a customer's handler is normally an
 * injectable service with its own dependencies.
 */
export interface ExtensionActionHandler {
  execute(context: ExtensionRuleContext): void;
}

/**
 * What one call to {@link ExtensionActionRegistry.register} or
 * {@link ExtensionActionRegistry.registerPackaged} added, and the only way to
 * take it back.
 *
 * Withdrawal is by registration rather than by id because an id is shared: the
 * packaged toolbar and a customer library both register `app.toolbar.delete`,
 * and either withdrawing "the handlers for these ids" would delete the other's.
 */
export interface ExtensionActionRegistration {
  /** Withdraw exactly the handlers this call added. Idempotent. */
  unregister(): void;
}

/**
 * Handlers, keyed by the id a descriptor names.
 *
 * Separate from {@link ExtensionSlotRegistry} on purpose: *where* an action
 * appears is Layer 1 configuration, and *what it does* is Layer 2 code. Keeping
 * them apart is what lets a manifest move an action between the toolbar and the
 * overflow menu without knowing anything about its implementation.
 *
 * Two tiers, because arrival order cannot decide precedence here. A customer
 * registers from an `APP_INITIALIZER`, as the extension reference tells them to,
 * while a packaged surface registers handlers closing over a component instance
 * in `ngOnInit` — so the packaged registration is always the *later* one, and a
 * single last-wins map would silently outrank every customer override of a
 * packaged id. {@link register} is the customer tier and always wins;
 * {@link registerPackaged} supplies the behaviour used when nobody has.
 */
@Injectable({ providedIn: 'root' })
export class ExtensionActionRegistry {
  private readonly overrides = new Map<string, ExtensionActionHandler[]>();
  private readonly packaged = new Map<string, ExtensionActionHandler[]>();

  /**
   * Add or replace handlers. Later registration wins, which is how a customer
   * library replaces a packaged action's behaviour without forking, and it
   * outranks {@link registerPackaged} whenever either was called.
   */
  register(
    handlers: Readonly<Record<string, ExtensionActionHandler>>,
  ): ExtensionActionRegistration {
    return this.add(this.overrides, handlers);
  }

  /**
   * Add handlers for the behaviour this build ships, outranked by any
   * {@link register} call.
   *
   * For a packaged surface registering handlers that close over a component
   * instance: withdraw the returned registration when the component is
   * destroyed, or the registry keeps a destroyed component reachable and the
   * next invocation runs against dead state.
   */
  registerPackaged(
    handlers: Readonly<Record<string, ExtensionActionHandler>>,
  ): ExtensionActionRegistration {
    return this.add(this.packaged, handlers);
  }

  has(id: string): boolean {
    return this.resolve(id) !== undefined;
  }

  /** Every registered id, for the reference doc and for diagnostics. */
  registeredActionIds(): readonly string[] {
    return [...new Set([...this.overrides.keys(), ...this.packaged.keys()])].sort();
  }

  /**
   * Run the handler a descriptor names.
   *
   * Returns `false` when nothing is registered under the id rather than
   * throwing: a manifest may reference an action a newer build provides, and a
   * click on it should be inert, not a crash in the shell.
   */
  execute(descriptor: ExtensionActionDescriptor, context: ExtensionRuleContext): boolean {
    const handler = this.resolve(descriptor.action ?? descriptor.id);
    if (!handler) return false;
    handler.execute(context);
    return true;
  }

  private add(
    tier: Map<string, ExtensionActionHandler[]>,
    handlers: Readonly<Record<string, ExtensionActionHandler>>,
  ): ExtensionActionRegistration {
    const added = Object.entries(handlers);
    for (const [id, handler] of added) {
      const registered = tier.get(id);
      if (registered) registered.push(handler);
      else tier.set(id, [handler]);
    }
    return { unregister: () => this.remove(tier, added) };
  }

  /**
   * Within a tier the most recent registration answers, so withdrawing an
   * earlier one must leave the later one in place — hence removing this
   * handler rather than the id.
   */
  private remove(
    tier: Map<string, ExtensionActionHandler[]>,
    added: readonly [string, ExtensionActionHandler][],
  ): void {
    for (const [id, handler] of added) {
      const registered = tier.get(id);
      const at = registered?.lastIndexOf(handler) ?? -1;
      if (!registered || at === -1) continue;
      registered.splice(at, 1);
      if (registered.length === 0) tier.delete(id);
    }
  }

  private resolve(id: string): ExtensionActionHandler | undefined {
    return this.overrides.get(id)?.at(-1) ?? this.packaged.get(id)?.at(-1);
  }
}

/**
 * The text of a descriptor, preferring its translation key over its literal label.
 *
 * For the consumers a template pipe cannot reach — a page heading built in TypeScript, a
 * composed accessible name, and adf-core's `DataColumn.title`, which upstream's own DataTable
 * renders where we have no template at all.
 *
 * `@i18n-contract:descriptor-api-is-framework-agnostic`
 *
 * Takes a resolver rather than `TranslateService` so that **this function, and the descriptor
 * data contract around it, impose no translation library on a caller**: Layer 1 descriptors are
 * data, and which library renders them is the host's business. Callers pass
 * `(key) => translate.instant(key)`.
 *
 * That is narrower than what this comment used to claim, and the difference matters. It said the
 * LIBRARY keeps no dependency on ngx-translate, and that stopped being true in this same
 * change-set — twice. `extension-outlet.component.ts` imports `TranslatePipe` for its `Loading…`
 * live region, and `DescriptorLabelPipe` injects `TranslateService`. A reviewer caught the pipe;
 * the outlet had gone unremarked for several commits.
 *
 * Moving both out was tried and is not viable: the pipe in `shared/ui` importing `descriptorLabel`
 * from here leaves a component undefined at module-initialisation time and takes six `AppShellComponent`
 * specs with it. So the honest statement is the one above — the function and the data contract are
 * agnostic, the library's own Angular components are not, and `@ngx-translate/core` is a declared
 * peer dependency of `@nuxeo-satori/platform` for exactly that reason.
 *
 * Falls back to the literal when a key does not resolve, because ngx-translate passes an
 * unknown key straight through and a column header reading `column.last-contributor` is worse
 * than the English it replaced.
 */
export function descriptorLabel(
  descriptor: { readonly label: string; readonly labelKey?: string },
  translate: (key: string) => string,
): string {
  if (!descriptor.labelKey) return descriptor.label;
  const resolved = translate(descriptor.labelKey);
  return resolved === descriptor.labelKey ? descriptor.label : resolved;
}
