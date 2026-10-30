/** One row in Administration “Local permissions” tables (user or group principal). */
export interface PrincipalPermissionRow {
  documentUid: string;
  documentTitle: string;
  documentPath: string;
  permission: string;
  begin: string | null;
  end: string | null;
  grantedBy: string | null;
  /** Exact ACE username field — required for `Document.RemovePermission`. */
  acePrincipal: string;
  /** The ACE's Nuxeo id, which removes exactly this entry; see `DocumentDetailService.removePermissionById`. */
  aceId: string;
}

export interface PrincipalPermissionPage {
  rows: PrincipalPermissionRow[];
  totalDocuments: number;
  numberOfPages: number;
  currentPageIndex: number;
  currentPageSize: number;
}
