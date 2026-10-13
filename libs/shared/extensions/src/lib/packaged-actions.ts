import type { ExtensionActionDescriptor } from './extension-actions';
import type { ExtensionRule, ExtensionRuleRef } from './extension-rules';

/** `core.not` over one rule — the negative half of a toggle, written once. */
function not(rule: ExtensionRule): ExtensionRuleRef {
  return { type: 'core.not', parameters: [rule] };
}

/** `core.every` over the listed rules. */
function every(...rules: readonly ExtensionRule[]): ExtensionRuleRef {
  return { type: 'core.every', parameters: rules };
}

/** `app.rules.isNotBusy` for one named operation. */
function notBusy(operation: string): ExtensionRuleRef {
  return { type: 'app.rules.isNotBusy', parameters: [operation] };
}

/**
 * Nuxeo Web UI never offers locking on a version, an immutable document or the repository
 * root. Versions carry the `Immutable` facet, so the facet covers both.
 */
const LOCKABLE: readonly ExtensionRule[] = [
  not({ type: 'app.rules.hasFacet', parameters: ['Immutable'] }),
  not({ type: 'app.rules.isType', parameters: ['Root'] }),
];

/**
 * The bulk actions the product ships with.
 *
 * The same six controls, in the same order, with the same icons and tooltips
 * that `selection-topbar.component.html` held as fixed markup before this
 * change — reproducing today's behaviour exactly is the requirement. What
 * changed is that each is now **addressable by id**, so hiding, reordering,
 * relabelling or rule-gating one is a manifest edit, and adding one is a
 * registration rather than an edit to three files across two projects.
 *
 * Note what is deliberately **not** here: permission rules. Today's topbar
 * offers all six regardless of what the user may do with the selection, and
 * `ExtensionRuleContext.selection` is still empty, so adding
 * `app.rules.canRemoveSelection` to Delete would hide it from everyone. The
 * server-side Nuxeo permission is, as always, the thing that actually decides.
 */
export const PACKAGED_BULK_ACTIONS: readonly ExtensionActionDescriptor[] = [
  {
    id: 'app.bulkActions.downloadZip',
    labelKey: 'action.bulk-actions-download-zip',
    label: 'Download All as Zip',
    icon: 'download',
    order: 10,
  },
  {
    id: 'app.bulkActions.addToCollection',
    labelKey: 'action.bulk-actions-add-to-collection',
    label: 'Add to Collection',
    icon: 'library_add',
    order: 20,
  },
  {
    id: 'app.bulkActions.compare',
    labelKey: 'action.bulk-actions-compare',
    label: 'Compare',
    icon: 'compare',
    order: 30,
    // Visible but disabled below two documents, which is what the fixed markup's
    // `[disabled]="selectedCount() < 2"` did.
    enabledRule: 'app.rules.hasMultipleSelection',
  },
  {
    id: 'app.bulkActions.addToClipboard',
    labelKey: 'action.bulk-actions-add-to-clipboard',
    label: 'Add to Clipboard',
    icon: 'content_paste',
    order: 40,
  },
  {
    id: 'app.bulkActions.publish',
    labelKey: 'action.bulk-actions-publish',
    label: 'Publish Document',
    icon: 'publish',
    order: 50,
  },
  {
    id: 'app.bulkActions.delete',
    labelKey: 'action.bulk-actions-delete',
    label: 'Delete selected',
    icon: 'delete',
    order: 60,
  },
];

/**
 * The document-detail toolbar and its overflow menu.
 *
 * The same controls, in the same order, with the same icons, tooltips and
 * gating that `document-detail.html` held as fixed markup — the `@if`
 * conditions that wrapped each button are now `rule`s, and the `[disabled]`
 * bindings that read `actionInProgress()` are now `enabledRule`s over
 * `app.rules.isNotBusy`. The lock pair has since moved to Web UI's behaviour:
 * its icon shows the document's state and Unlock is shown to every reader.
 *
 * `overflow: true` puts an entry behind the "More actions" menu. A manifest
 * promotes one to the toolbar by restating its id with `"overflow": false`.
 *
 * Each toggle is **two descriptors gated by opposite rules** rather than one
 * whose label the component swaps, so a customer relabelling "Notify Me"
 * without relabelling "Unsubscribe" gets exactly that.
 *
 * The knowledge-enrichment and Content Lake controls are **not** here. They
 * render progress spinners and a three-state ingest marker rather than a
 * button, so a descriptor cannot express them; they remain markup.
 */
export const PACKAGED_DOCUMENT_TOOLBAR_ACTIONS: readonly ExtensionActionDescriptor[] = [
  {
    id: 'app.toolbar.edit',
    labelKey: 'action.toolbar-edit',
    label: 'Edit',
    icon: 'edit',
    order: 10,
    rule: every('app.rules.isNotTrashed', 'app.rules.canWrite', not('app.rules.isNote')),
  },
  {
    // A Note's body belongs to the inline editor in the View tab, so this pencil
    // only ever reaches metadata and says so. Two descriptors rather than a
    // component-swapped label, for the same reason as the toggles above.
    id: 'app.toolbar.editProperties',
    labelKey: 'action.toolbar-edit-properties',
    label: 'Edit properties',
    icon: 'edit',
    order: 10,
    rule: every('app.rules.isNotTrashed', 'app.rules.canWrite', 'app.rules.isNote'),
  },
  {
    id: 'app.toolbar.addToCollection',
    labelKey: 'action.toolbar-add-to-collection',
    label: 'Add to collection',
    icon: 'library_add',
    order: 20,
    rule: 'app.rules.isNotTrashed',
  },
  {
    id: 'app.toolbar.delete',
    labelKey: 'action.toolbar-delete',
    label: 'Delete',
    icon: 'delete',
    order: 30,
    rule: every('app.rules.isNotTrashed', 'app.rules.canRemove'),
    enabledRule: notBusy('trash'),
  },
  {
    // The icon shows the document's state, as Web UI's does: open padlock while unlocked.
    id: 'app.toolbar.lock',
    labelKey: 'action.toolbar-lock',
    label: 'Lock',
    icon: 'lock_open',
    order: 40,
    rule: every(
      'app.rules.isNotTrashed',
      'app.rules.canWrite',
      not('app.rules.isLocked'),
      ...LOCKABLE,
    ),
    enabledRule: notBusy('lock'),
  },
  {
    // Shown to anyone who can read a locked document, so they can see who holds it. Nuxeo's
    // default lock policy takes Write on a locked document away from everyone but its owner and
    // administrators, so `canWrite` enables it for exactly them; the server still decides.
    id: 'app.toolbar.unlock',
    labelKey: 'action.toolbar-unlock',
    label: 'Unlock',
    icon: 'lock',
    order: 40,
    rule: every('app.rules.isNotTrashed', 'app.rules.isLocked', ...LOCKABLE),
    enabledRule: every(notBusy('lock'), 'app.rules.canWrite'),
  },
  {
    id: 'app.toolbar.addToFavorites',
    labelKey: 'action.toolbar-add-to-favorites',
    label: 'Add to Favorites',
    icon: 'star_border',
    order: 50,
    overflow: true,
    rule: every('app.rules.isNotTrashed', not('app.rules.isFavorite')),
    enabledRule: notBusy('favorite'),
  },
  {
    id: 'app.toolbar.removeFromFavorites',
    labelKey: 'action.toolbar-remove-from-favorites',
    label: 'Remove from Favorites',
    icon: 'star',
    order: 50,
    overflow: true,
    rule: every('app.rules.isNotTrashed', 'app.rules.isFavorite'),
    enabledRule: notBusy('favorite'),
  },
  {
    id: 'app.toolbar.share',
    labelKey: 'action.toolbar-share',
    label: 'Share',
    icon: 'share',
    order: 60,
    overflow: true,
    rule: 'app.rules.isNotTrashed',
  },
  {
    id: 'app.toolbar.publish',
    labelKey: 'action.toolbar-publish',
    label: 'Publish document',
    icon: 'publish',
    order: 70,
    overflow: true,
    rule: every('app.rules.isNotTrashed', 'app.rules.hasVersion', 'app.rules.canWrite'),
  },
  {
    id: 'app.toolbar.subscribe',
    labelKey: 'action.toolbar-subscribe',
    label: 'Notify Me',
    icon: 'notifications',
    order: 80,
    overflow: true,
    rule: every('app.rules.isNotTrashed', not('app.rules.isSubscribed')),
    enabledRule: notBusy('subscribe'),
  },
  {
    id: 'app.toolbar.unsubscribe',
    labelKey: 'action.toolbar-unsubscribe',
    label: 'Unsubscribe',
    icon: 'notifications_active',
    order: 80,
    overflow: true,
    rule: every('app.rules.isNotTrashed', 'app.rules.isSubscribed'),
    enabledRule: notBusy('subscribe'),
  },
  {
    id: 'app.toolbar.addToClipboard',
    labelKey: 'action.toolbar-add-to-clipboard',
    label: 'Add to Clipboard',
    icon: 'content_paste',
    order: 90,
    overflow: true,
    rule: every('app.rules.isNotTrashed', not('app.rules.isInClipboard')),
  },
  {
    id: 'app.toolbar.removeFromClipboard',
    labelKey: 'action.toolbar-remove-from-clipboard',
    label: 'Remove from Clipboard',
    icon: 'content_paste_off',
    order: 90,
    overflow: true,
    rule: every('app.rules.isNotTrashed', 'app.rules.isInClipboard'),
  },
  {
    // No rule: Export is the one entry the trashed banner leaves reachable, and
    // it was outside the `@if (!isTrashed())` block for exactly that reason.
    id: 'app.toolbar.export',
    labelKey: 'action.toolbar-export',
    label: 'Export',
    icon: 'download',
    order: 100,
    overflow: true,
    enabledRule: notBusy('export'),
  },
  {
    id: 'app.toolbar.startProcess',
    labelKey: 'action.toolbar-start-process',
    label: 'Start Process',
    icon: 'play_circle',
    order: 110,
    overflow: true,
    rule: 'app.rules.isNotTrashed',
  },
];

/**
 * The browse document context menu — the "More actions" menu on the browse
 * header, acting on the folder or document currently open.
 *
 * Named `contextMenu` because that is the slot it fills. **Browse has no
 * per-row menu**, in this build or before it: the slot's one-line description
 * said "row-level menu on a document list" while the only menu in
 * `browse.html` was this one. The id is the contract, so it stays; the
 * description in `docs/extension-reference.md` was corrected instead.
 */
export const PACKAGED_BROWSE_CONTEXT_MENU: readonly ExtensionActionDescriptor[] = [
  {
    id: 'app.contextMenu.share',
    labelKey: 'action.context-menu-share',
    label: 'Share',
    icon: 'share',
    order: 10,
  },
  {
    id: 'app.contextMenu.subscribe',
    labelKey: 'action.context-menu-subscribe',
    label: 'Notify Me',
    icon: 'notifications',
    order: 20,
    rule: not('app.rules.isSubscribed'),
  },
  {
    id: 'app.contextMenu.unsubscribe',
    labelKey: 'action.context-menu-unsubscribe',
    label: 'Unsubscribe',
    icon: 'notifications_off',
    order: 20,
    rule: 'app.rules.isSubscribed',
  },
  {
    id: 'app.contextMenu.export',
    labelKey: 'action.context-menu-export',
    label: 'Export',
    icon: 'ios_share',
    order: 30,
  },
];
