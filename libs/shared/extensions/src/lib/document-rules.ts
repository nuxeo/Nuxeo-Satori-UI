import {
  canAddChildren,
  canManageDocumentPermissions,
  canPublishDocument,
  canRemoveDocument,
  canWriteDocument,
  type NuxeoDocument,
} from '@nuxeo-satori/platform/nuxeo-client';

import type { ExtensionRuleEvaluator } from './extension-rules';

/** No document in focus is not "not trashed" — both trash rules deny on `null`. */
function isTrashedDocument(document: NuxeoDocument | null): boolean {
  return document?.isTrashed === true;
}

/** Manifest parameters are untyped JSON; only the strings can name a type or a facet. */
function stringParameters(parameters: readonly unknown[]): string[] {
  return parameters.filter((parameter): parameter is string => typeof parameter === 'string');
}

/**
 * The document's type is one of `types`, matched exactly. `app.rules.isType` and
 * `app.rules.isNote` both answer through this, so they cannot disagree about a Note.
 */
export function documentTypeIsOneOf(
  document: NuxeoDocument | null,
  types: readonly string[],
): boolean {
  const type = document?.type;
  return type !== undefined && types.includes(type);
}

/**
 * The packaged document rules, as manifest-referenceable ids.
 *
 * These wrap the pure predicates already in
 * `libs/shared/nuxeo-client/src/lib/utils/document-permissions.ts`. They are
 * already `(doc) => boolean`, so this is **registration, not a rewrite** — the
 * permission logic is unchanged and still has its own tests next to it.
 *
 * `app.rules.hasSelection` and `app.rules.isAdministrator` are here because
 * every bulk action needs the first and several administration entries need the
 * second, and without them a manifest could not express "show this only when
 * something is selected" at all.
 *
 * **These are not a security control.** Nuxeo evaluates the real permission
 * server-side on every operation. A rule that returns `true` does not grant
 * anything, and hiding an action does not prevent an API call. See
 * `docs/extension-reference.md`.
 */
export const DOCUMENT_RULE_EVALUATORS: Readonly<Record<string, ExtensionRuleEvaluator>> = {
  'app.rules.canWrite': (context) => canWriteDocument(context.document),
  'app.rules.canRemove': (context) => canRemoveDocument(context.document),
  'app.rules.canAddChildren': (context) => canAddChildren(context.document),
  'app.rules.canManagePermissions': (context) => canManageDocumentPermissions(context.document),
  /**
   * Web UI's `isPublishable`: not a proxy, a record or trashed, `Publishable`, and `WriteVersion`.
   * True on a version — Web UI publishes one as it is.
   */
  'app.rules.canPublish': (context) => canPublishDocument(context.document),
  'app.rules.hasDocument': (context) => context.document !== null,
  /**
   * The focused document's type is one of `parameters` — `["Case", "Claim"]`. Exact match, as
   * Nuxeo type names are case-sensitive. No parameters means no type matches, so a rule
   * misconfigured that way hides its entry rather than showing it everywhere.
   */
  'app.rules.isType': (context, parameters) =>
    documentTypeIsOneOf(context.document, stringParameters(parameters)),
  /** The focused document carries at least one facet in `parameters` — `["Folderish"]`. */
  'app.rules.hasFacet': (context, parameters) => {
    const facets = context.document?.facets ?? [];
    return stringParameters(parameters).some((facet) => facets.includes(facet));
  },
  /**
   * The focused document holds a main file, `file:content` — what Download downloads. Nuxeo's
   * `Downloadable` facet is not a test for it: Picture holds a file and has no such facet.
   */
  'app.rules.hasFile': (context) => {
    const content = context.document?.properties?.['file:content'];
    return typeof content === 'object' && content !== null && !Array.isArray(content);
  },
  /** The focused document is in the trash — gates the whole write half of the toolbar. */
  'app.rules.isTrashed': (context) => isTrashedDocument(context.document),
  'app.rules.isNotTrashed': (context) =>
    context.document !== null && !isTrashedDocument(context.document),
  // The cardinality rules read `selectionCount`, which the shell can populate
  // from ids alone. The permission rules below read `selection`, which needs the
  // documents and is still empty — see `ExtensionRuleContext`.
  'app.rules.hasSelection': (context) => context.selectionCount > 0,
  'app.rules.hasSingleSelection': (context) => context.selectionCount === 1,
  'app.rules.hasMultipleSelection': (context) => context.selectionCount > 1,
  'app.rules.isAdministrator': (context) => context.user.isAdministrator,
  /** Every selected document is writable — the bulk counterpart of `canWrite`. */
  'app.rules.canWriteSelection': (context) =>
    context.selection.length > 0 && context.selection.every(canWriteDocument),
  /** Every selected document is removable — gates bulk delete. */
  'app.rules.canRemoveSelection': (context) =>
    context.selection.length > 0 && context.selection.every(canRemoveDocument),
};
