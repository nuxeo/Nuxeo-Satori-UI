import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import { NuxeoAcl } from '../models/acl.model';
import { NuxeoDocument } from '../models/document.model';
import {
  PrincipalPermissionPage,
  PrincipalPermissionRow,
} from '../models/principal-permissions.model';
import { AdministrationService } from './administration.service';
import { DocumentDetailService } from './document-detail.service';
import { matchesPrincipal } from '../utils/principal-match.utils';

function escapeNxqlString(s: string): string {
  return s.replace(/'/g, "''");
}

function extractLocalRows(doc: NuxeoDocument, logicalPrincipal: string): PrincipalPermissionRow[] {
  const acls = doc.contextParameters?.acls as NuxeoAcl[] | undefined;
  if (!acls?.length) return [];
  const local = acls.find((a) => a.name === 'local');
  if (!local?.aces?.length) return [];
  const rows: PrincipalPermissionRow[] = [];
  for (const ace of local.aces) {
    if (!ace.granted) continue;
    if (ace.status === 'archived') continue;
    if (!matchesPrincipal(ace.username, logicalPrincipal)) continue;
    rows.push({
      documentUid: doc.uid,
      documentTitle: doc.title || String(doc.properties?.['dc:title'] ?? doc.uid),
      documentPath: doc.path,
      permission: ace.permission,
      begin: ace.begin,
      end: ace.end,
      grantedBy: ace.creator,
      acePrincipal: ace.username,
      aceId: ace.id,
    });
  }
  return rows;
}

const emptyPage: PrincipalPermissionPage = {
  rows: [],
  totalDocuments: 0,
  numberOfPages: 0,
  currentPageIndex: 0,
  currentPageSize: 0,
};

@Injectable({ providedIn: 'root' })
export class PrincipalPermissionsService {
  private readonly admin = inject(AdministrationService);
  private readonly documents = inject(DocumentDetailService);

  /**
   * Lists local ACL rows for a user id or group name. Pagination applies to the NXQL document
   * result set; each document may contribute multiple table rows (one per ACE).
   */
  listLocalPermissionRows(
    logicalPrincipal: string,
    pageSize: number,
    currentPageIndex: number,
  ): Observable<PrincipalPermissionPage> {
    const e = escapeNxqlString(logicalPrincipal);
    const strict = `SELECT * FROM Document WHERE ecm:acl/*1/principal = '${e}' AND ecm:acl/*1/name = 'local'`;
    const withUserPrefix = `SELECT * FROM Document WHERE ecm:acl/*1/principal = 'user:${e}' AND ecm:acl/*1/name = 'local'`;
    const withGroupPrefix = `SELECT * FROM Document WHERE ecm:acl/*1/principal = 'group:${e}' AND ecm:acl/*1/name = 'local'`;
    const loose = `SELECT * FROM Document WHERE ecm:acl/*/principal = '${e}'`;

    const pickNext = (r: PrincipalPermissionPage | null): boolean =>
      r === null || r.totalDocuments === 0;

    return this.safeFetch(strict, logicalPrincipal, pageSize, currentPageIndex).pipe(
      switchMap((r) => {
        if (!pickNext(r)) return of(r as PrincipalPermissionPage);
        return this.safeFetch(withUserPrefix, logicalPrincipal, pageSize, currentPageIndex);
      }),
      switchMap((r) => {
        if (!pickNext(r)) return of(r as PrincipalPermissionPage);
        return this.safeFetch(withGroupPrefix, logicalPrincipal, pageSize, currentPageIndex);
      }),
      switchMap((r) => {
        if (!pickNext(r)) return of(r as PrincipalPermissionPage);
        return this.safeFetch(loose, logicalPrincipal, pageSize, currentPageIndex);
      }),
      map((r) => r ?? emptyPage),
      catchError(() => of(emptyPage)),
    );
  }

  private safeFetch(
    query: string,
    logicalPrincipal: string,
    pageSize: number,
    currentPageIndex: number,
  ): Observable<PrincipalPermissionPage | null> {
    return this.fetchPage(query, logicalPrincipal, pageSize, currentPageIndex).pipe(
      catchError(() => of(null)),
    );
  }

  private fetchPage(
    query: string,
    logicalPrincipal: string,
    pageSize: number,
    currentPageIndex: number,
  ): Observable<PrincipalPermissionPage> {
    return this.admin.nxqlSearch(query, pageSize, currentPageIndex, { properties: '*' }).pipe(
      switchMap((list) => {
        const entries = list.entries ?? [];
        const base: PrincipalPermissionPage = {
          rows: [],
          totalDocuments: list.totalSize ?? 0,
          numberOfPages: list.numberOfPages ?? 0,
          currentPageIndex: list.currentPageIndex ?? 0,
          currentPageSize: list.currentPageSize ?? entries.length,
        };
        if (entries.length === 0) return of(base);
        return forkJoin(entries.map((entry) => this.documents.getFullDocument(entry.uid))).pipe(
          map((docs) => {
            const rows: PrincipalPermissionRow[] = [];
            for (const doc of docs) {
              rows.push(...extractLocalRows(doc, logicalPrincipal));
            }
            return { ...base, rows };
          }),
        );
      }),
    );
  }
}
