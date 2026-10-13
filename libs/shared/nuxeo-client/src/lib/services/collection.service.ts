import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, of, switchMap } from 'rxjs';

import { NuxeoDocument, NuxeoDocumentList } from '../models/document.model';
import { FAVORITES_COLLECTION_QUERY } from '../queries/nxql-queries';
import { NuxeoApiBase } from './nuxeo-api-base';

@Injectable({ providedIn: 'root' })
export class CollectionService {
  private readonly api = inject(NuxeoApiBase);
  private readonly http = inject(HttpClient);

  getById(uid: string): Observable<NuxeoDocument> {
    return this.api.get<NuxeoDocument>(`/nuxeo/api/v1/id/${uid}`, undefined, {
      properties: 'dublincore',
      'enrichers.document': 'permissions',
      'fetch-document': 'lock',
    });
  }

  getAll(pageSize = 100): Observable<NuxeoDocumentList> {
    const query =
      `SELECT * FROM Collection WHERE ecm:isTrashed = 0 ` +
      `AND ecm:currentLifeCycleState != 'deleted' ORDER BY dc:modified DESC`;
    return this.api.nxqlSearch(query, pageSize);
  }

  getFavorites(userId: string, pageSize = 10): Observable<NuxeoDocumentList> {
    const collectionQuery = FAVORITES_COLLECTION_QUERY.replace(/\{user\}/g, userId);

    return this.api.nxqlSearch(collectionQuery, 1).pipe(
      switchMap((res) => {
        const favCollection = res.entries[0];
        if (!favCollection) {
          return of({
            entries: [],
            totalSize: 0,
            currentPageSize: 0,
            currentPageIndex: 0,
            numberOfPages: 0,
          } satisfies NuxeoDocumentList);
        }
        return this.getCollectionMembers(favCollection.uid, pageSize);
      }),
    );
  }

  getCollectionMembers(collectionUid: string, pageSize = 50): Observable<NuxeoDocumentList> {
    const params = new HttpParams().set('queryParams', collectionUid).set('pageSize', pageSize);

    return this.api.get<NuxeoDocumentList>(
      '/nuxeo/api/v1/search/pp/default_content_collection/execute',
      params,
      { properties: 'dublincore' },
    );
  }

  updateProperties(uid: string, properties: Record<string, unknown>): Observable<NuxeoDocument> {
    return this.api.put<NuxeoDocument>(
      `/nuxeo/api/v1/id/${uid}`,
      { 'entity-type': 'document', properties },
      { 'Content-Type': 'application/json', properties: 'dublincore' },
    );
  }

  /**
   * Triggers a bulk download of all member documents in a collection,
   * returned as a zip file. Uses the Nuxeo `Blob.BulkDownload` automation.
   */
  bulkDownload(collectionUid: string, filename = 'export.zip'): Observable<Blob> {
    return this.http.post(
      this.api.apiUrl('/nuxeo/api/v1/automation/Blob.BulkDownload'),
      { params: { filename }, input: `docs:${collectionUid}` },
      { responseType: 'blob' },
    );
  }
}
