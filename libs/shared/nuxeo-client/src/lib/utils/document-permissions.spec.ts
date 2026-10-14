import {
  ADD_CHILDREN,
  canAddChildren,
  canCreateDocumentVersion,
  canManageDocumentPermissions,
  canPublishDocument,
  canRemoveDocument,
  canShowRemoveDocumentAction,
  canShowWriteDocumentAction,
  canTagDocument,
  canViewDocumentAuditLog,
  canWriteDocument,
  hasDocumentPermission,
  hasDocumentPermissionsEnricher,
  isPermissionDeniedError,
  isRecordDocument,
  MANAGE_DOCUMENT_PERMISSIONS,
  READ_WRITE_DOCUMENT,
  WRITE_SECURITY,
  PERMISSION_DENIED_KEY,
  REMOVE_DOCUMENT,
  WRITE_DOCUMENT,
  WRITE_PROPERTIES,
  WRITE_VERSION,
} from './document-permissions';
import type { NuxeoDocument } from '../models/document.model';

function docWithPermissions(permissions: string[]): NuxeoDocument {
  return {
    uid: 'doc-1',
    title: 'Test',
    type: 'File',
    path: '/default-domain/workspaces/test',
    lastModified: '2026-06-12T00:00:00.000Z',
    properties: {},
    contextParameters: { permissions },
  };
}

describe('document-permissions', () => {
  it('hasDocumentPermission returns false when permissions enricher is missing', () => {
    expect(hasDocumentPermission({} as NuxeoDocument, MANAGE_DOCUMENT_PERMISSIONS)).toBe(false);
    expect(hasDocumentPermission(null, MANAGE_DOCUMENT_PERMISSIONS)).toBe(false);
  });

  it('hasDocumentPermission matches a granted compound permission', () => {
    expect(hasDocumentPermission(docWithPermissions(['Read']), 'Read')).toBe(true);
    expect(hasDocumentPermission(docWithPermissions(['Read']), 'Everything')).toBe(false);
  });

  it('canManageDocumentPermissions is false for read-only users', () => {
    expect(canManageDocumentPermissions(docWithPermissions(['Read']))).toBe(false);
  });

  it('canManageDocumentPermissions is true when user has WriteSecurity', () => {
    expect(canManageDocumentPermissions(docWithPermissions(['Read', WRITE_SECURITY]))).toBe(true);
  });

  it('canManageDocumentPermissions is true when user has Everything', () => {
    expect(canManageDocumentPermissions(docWithPermissions(['Read', 'Everything']))).toBe(true);
  });

  it('canManageDocumentPermissions is false when user only has ReadSecurity', () => {
    expect(canManageDocumentPermissions(docWithPermissions(['Read', 'ReadSecurity']))).toBe(false);
  });

  it('canWriteDocument is false for read-only users', () => {
    expect(canWriteDocument(docWithPermissions(['Read']))).toBe(false);
  });

  it('canWriteDocument is true when user has Write', () => {
    expect(canWriteDocument(docWithPermissions(['Read', WRITE_DOCUMENT]))).toBe(true);
  });

  it('canWriteDocument is true when user has WriteProperties (Web UI note parity)', () => {
    expect(canWriteDocument(docWithPermissions(['Read', WRITE_PROPERTIES]))).toBe(true);
  });

  it('canTagDocument follows Web UI: Write on the document itself', () => {
    expect(canTagDocument(docWithPermissions(['Read', WRITE_DOCUMENT]))).toBe(true);
    expect(canTagDocument(docWithPermissions(['Read']))).toBe(false);
    expect(canTagDocument(docWithPermissions(['Read', WRITE_PROPERTIES]))).toBe(false);
    expect(canTagDocument(null)).toBe(false);
  });

  it('canTagDocument is false on a version and on a proxy, whatever the permissions', () => {
    const writable = docWithPermissions(['Read', WRITE_DOCUMENT]);
    expect(canTagDocument({ ...writable, isVersion: true })).toBe(false);
    expect(canTagDocument({ ...writable, isProxy: true })).toBe(false);
  });

  describe('versioning and publishing, as Web UI gates them', () => {
    const versionable = (
      permissions: string[],
      extra: Partial<NuxeoDocument> = {},
    ): NuxeoDocument => ({
      ...docWithPermissions(permissions),
      facets: ['Versionable', 'Publishable'],
      ...extra,
    });
    const record = (doc: NuxeoDocument): NuxeoDocument =>
      ({ ...doc, isRecord: true }) as NuxeoDocument;

    it('isRecordDocument reads the isRecord field, and nothing else', () => {
      expect(isRecordDocument(record(versionable([])))).toBe(true);
      expect(isRecordDocument(versionable([]))).toBe(false);
      expect(isRecordDocument({ ...versionable([]), facets: ['Record'] })).toBe(false);
      expect(isRecordDocument(null)).toBe(false);
    });

    it('canCreateDocumentVersion needs WriteVersion and Versionable on the live document', () => {
      expect(canCreateDocumentVersion(versionable([WRITE_VERSION]))).toBe(true);
      expect(canCreateDocumentVersion(versionable([WRITE_DOCUMENT, WRITE_PROPERTIES]))).toBe(false);
      expect(canCreateDocumentVersion(versionable([WRITE_VERSION], { facets: [] }))).toBe(false);
      expect(canCreateDocumentVersion(versionable([WRITE_VERSION], { isVersion: true }))).toBe(
        false,
      );
      expect(canCreateDocumentVersion(record(versionable([WRITE_VERSION])))).toBe(false);
      // A publication keeps the source's `Versionable` facet and permissions, but has no versions.
      expect(canCreateDocumentVersion(versionable([WRITE_VERSION], { isProxy: true }))).toBe(false);
      expect(canCreateDocumentVersion(null)).toBe(false);
    });

    it('canPublishDocument offers a version, as Web UI does', () => {
      expect(canPublishDocument(versionable([WRITE_VERSION], { isVersion: true }))).toBe(true);
      expect(canPublishDocument(versionable([WRITE_VERSION]))).toBe(true);
    });

    it('canPublishDocument refuses a proxy, a record, a trashed document, and no Publishable', () => {
      expect(canPublishDocument(versionable([WRITE_VERSION], { isProxy: true }))).toBe(false);
      expect(canPublishDocument(record(versionable([WRITE_VERSION])))).toBe(false);
      expect(canPublishDocument(versionable([WRITE_VERSION], { isTrashed: true }))).toBe(false);
      expect(canPublishDocument(versionable([WRITE_VERSION], { facets: ['Versionable'] }))).toBe(
        false,
      );
      expect(canPublishDocument(null)).toBe(false);
    });

    it('canPublishDocument reads the deleted state as the trash only when isTrashed is absent', () => {
      expect(canPublishDocument(versionable([WRITE_VERSION], { state: 'deleted' }))).toBe(false);
      expect(
        canPublishDocument(versionable([WRITE_VERSION], { state: 'deleted', isTrashed: false })),
      ).toBe(true);
    });

    it('canPublishDocument needs WriteVersion, not Write', () => {
      expect(canPublishDocument(versionable([WRITE_DOCUMENT, READ_WRITE_DOCUMENT]))).toBe(false);
    });
  });

  it('canAddChildren is false for read-only users', () => {
    expect(canAddChildren(docWithPermissions(['Read']))).toBe(false);
  });

  it('canAddChildren is true when user has AddChildren', () => {
    expect(canAddChildren(docWithPermissions(['Read', ADD_CHILDREN]))).toBe(true);
  });

  it('canRemoveDocument is false for read-only users', () => {
    expect(canRemoveDocument(docWithPermissions(['Read']))).toBe(false);
  });

  it('canRemoveDocument is true when user has Remove', () => {
    expect(canRemoveDocument(docWithPermissions(['Read', REMOVE_DOCUMENT]))).toBe(true);
  });

  it('hasDocumentPermissionsEnricher is false when permissions enricher is missing', () => {
    expect(hasDocumentPermissionsEnricher({} as NuxeoDocument)).toBe(false);
    expect(hasDocumentPermissionsEnricher(null)).toBe(false);
  });

  it('hasDocumentPermissionsEnricher is true when permissions enricher is present', () => {
    expect(hasDocumentPermissionsEnricher(docWithPermissions(['Read']))).toBe(true);
  });

  it('canShowWriteDocumentAction is true when permissions are unknown', () => {
    expect(canShowWriteDocumentAction({} as NuxeoDocument)).toBe(true);
  });

  it('canShowWriteDocumentAction follows canWriteDocument when permissions are known', () => {
    expect(canShowWriteDocumentAction(docWithPermissions(['Read']))).toBe(false);
    expect(canShowWriteDocumentAction(docWithPermissions(['Read', WRITE_DOCUMENT]))).toBe(true);
  });

  it('canShowRemoveDocumentAction is true when permissions are unknown', () => {
    expect(canShowRemoveDocumentAction({} as NuxeoDocument)).toBe(true);
  });

  it('canShowRemoveDocumentAction follows canRemoveDocument when permissions are known', () => {
    expect(canShowRemoveDocumentAction(docWithPermissions(['Read']))).toBe(false);
    expect(canShowRemoveDocumentAction(docWithPermissions(['Read', REMOVE_DOCUMENT]))).toBe(true);
  });

  it('canViewDocumentAuditLog is true for read-only users (Classic Web UI parity)', () => {
    expect(canViewDocumentAuditLog(docWithPermissions(['Read']))).toBe(true);
  });

  it('canViewDocumentAuditLog is false when permissions enricher is missing', () => {
    expect(canViewDocumentAuditLog({} as NuxeoDocument)).toBe(false);
    expect(canViewDocumentAuditLog(null)).toBe(false);
  });

  it('canViewDocumentAuditLog is true when user has Write', () => {
    expect(canViewDocumentAuditLog(docWithPermissions(['Read', WRITE_DOCUMENT]))).toBe(true);
  });

  it('canViewDocumentAuditLog is true when user has ReadWrite', () => {
    expect(canViewDocumentAuditLog(docWithPermissions(['Read', READ_WRITE_DOCUMENT]))).toBe(true);
  });

  it('canViewDocumentAuditLog is true when user has Everything', () => {
    expect(canViewDocumentAuditLog(docWithPermissions(['Read', MANAGE_DOCUMENT_PERMISSIONS]))).toBe(
      true,
    );
  });

  it('canViewDocumentAuditLog is true when user has WriteSecurity', () => {
    expect(canViewDocumentAuditLog(docWithPermissions(['Read', WRITE_SECURITY]))).toBe(true);
  });

  it('isPermissionDeniedError detects 401 and 403', () => {
    expect(isPermissionDeniedError({ status: 403 })).toBe(true);
    expect(isPermissionDeniedError({ status: 401 })).toBe(true);
    expect(isPermissionDeniedError({ status: 500 })).toBe(false);
  });

  it('exports a catalogue KEY rather than an English sentence', () => {
    // It used to export the sentence, which nine call sites rendered untranslated in every locale.
    // Asserting the shape is the point: a value containing a space would be prose again.
    expect(PERMISSION_DENIED_KEY).toBe('common.permission-denied');
    expect(PERMISSION_DENIED_KEY).not.toMatch(/\s/);
  });
});
