/**
 * Layer 1 addressable surface — the slot vocabulary.
 *
 * A **slot** is a named, ordered list of descriptors that a manifest may extend,
 * reorder, relabel, gate or hide. The vocabulary is ACA's rather than a new
 * invention, so a customer or an agent that has seen Alfresco Content
 * Application already knows the shape.
 *
 * ## Slots are additive and independent, by construction
 *
 * The registry keys slots by **plain string**. There is no enum a slot must be
 * added to, no union type to widen, and no `switch` anywhere in this library
 * that dispatches on slot identity. `ExtensionSlotRegistry.register()` and
 * `.resolve()` are generic over the descriptor type and treat the slot id as
 * opaque data.
 *
 * The practical consequence — and the thing that turns the "addressable
 * ceiling" from an irreversible decision into ordinary backlog — is that adding
 * a tenth slot after Beta ships requires **no change to the nine**, and no
 * change to this library at all. `extension-slot-registry.service.spec.ts`
 * proves it by registering a slot this file has never heard of.
 *
 * The constants below are therefore **documentation and typo protection, not a
 * closed set**. Anything may register any string.
 */

/**
 * The nine slots Beta implements. Not a closed set — see the file comment.
 *
 * `rules` used to be listed here and was removed: rules are not descriptors and
 * do not live in a slot. They are registered in `ExtensionRuleRegistry`, so a
 * manifest writing `slots.rules` was silently inert while the constant implied
 * otherwise.
 */
export const EXTENSION_SLOTS = {
  /** Primary platform navigation entries. */
  navbar: 'navbar',
  /** Secondary drawer content behind a navbar entry. */
  sidebar: 'sidebar',
  /** Lazily resolved application routes. */
  routes: 'routes',
  /** Document-detail and browse toolbar actions. */
  toolbar: 'toolbar',
  /** The browse "More actions" menu, on the folder or document open. */
  contextMenu: 'contextMenu',
  /** The menu on each row of a document list, acting on that row's document. */
  rowActions: 'rowActions',
  /** Actions over a multi-document selection. */
  'bulk-actions': 'bulk-actions',
  /** Document-detail tab children. */
  tabs: 'tabs',
  /** Document list column descriptors. */
  documentList: 'documentList',
  /**
   * The body of the document-detail View tab, chosen per document by rule.
   *
   * Named for the view alone. Nuxeo Web UI resolves four layouts per type — view, edit,
   * create and metadata — and the other three are not this slot: a per-type metadata layout
   * is a separate design, and a generic `documentLayout` name here would have decided it.
   */
  documentView: 'documentView',
} as const;

/** A slot id. Deliberately `string`, not a union over {@link EXTENSION_SLOTS}. */
export type ExtensionSlotId = string;

/**
 * Fields every slot descriptor shares, matching ACA's `ExtensionElement`.
 *
 * `disabled` and `order` are honoured by the registry for every slot without
 * the slot having to opt in, which is what keeps "hide it" and "move it" a
 * pure JSON edit for surfaces nobody has thought about yet.
 */
export interface ExtensionElement {
  /** Stable public contract, `<owner>.<surface>.<name>`. Renaming is breaking. */
  readonly id: string;
  /** Dropped from the resolved list when true. */
  readonly disabled?: boolean;
  /** Ascending. Absent sorts as `Number.MAX_SAFE_INTEGER`, after any ordinary number, stably. */
  readonly order?: number;
}
