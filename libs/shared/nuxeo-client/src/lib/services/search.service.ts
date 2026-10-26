import { HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, forkJoin, map, of } from 'rxjs';
import type { NuxeoDocumentList } from '../models/document.model';
import type { AggregateResult } from '../models/asset.model';
import type { SearchAggregations, SearchResponse, SearchResultItem } from '../models/search.model';
import { NuxeoApiBase } from './nuxeo-api-base';
import { TagService } from './tag.service';
import { docTypeIcon } from '../constants/doc-type-icons';
import {
  NOTE_DOCUMENT_PICKER_HEADERS,
  NOTE_DOCUMENT_PICKER_PROVIDER,
  buildNoteDocumentPickerNxql,
  filterInsertablePictureDocuments,
  normalizeDocumentPickerList,
} from '../utils/note-document-picker-search';

export interface SearchQueryParams {
  q?: string;
  ecmFulltext?: string;
  quickFilters?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  modifiedDate?: string;
  author?: string;
  collection?: string;
  tag?: string;
  nature?: string;
  subjects?: string;
  coverage?: string;
  size?: string;
  pageIndex?: number;
  pageSize?: number;
}

export interface SearchCollectionOption {
  id: string;
  title: string;
  itemCount: number;
}

export interface SavedSearchOption {
  id: string;
  title: string;
  query?: string;
}

export interface SaveSavedSearchParams {
  title: string;
  params: Record<string, string>;
  pageProviderName?: string;
}

export interface GlobalSearchSuggestion {
  id: string;
  displayLabel: string;
  displayLabelHighlights?: Array<{ text: string; matched: boolean }>;
  pathHighlights?: Array<{ text: string; matched: boolean }>;
  kind: 'document' | 'user' | 'group' | 'other';
  documentUid?: string;
  path?: string;
  prefixedId?: string;
}

interface SearchApiResponse extends NuxeoDocumentList {
  aggregations?: Record<
    string,
    { buckets?: Array<{ key?: string; docCount?: number; doc_count?: number }> }
  >;
}

/**
 * Modification-date ranges under an earlier name, mapped to the bucket `default_search` defines.
 * Saved searches written before the rename still carry `moreThan1YearAgo`, which the server does
 * not know and would ignore — returning every document instead of the old ones.
 */
const MODIFIED_RANGE_ALIASES: Readonly<Record<string, string>> = {
  moreThan1YearAgo: 'priorToLastYear',
};

@Injectable({ providedIn: 'root' })
export class SearchService {
  private readonly api = inject(NuxeoApiBase);
  private readonly tags = inject(TagService);

  private readonly savedSearchHighlight =
    'dc:title.fulltext,ecm:binarytext,dc:description.fulltext,ecm:tag,note:note.fulltext,file:content.name';

  suggestFromSuggestersLauncher(
    searchTerm: string,
    pageSize = 10,
  ): Observable<GlobalSearchSuggestion[]> {
    const term = searchTerm.trim();
    if (!term) return of([]);

    return this.api
      .post<unknown>(
        '/nuxeo/api/v1/automation/Search.SuggestersLauncher',
        {
          params: { searchTerm: term },
          context: {},
        },
        {
          'Content-Type': 'application/json',
          properties: '*',
        },
      )
      .pipe(
        map((res) => this.normalizeSuggestions(res).slice(0, pageSize)),
        catchError(() => of<GlobalSearchSuggestion[]>([])),
      );
  }

  suggest(searchTerm: string, pageSize = 10): Observable<GlobalSearchSuggestion[]> {
    const term = searchTerm.trim();
    if (!term) return of([]);

    return this.suggestFromSuggestersLauncher(term, pageSize);
  }

  private suggestFallback(
    searchTerm: string,
    pageSize: number,
  ): Observable<GlobalSearchSuggestion[]> {
    const userGroup$ = this.api
      .post<unknown[]>(
        '/nuxeo/api/v1/automation/UserGroup.Suggestion',
        {
          params: { searchTerm, searchType: 'USER_GROUP_TYPE' },
          context: {},
        },
        {
          'Content-Type': 'application/json',
          properties: '*',
        },
      )
      .pipe(
        map((res) =>
          (Array.isArray(res) ? res : [])
            .map((item) => this.mapSuggestion(item))
            .filter((item): item is GlobalSearchSuggestion => item !== null),
        ),
        catchError(() => of<GlobalSearchSuggestion[]>([])),
      );

    const docsParams = new HttpParams()
      .set('query', searchTerm)
      .set('pageSize', pageSize)
      .set('currentPageIndex', 0);

    const docs$ = this.api
      .get<NuxeoDocumentList>('/nuxeo/api/v1/search/pp/default_search/execute', docsParams, {
        properties: 'dublincore',
      })
      .pipe(
        map((res) =>
          res.entries.map((doc) => ({
            id: doc.uid,
            displayLabel: doc.title || doc.uid,
            kind: 'document' as const,
            documentUid: doc.uid,
            path: doc.path,
          })),
        ),
        catchError(() => of<GlobalSearchSuggestion[]>([])),
      );

    return forkJoin([docs$, userGroup$]).pipe(
      map(([docs, usersAndGroups]) => [...docs, ...usersAndGroups].slice(0, pageSize)),
    );
  }

  getUserCollections(): Observable<SearchCollectionOption[]> {
    return this.api
      .post<NuxeoDocumentList>(
        '/nuxeo/api/v1/automation/User.GetCollections',
        { params: { searchTerm: '' }, context: {} },
        { 'Content-Type': 'application/json', properties: 'dublincore,collection' },
      )
      .pipe(
        map((res) =>
          res.entries.map((doc) => {
            const props = doc.properties ?? {};
            const ids = (props['collection:documentIds'] as string[] | undefined) ?? [];
            const title = doc.title ?? (props['dc:title'] as string | undefined) ?? doc.uid;
            return {
              id: doc.uid,
              title,
              itemCount: ids.length,
            } satisfies SearchCollectionOption;
          }),
        ),
      );
  }

  /**
   * Picture documents for the note RTE "insert from existing documents" picker.
   * Matches Web UI `nuxeo-document-picker` (`provider="document_picker"`,
   * `schemas="dublincore,file"`, `fulltext_all` param). Falls back to NXQL when the
   * ES-backed page provider is unavailable (`file:content` mapping errors).
   */
  searchDocumentPicker(
    options: {
      fulltext?: string;
      pageSize?: number;
      pageIndex?: number;
    } = {},
  ): Observable<NuxeoDocumentList> {
    const { fulltext = '', pageSize = 40, pageIndex = 0 } = options;
    const params = new HttpParams()
      .set('pageSize', pageSize)
      .set('currentPageIndex', pageIndex)
      .set('fulltext_all', fulltext.trim());

    return this.api
      .get<NuxeoDocumentList>(
        `/nuxeo/api/v1/search/pp/${NOTE_DOCUMENT_PICKER_PROVIDER}/execute`,
        params,
        { ...NOTE_DOCUMENT_PICKER_HEADERS },
      )
      .pipe(
        map((res) => this.normalizePicturePickerList(res, pageSize, pageIndex)),
        catchError(() => this.searchDocumentPickerNxql(fulltext, pageSize, pageIndex)),
      );
  }

  private normalizePicturePickerList(
    res: NuxeoDocumentList,
    pageSize: number,
    pageIndex: number,
  ): NuxeoDocumentList {
    const list = normalizeDocumentPickerList(res, pageSize, pageIndex);
    const entries = filterInsertablePictureDocuments(list.entries);
    return { ...list, entries };
  }

  private searchDocumentPickerNxql(
    fulltext: string,
    pageSize: number,
    pageIndex: number,
  ): Observable<NuxeoDocumentList> {
    const params = new HttpParams()
      .set('query', buildNoteDocumentPickerNxql(fulltext))
      .set('pageSize', pageSize)
      .set('currentPageIndex', pageIndex);

    return this.api
      .get<NuxeoDocumentList>('/nuxeo/api/v1/search/lang/NXQL/execute', params, {
        properties: 'dublincore,file',
        'enrichers.document': 'thumbnail',
      })
      .pipe(map((res) => this.normalizePicturePickerList(res, pageSize, pageIndex)));
  }

  getSavedSearches(pageProvider = 'default_search'): Observable<SavedSearchOption[]> {
    const params = new HttpParams().set('pageProvider', pageProvider);

    return this.api
      .get<{ entries: Array<Record<string, unknown>> }>('/nuxeo/api/v1/search/saved', params, {
        properties: '*',
        'enrichers.document': 'thumbnail,permissions,highlight',
      })
      .pipe(
        map((res) =>
          (res.entries ?? [])
            .map((doc) => {
              // Saved search API returns entries with `id`; document API returns `uid`.
              const id = this.asString(doc['id']) ?? this.asString(doc['uid']) ?? '';
              const title = this.asString(doc['title']) ?? id;
              const props = (doc['properties'] as Record<string, unknown>) ?? {};
              const query = this.firstString(
                props['contentview:query'],
                props['savedsearch:query'],
                props['search:query'],
                doc['query'],
              );

              return { id, title, query } satisfies SavedSearchOption;
            })
            .filter((item) => item.id.length > 0),
        ),
        catchError(() => of<SavedSearchOption[]>([])),
      );
  }

  getSavedSearchById(id: string): Observable<Record<string, string>> {
    const encodedId = encodeURIComponent(id);

    return this.api
      .get<Record<string, unknown>>(`/nuxeo/api/v1/search/saved/${encodedId}`, undefined, {
        properties: '*',
        'enrichers.document': 'thumbnail,permissions,highlight',
      })
      .pipe(
        map((saved) => {
          const props = (saved['properties'] as Record<string, unknown>) ?? {};

          const paramsRecord = saved['params'];
          if (paramsRecord && typeof paramsRecord === 'object') {
            const result: Record<string, string> = {};
            for (const [key, value] of Object.entries(paramsRecord as Record<string, unknown>)) {
              if (key !== 'highlight' && value !== null && value !== undefined) {
                // A list as JSON, not `String(list)`, which joins on commas and so splits a value
                // that contains one. An empty list stays an empty string, as it always read.
                result[key] = Array.isArray(value)
                  ? value.length > 0
                    ? JSON.stringify(value)
                    : ''
                  : String(value);
              }
            }
            return result;
          }

          const namedParams = props['savedsearch:namedParams'];
          if (Array.isArray(namedParams)) {
            const result: Record<string, string> = {};
            for (const entry of namedParams as Array<Record<string, unknown>>) {
              const key = typeof entry['key'] === 'string' ? entry['key'] : null;
              const value = entry['value'];
              if (key && key !== 'highlight' && value !== null && value !== undefined) {
                result[key] = String(value);
              }
            }
            return result;
          }

          return {};
        }),
        catchError(() => of<Record<string, string>>({})),
      );
  }

  saveSavedSearch(request: SaveSavedSearchParams): Observable<unknown> {
    const { title, params, pageProviderName = 'default_search' } = request;

    return this.api.post<unknown>(
      '/nuxeo/api/v1/search/saved',
      {
        'entity-type': 'savedSearch',
        pageProviderName,
        params: {
          ...params,
          highlight: this.savedSearchHighlight,
        },
        title,
      },
      {
        'Content-Type': 'application/json',
        accept: 'text/plain, application/json',
        properties: '*',
      },
    );
  }

  updateSavedSearch(id: string, request: SaveSavedSearchParams): Observable<unknown> {
    const encodedId = encodeURIComponent(id);
    const { title, params, pageProviderName = 'default_search' } = request;

    return this.api.put<unknown>(
      `/nuxeo/api/v1/search/saved/${encodedId}`,
      {
        'entity-type': 'savedSearch',
        pageProviderName,
        params: {
          ...params,
          highlight: this.savedSearchHighlight,
        },
        title,
      },
      {
        'Content-Type': 'application/json',
        accept: 'text/plain, application/json',
        properties: '*',
      },
    );
  }

  /**
   * Renames a saved search and leaves its filters as stored. The request carries no `params`, so
   * the server keeps the ones it has — whichever application wrote them.
   */
  renameSavedSearch(
    id: string,
    title: string,
    pageProviderName = 'default_search',
  ): Observable<unknown> {
    return this.api.put<unknown>(
      `/nuxeo/api/v1/search/saved/${encodeURIComponent(id)}`,
      { 'entity-type': 'savedSearch', pageProviderName, title },
      { 'Content-Type': 'application/json', accept: 'text/plain, application/json' },
    );
  }

  deleteSavedSearch(id: string): Observable<unknown> {
    const encodedId = encodeURIComponent(id);
    return this.api.delete<unknown>(`/nuxeo/api/v1/search/saved/${encodedId}`);
  }

  search(params: SearchQueryParams): Observable<SearchResponse> {
    const {
      q = '',
      ecmFulltext = '',
      quickFilters = '',
      sortBy = 'dc:created',
      sortOrder = 'desc',
      modifiedDate = '',
      author = '',
      collection = '',
      tag = '',
      nature = '',
      subjects = '',
      coverage = '',
      size = '',
      pageIndex = 0,
      pageSize = 40,
    } = params;

    // A list is a JSON array, which keeps a value containing a comma whole, or comma-separated.
    const parseList = (value: string): string[] => {
      const text = value.trim();
      if (text.startsWith('[')) {
        try {
          const parsed: unknown = JSON.parse(text);
          if (Array.isArray(parsed)) {
            return parsed
              .filter((entry): entry is string => typeof entry === 'string')
              .map((v) => v.trim())
              .filter(Boolean);
          }
        } catch {
          // Not JSON: read it as comma-separated below.
        }
      }
      return text
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    };

    let httpParams = new HttpParams()
      .set('currentPageIndex', pageIndex)
      .set('offset', pageIndex * pageSize)
      .set('pageSize', pageSize)
      .set('sortBy', sortBy)
      .set('sortOrder', sortOrder)
      .set('quickFilters', quickFilters.trim());

    const modifiedDateValues = [
      ...new Set(parseList(modifiedDate).map((value) => MODIFIED_RANGE_ALIASES[value] ?? value)),
    ];
    // One author, collection or tag as before, or several as a JSON array — never split on commas,
    // which a username or a tag label may contain.
    const parseValues = (value: string): string[] =>
      value.trim().startsWith('[') ? parseList(value) : value.trim() ? [value.trim()] : [];
    const authorValues = [...new Set(parseValues(author))];
    const collectionValues = [...new Set(parseValues(collection))];
    const tagValues = [...new Set(parseValues(tag))];
    const natureValues = parseList(nature);
    const subjectValues = parseList(subjects);
    const coverageValues = parseList(coverage);
    const sizeValues = parseList(size);

    if (modifiedDateValues.length > 0) {
      httpParams = httpParams.set('dc_modified_agg', JSON.stringify(modifiedDateValues));
    }

    if (authorValues.length > 0) {
      httpParams = httpParams.set('dc_creator_agg', JSON.stringify(authorValues));
    }

    // `ecm_collections` is the parameter `default_search` filters collection membership on, as
    // Web UI's search form sends it. It has no aggregate, so there is no `collection_agg` bucket.
    if (collectionValues.length > 0) {
      httpParams = httpParams.set('ecm_collections', JSON.stringify(collectionValues));
    }

    if (natureValues.length > 0) {
      httpParams = httpParams.set('dc_nature_agg', JSON.stringify(natureValues));
    }

    if (coverageValues.length > 0) {
      httpParams = httpParams.set('dc_coverage_agg', JSON.stringify(coverageValues));
    }

    if (sizeValues.length > 0) {
      httpParams = httpParams.set('common_size_agg', JSON.stringify(sizeValues));
    }

    if (subjectValues.length > 0) {
      httpParams = httpParams.set('dc_subjects_agg', JSON.stringify([...new Set(subjectValues)]));
    }

    if (tagValues.length > 0) {
      httpParams = httpParams.set('ecm_tags', JSON.stringify(tagValues));
    }

    if (q.trim()) {
      httpParams = httpParams.set('query', q.trim());
    }

    // Dashes become spaces, as Web UI's `formatFulltext` does: Nuxeo reads `-word` as an exclusion.
    const fulltext = ecmFulltext.replace(/-/g, ' ').trim();
    if (fulltext) {
      httpParams = httpParams.set('ecm_fulltext', fulltext);
    }

    return this.api
      .get<SearchApiResponse>('/nuxeo/api/v1/search/pp/default_search/execute', httpParams, {
        properties: 'dublincore,file,common',
        'enrichers.document': 'favorites',
      })
      .pipe(
        map((res) => ({
          items: res.entries.map((doc) => {
            const props = doc.properties ?? {};
            const fileContent = props['file:content'] as {
              'mime-type'?: string;
              length?: number | string;
            } | null;
            const tags = (props['dc:subjects'] as string[] | undefined) ?? [];
            const lastContributor = this.asPrincipalName(props['dc:lastContributor']);
            const author = this.asPrincipalName(props['dc:creator']);
            const major = props['uid:major_version'];
            const minor = props['uid:minor_version'];
            const version =
              typeof major === 'number' && typeof minor === 'number'
                ? `${major}.${minor}`
                : undefined;

            return {
              id: doc.uid,
              title: doc.title,
              type: doc.type,
              path: doc.path,
              isFavorite: doc.contextParameters?.favorites?.isFavorite ?? false,
              modifiedDate: doc.lastModified?.slice(0, 10) ?? '',
              sizeInBytes: this.parseSizeInBytes(fileContent?.length),
              lastContributor,
              createdDate:
                typeof props['dc:created'] === 'string'
                  ? (props['dc:created'] as string).slice(0, 10)
                  : undefined,
              author,
              authorKey: author.toLowerCase(),
              state:
                typeof props['ecm:currentLifeCycleState'] === 'string'
                  ? (props['ecm:currentLifeCycleState'] as string)
                  : undefined,
              version,
              nature:
                typeof props['dc:nature'] === 'string' ? (props['dc:nature'] as string) : undefined,
              coverage:
                typeof props['dc:coverage'] === 'string'
                  ? (props['dc:coverage'] as string)
                  : undefined,
              subjects: tags.join(', ') || undefined,
              flags: undefined,
              collection: Array.isArray(props['collection:documentIds'])
                ? (props['collection:documentIds'] as string[]).join(',')
                : ((props['collection:documentIds'] as string) ?? ''),
              collectionKey: Array.isArray(props['collection:documentIds'])
                ? (props['collection:documentIds'] as string[]).join(',').toLowerCase()
                : ((props['collection:documentIds'] as string) ?? '').toLowerCase(),
              tags,
              icon: docTypeIcon(doc.type),
            } satisfies SearchResultItem;
          }),
          aggregations: this.normalizeAggregations(res.aggregations),
          totalSize:
            typeof res.resultsCount === 'number' ? res.resultsCount : (res.totalSize ?? -1),
          hasNextPage: res.isNextPageAvailable === true,
        })),
      );
  }

  /**
   * Tag labels that start with `term`, from `TagService.suggestTags` (Nuxeo's `Tag.Suggestion`) —
   * what Web UI's search form offers in its Tags field. Empty for a blank term, and on failure, so a
   * typeahead stays usable.
   */
  getTagSuggestions(term: string): Observable<string[]> {
    const searchTerm = term.trim();
    if (!searchTerm) return of([]);
    return this.tags.suggestTags(searchTerm).pipe(catchError(() => of<string[]>([])));
  }

  private asPrincipalName(value: unknown): string {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object') return '';

    const principal = value as {
      name?: string;
      id?: string;
      properties?: { username?: string };
    };

    return principal.name ?? principal.properties?.username ?? principal.id ?? '';
  }

  private parseSizeInBytes(value: unknown): number | undefined {
    if (typeof value === 'number') {
      return Number.isFinite(value) && value >= 0 ? value : undefined;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
    }
    return undefined;
  }

  private firstString(...values: unknown[]): string | undefined {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) {
        return value;
      }
    }
    return undefined;
  }

  private normalizeAggregations(
    aggregations?: SearchApiResponse['aggregations'],
  ): SearchAggregations {
    const toAggregate = (agg?: {
      buckets?: Array<{ key?: string; docCount?: number; doc_count?: number }>;
    }): AggregateResult | undefined => {
      if (!agg?.buckets?.length) return undefined;
      return {
        buckets: agg.buckets
          .filter(
            (b): b is { key: string; docCount?: number; doc_count?: number } =>
              typeof b.key === 'string',
          )
          .map((b) => ({
            key: b.key,
            docCount: typeof b.docCount === 'number' ? b.docCount : (b.doc_count ?? 0),
          })),
      };
    };

    return {
      dc_modified_agg: toAggregate(aggregations?.['dc_modified_agg']),
      dc_creator_agg: toAggregate(aggregations?.['dc_creator_agg']),
      collection_agg: toAggregate(aggregations?.['collection_agg']),
      dc_nature_agg: toAggregate(aggregations?.['dc_nature_agg']),
      dc_coverage_agg: toAggregate(aggregations?.['dc_coverage_agg']),
      dc_subjects_agg: toAggregate(aggregations?.['dc_subjects_agg']),
      common_size_agg: toAggregate(aggregations?.['common_size_agg']),
    };
  }

  private normalizeSuggestions(payload: unknown): GlobalSearchSuggestion[] {
    const items = this.extractSuggestionItems(payload);
    const suggestions: GlobalSearchSuggestion[] = [];

    for (const item of items) {
      const mapped = this.mapSuggestion(item);
      if (mapped) suggestions.push(mapped);
    }

    return suggestions;
  }

  private extractSuggestionItems(payload: unknown): unknown[] {
    if (Array.isArray(payload)) {
      const directItems = payload.filter((item) => this.looksLikeSuggestionItem(item));
      if (directItems.length > 0) {
        return directItems;
      }

      const nestedItems = payload
        .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
        .flatMap((item) => this.extractArraysFromContainer(item));

      return nestedItems;
    }
    if (!payload || typeof payload !== 'object') return [];

    const obj = payload as Record<string, unknown>;

    const arrays = this.extractArraysFromContainer(obj);

    if (arrays.length > 0) return arrays;

    return Object.values(obj)
      .filter(Array.isArray)
      .flatMap((value) => value as unknown[]);
  }

  private extractArraysFromContainer(container: Record<string, unknown>): unknown[] {
    const directArrayKeys = ['entries', 'results', 'suggestions', 'documents', 'users', 'groups'];
    return directArrayKeys
      .map((key) => container[key])
      .filter(Array.isArray)
      .flatMap((value) => value as unknown[]);
  }

  private looksLikeSuggestionItem(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    const item = value as Record<string, unknown>;
    return (
      typeof item['id'] === 'string' ||
      typeof item['uid'] === 'string' ||
      typeof item['username'] === 'string' ||
      typeof item['groupname'] === 'string' ||
      typeof item['prefixed_id'] === 'string'
    );
  }

  private mapSuggestion(value: unknown): GlobalSearchSuggestion | null {
    if (!value || typeof value !== 'object') return null;

    const item = value as Record<string, unknown>;
    const properties = (item['properties'] as Record<string, unknown> | undefined) ?? {};

    const typeValue = this.asString(item['type']) ?? this.asString(item['entity-type']) ?? '';
    const id =
      this.asString(item['id']) ??
      this.asString(item['uid']) ??
      this.asString(item['username']) ??
      this.asString(item['groupname']) ??
      this.asString(item['prefixed_id']);

    if (!id) return null;

    const displayLabel =
      this.asString(item['displayLabel']) ??
      this.asString(item['title']) ??
      this.asString(properties['dc:title']) ??
      id;

    const highlightsByField = this.extractHighlightsByField(item);
    const displayLabelHighlights =
      this.pickHighlightParts(highlightsByField, [
        'dc:title',
        'file:content.name',
        'displayLabel',
        'label',
        'username',
        'groupname',
      ]) ?? undefined;
    const pathHighlights =
      this.pickHighlightParts(highlightsByField, ['ecm:path', 'path', 'url']) ?? undefined;

    const prefixedId = this.asString(item['prefixed_id']);
    const path =
      this.asString(item['path']) ??
      this.asString(properties['ecm:path']) ??
      this.asString(item['url']);
    const typeUpper = typeValue.toUpperCase();
    const isGroup =
      typeUpper.includes('GROUP') ||
      typeof item['groupname'] === 'string' ||
      prefixedId?.startsWith('group:') === true;
    const isUser =
      typeUpper.includes('USER') ||
      typeof item['username'] === 'string' ||
      prefixedId?.startsWith('user:') === true;
    const documentUid =
      this.asString(item['uid']) ?? (typeUpper.includes('DOCUMENT') ? id : undefined);

    return {
      id,
      displayLabel,
      displayLabelHighlights,
      kind: isGroup ? 'group' : isUser ? 'user' : documentUid ? 'document' : 'other',
      documentUid,
      path,
      pathHighlights,
      prefixedId,
    };
  }

  private extractHighlightsByField(item: Record<string, unknown>): Map<string, string[]> {
    const map = new Map<string, string[]>();
    const rawHighlights = item['highlights'];

    if (Array.isArray(rawHighlights)) {
      for (const entry of rawHighlights) {
        if (!entry || typeof entry !== 'object') continue;
        const obj = entry as Record<string, unknown>;
        const field = this.asString(obj['field']);
        const segments = Array.isArray(obj['segments'])
          ? (obj['segments'] as unknown[])
              .filter((segment): segment is string => typeof segment === 'string')
              .map((segment) => segment.trim())
              .filter(Boolean)
          : [];
        if (!field || segments.length === 0) continue;
        map.set(field, segments);
      }
      return map;
    }

    if (rawHighlights && typeof rawHighlights === 'object') {
      const obj = rawHighlights as Record<string, unknown>;
      for (const [field, value] of Object.entries(obj)) {
        if (!field) continue;
        const segments = Array.isArray(value)
          ? (value as unknown[])
              .filter((segment): segment is string => typeof segment === 'string')
              .map((segment) => segment.trim())
              .filter(Boolean)
          : [];
        if (segments.length === 0) continue;
        map.set(field, segments);
      }
    }

    return map;
  }

  private pickHighlightParts(
    highlightsByField: Map<string, string[]>,
    candidateFields: string[],
  ): Array<{ text: string; matched: boolean }> | null {
    for (const field of candidateFields) {
      const segments = highlightsByField.get(field);
      if (!segments || segments.length === 0) continue;
      const parts = this.toHighlightParts(segments.join(' '));
      if (parts.length > 0) return parts;
    }
    return null;
  }

  private toHighlightParts(input: string): Array<{ text: string; matched: boolean }> {
    const html = input.trim();
    if (!html) return [];

    const parts: Array<{ text: string; matched: boolean }> = [];
    const re = /<em>(.*?)<\/em>/gi;
    let lastIndex = 0;
    let match: RegExpExecArray | null = null;

    while ((match = re.exec(html)) !== null) {
      const start = match.index;
      const end = re.lastIndex;

      if (start > lastIndex) {
        const plain = this.stripTags(html.slice(lastIndex, start));
        if (plain) parts.push({ text: plain, matched: false });
      }

      const highlighted = this.stripTags(match[1] ?? '');
      if (highlighted) parts.push({ text: highlighted, matched: true });
      lastIndex = end;
    }

    if (lastIndex < html.length) {
      const plain = this.stripTags(html.slice(lastIndex));
      if (plain) parts.push({ text: plain, matched: false });
    }

    if (parts.length === 0) {
      const plain = this.stripTags(html);
      return plain ? [{ text: plain, matched: false }] : [];
    }

    return parts;
  }

  private stripTags(value: string): string {
    if (!value) {
      return '';
    }

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(value, 'text/html');
      return doc.body.textContent ?? '';
    } catch {
      // Fallback to the original value if DOMParser is unavailable or parsing fails.
      return value;
    }
  }

  private asString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
}
