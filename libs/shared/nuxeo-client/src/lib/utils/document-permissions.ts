import type { NuxeoDocument } from '../models/document.model';

/** Nuxeo permission to add/edit/delete document ACL entries (Nuxeo Web UI pattern). */
export const WRITE_SECURITY = 'WriteSecurity';

/** Legacy compound permission that also grants ACL management on some deployments. */
export const MANAGE_DOCUMENT_PERMISSIONS = 'Everything';

/** Atomic permissions returned by the Nuxeo `permissions` document enricher. */
export const READ_DOCUMENT = 'Read';
export const WRITE_DOCUMENT = 'Write';
/** Nuxeo Web UI uses WriteProperties for note/metadata edit actions. */
export const WRITE_PROPERTIES = 'WriteProperties';
export const READ_WRITE_DOCUMENT = 'ReadWrite';
export const ADD_CHILDREN = 'AddChildren';
export const REMOVE_DOCUMENT = 'Remove';

/**
 * The catalogue KEY for the permission-denied message, not the message.
 *
 * This was the English sentence, exported and used directly at nine call sites, so every one of them
 * rendered English whatever the locale — and no gate could see it, because a bare constant is not a
 * sink. Exporting the key instead means a caller has to resolve it, which is a compile-time nudge
 * toward the resolver rather than a silent literal.
 */
export const PERMISSION_DENIED_KEY = 'common.permission-denied';

export function hasDocumentPermission(
  doc: NuxeoDocument | null | undefined,
  permission: string,
): boolean {
  const permissions = doc?.contextParameters?.['permissions'];
  return Array.isArray(permissions) && permissions.includes(permission);
}

/** True when the document response includes the `permissions` enricher. */
export function hasDocumentPermissionsEnricher(doc: NuxeoDocument | null | undefined): boolean {
  return Array.isArray(doc?.contextParameters?.['permissions']);
}

/** Show write actions when permissions are unknown or Write/WriteProperties is granted. */
export function canShowWriteDocumentAction(doc: NuxeoDocument | null | undefined): boolean {
  if (!doc) return false;
  if (!hasDocumentPermissionsEnricher(doc)) return true;
  return canWriteDocument(doc);
}

/** Show remove actions when permissions are unknown or Remove is granted. */
export function canShowRemoveDocumentAction(doc: NuxeoDocument | null | undefined): boolean {
  if (!doc) return false;
  if (!hasDocumentPermissionsEnricher(doc)) return true;
  return canRemoveDocument(doc);
}

/** True when the current user can manage ACL entries on the document. */
export function canManageDocumentPermissions(doc: NuxeoDocument | null | undefined): boolean {
  return (
    hasDocumentPermission(doc, WRITE_SECURITY) ||
    hasDocumentPermission(doc, MANAGE_DOCUMENT_PERMISSIONS)
  );
}

/** True when the current user can edit content, create versions, lock, etc. */
export function canWriteDocument(doc: NuxeoDocument | null | undefined): boolean {
  return hasDocumentPermission(doc, WRITE_DOCUMENT) || hasDocumentPermission(doc, WRITE_PROPERTIES);
}

/**
 * Web UI's `isTaggable`: the document itself, not a proxy or a version, and the user holds Write.
 * Nuxeo accepts a tag from a reader too, but Web UI does not offer it, and only a user with Write
 * may take a tag off.
 */
export function canTagDocument(doc: NuxeoDocument | null | undefined): boolean {
  return !!doc && !doc.isProxy && !doc.isVersion && hasDocumentPermission(doc, WRITE_DOCUMENT);
}

/** The permission Nuxeo checks to create, restore and publish versions. */
export const WRITE_VERSION = 'WriteVersion';

/**
 * Nuxeo flags a record with the `isRecord` field of the document JSON — there is no facet for it.
 * The public `NuxeoDocument` model does not declare the field, so it is read here rather than
 * added to that published type.
 */
export function isRecordDocument(doc: NuxeoDocument | null | undefined): boolean {
  return (
    (doc as (NuxeoDocument & { readonly isRecord?: boolean }) | null | undefined)?.isRecord === true
  );
}

/**
 * Web UI's Create Version gate (`nuxeo-document-create-version`): the live document, not a version
 * or a record, with the `Versionable` facet, and the user holds `WriteVersion`.
 */
export function canCreateDocumentVersion(doc: NuxeoDocument | null | undefined): boolean {
  return (
    !!doc &&
    !doc.isVersion &&
    !isRecordDocument(doc) &&
    (doc.facets ?? []).includes('Versionable') &&
    hasDocumentPermission(doc, WRITE_VERSION)
  );
}

/**
 * Web UI's `isPublishable`: not a proxy, a record or in the trash, the `Publishable` facet, and
 * `WriteVersion`. A version is publishable — `Document.PublishToSection` publishes it as it is.
 * Without an `isTrashed` flag, Web UI reads the `deleted` life-cycle state as the trash.
 */
export function canPublishDocument(doc: NuxeoDocument | null | undefined): boolean {
  return (
    !!doc &&
    !doc.isProxy &&
    !isRecordDocument(doc) &&
    !(doc.isTrashed ?? doc.state === 'deleted') &&
    (doc.facets ?? []).includes('Publishable') &&
    hasDocumentPermission(doc, WRITE_VERSION)
  );
}

/** True when the current user can create child documents in a folder. */
export function canAddChildren(doc: NuxeoDocument | null | undefined): boolean {
  return hasDocumentPermission(doc, ADD_CHILDREN);
}

/** True when the current user can trash or permanently delete the document. */
export function canRemoveDocument(doc: NuxeoDocument | null | undefined): boolean {
  return hasDocumentPermission(doc, REMOVE_DOCUMENT);
}

/** True when the current user can view document audit/history (Classic Web UI parity). */
export function canViewDocumentAuditLog(doc: NuxeoDocument | null | undefined): boolean {
  return hasDocumentPermission(doc, READ_DOCUMENT);
}

/** True when an HTTP error indicates the server rejected the action for lack of permission. */
export function isPermissionDeniedError(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  return status === 401 || status === 403;
}
