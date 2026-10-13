import {
  ADD_CHILDREN,
  canAddChildren,
  canManageDocumentPermissions,
  canRemoveDocument,
  canShowRemoveDocumentAction,
  canShowWriteDocumentAction,
  canTagDocument,
  canViewDocumentAuditLog,
  canWriteDocument,
  hasDocumentPermission,
  hasDocumentPermissionsEnricher,
  isPermissionDeniedError,
  MANAGE_DOCUMENT_PERMISSIONS,
  READ_WRITE_DOCUMENT,
  WRITE_SECURITY,
  PERMISSION_DENIED_KEY,
  REMOVE_DOCUMENT,
  WRITE_DOCUMENT,
  WRITE_PROPERTIES,
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
