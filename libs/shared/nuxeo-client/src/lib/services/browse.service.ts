import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import {
  EMPTY,
  Observable,
  timer,
  switchMap,
  map,
  of,
  throwError,
  expand,
  reduce,
  forkJoin,
} from 'rxjs';
import { catchError } from 'rxjs/operators';

import { NuxeoDocument, NuxeoDocumentList } from '../models/document.model';
import { NuxeoApiBase } from './nuxeo-api-base';
import { resolveCreatableSubtypes } from '../utils/creatable-subtypes';
import { isUserWorkspacePath } from '../utils/browse-path.utils';
import { escapeNxqlLiteral } from '../utils/nxql.utils';
import { isFolderishDocument, isBrowsableNavNode } from './document-import.service';

export interface NavTreeBootstrap {
  root: NuxeoDocument;
  entries: NuxeoDocument[];
  /**
   * Whether the source held more than `entries` — the server's own word, not a guess.
   *
   * `pageOfFullList()` can only see the array it is handed, so a full page reads as "nothing
   * more": with 501 accessible top-level workspaces and a page size of 500 it concluded
   * `hasNextPage: false`, and a 500-document scan then reported `truncated: false` and silently
   * omitted the 501st with no partial-scan notice.
   */
  hasMore?: boolean;
}

/** The browse toolbar's filters, as the server takes them. */
export interface BrowseFolderFilters {
  /** Substring of `dc:title`, matched case-insensitively. */
  text?: string;
  /** Exact `ecm:primaryType`. */
  type?: string;
  /** Inclusive lower bound on `dc:modified`. */
  modifiedFrom?: Date | null;
  /** Inclusive upper bound on `dc:modified`; the whole of that day counts. */
  modifiedTo?: Date | null;
  /** Substring of `dc:lastContributor`, matched case-insensitively. */
  contributor?: string;
}

/** Whether any filter would narrow the listing. */
export function browseFolderFiltersActive(filters?: BrowseFolderFilters): boolean {
  if (!filters) return false;
  return (
    !!filters.text?.trim() ||
    !!filters.type ||
    !!filters.modifiedFrom ||
    !!filters.modifiedTo ||
    !!filters.contributor?.trim()
  );
}

/**
 * Escape a value for use inside a single-quoted NXQL `LIKE`/`ILIKE` **pattern**.
 *
 * Four characters, in one pass: the backslash and the quote that would end the literal, and the
 * two wildcards. Measured against the server: `ILIKE '%P_oject%'` and `ILIKE '%Pro%ect%'` both
 * match "Project Reports", so an unescaped `_` or `%` typed into the filter box silently becomes a
 * wildcard — and `ILIKE '%Pro\%ect%'` matches nothing, so a backslash is what makes them literal.
 * There is no `ESCAPE` clause: `ESCAPE '!'` is rejected.
 *
 * ## One pass, not `escapeNxqlLiteral` plus the wildcards
 *
 * It used to be `escapeNxqlLiteral(value).replace(/[%_]/g, '\\$&')`, which produces an identical
 * string — verified over every interesting input and 60k fuzzed ones — but only because
 * `escapeNxqlLiteral` happens to double backslashes *first*. The correctness of this function
 * therefore lived in another function's internal ordering, where nothing would catch a change to
 * it, and CodeQL read the visible half as an incomplete escape (alert 63) because that is what it
 * is in isolation.
 *
 * A single pass over the original string cannot re-process a backslash it just inserted, so the
 * order that mattered no longer exists.
 */
export function escapeNxqlPattern(value: string): string {
  return value.replace(/[\\'%_]/g, '\\$&');
}

/** One server-side sort key: a Nuxeo property name such as `dc:title`, and its direction. */
export interface BrowseSortEntry {
  sortBy: string;
  sortOrder: 'ASC' | 'DESC';
}

/**
 * Which page of a browse listing to fetch, and in which server-side order.
 *
 * Every browse source honours both — ordinary folders through `@children`, `Root` through the
 * `tree_children` page provider, `Domain` through `@children`, and `Favorites` and `Collection`
 * through `default_content_collection` — so a listing never has to sort a page in the browser.
 */
export interface BrowsePageRequest {
  currentPageIndex?: number;
  sort?: BrowseSortEntry[];
}

export interface BrowseFolderContents {
  folder: NuxeoDocument;
  entries: NuxeoDocument[];
  /**
   * Nuxeo's own count, **negative when it did not count**.
   *
   * Real only when the folder fits on one page — `resultsCountLimit` is the requested `pageSize`.
   * Read `hasNextPage` for pagination rather than deriving a page count from this.
   */
  totalSize: number;
  /** Whether Nuxeo has another page. The only reliable pagination fact when `totalSize` is negative. */
  hasNextPage?: boolean;
  /** Present when a restricted user should land on their only accessible folder. */
  redirectTo?: string;
  /**
   * Whether the **server** applied the filters.
   *
   * False where the listing came from a source a filtered query cannot express — the repository
   * root, Favorites, a Collection — so the caller must still narrow what it was handed.
   */
  serverFiltered?: boolean;
}

/**
 * How many children the type dropdown reads to collect the types a container holds.
 *
 * The listing itself is filtered, counted and paged by the server, so nothing on screen depends on
 * this; it bounds one request whose only output is the set of options in a dropdown. A container
 * with more than this many children may therefore be missing an option that occurs only past the
 * bound — the rows, the count and the pages are unaffected, and the title filter still reaches
 * those documents.
 *
 * Measured against this Nuxeo: 66 children came back in 54 KB and 15 ms with no `properties` header
 * and no enrichers, against 151 KB for the same page with `properties: '*'` and `permissions` — so
 * the request asks for neither. `type` is a top-level field on every entry.
 */
export const BROWSE_TYPE_OPTION_LIMIT = 500;

/** True for Domain documents attached directly under the repository root. */
function isTopLevelDomain(doc: NuxeoDocument | null | undefined): boolean {
  if (!doc || doc.type !== 'Domain') {
    return false;
  }
  const path = (doc.path ?? '').replace(/\/+$/, '');
  const segments = path.split('/').filter(Boolean);
  // Path depth is stable across environments (local Docker uses a non-null root uid).
  if (segments.length === 1) {
    return true;
  }
  // Null-UUID parent sentinel used on some Nuxeo deployments (not universal).
  return doc.parentRef === NULL_REPOSITORY_ROOT_UID;
}

/** Parent-ref sentinel for top-level domains on deployments that use the null UUID root. */
const NULL_REPOSITORY_ROOT_UID = '00000000-0000-0000-0000-000000000000';

/**
 * Adds Nuxeo's `sortBy` and `sortOrder` to a page request: comma-separated lists of the same
 * length, which `@children` and every page provider read the same way.
 */
export function withSort(params: HttpParams, sort?: readonly BrowseSortEntry[]): HttpParams {
  if (!sort?.length) return params;
  return params
    .set('sortBy', sort.map((entry) => entry.sortBy).join(','))
    .set('sortOrder', sort.map((entry) => entry.sortOrder).join(','));
}

/** A property's value to sort by; `dc:title` and `dc:modified` also have a top-level field. */
function sortValue(doc: NuxeoDocument, property: string): string {
  const value = doc.properties?.[property];
  if (value !== undefined && value !== null) return String(value);
  if (property === 'dc:title') return doc.title ?? '';
  if (property === 'dc:modified') return doc.lastModified ?? '';
  return '';
}

/**
 * One page of a list that was read whole, in the order asked for. The repository-root fallback
 * reads every accessible top-level folder at once, so its page and sort are applied here; the
 * server pages and sorts every other listing.
 */
/** `YYYY-MM-DD HH:mm:ss` in UTC, which is how Nuxeo reads a `TIMESTAMP` literal. */
function nxqlTimestamp(value: Date): string {
  return value.toISOString().slice(0, 19).replace('T', ' ');
}

function pageOfFullList(
  entries: readonly NuxeoDocument[],
  pageSize: number,
  page?: BrowsePageRequest,
): { entries: NuxeoDocument[]; totalSize: number; hasNextPage: boolean } {
  const sorted = [...entries];
  for (const { sortBy, sortOrder } of [...(page?.sort ?? [])].reverse()) {
    const direction = sortOrder === 'DESC' ? -1 : 1;
    sorted.sort(
      (a, b) =>
        direction *
        sortValue(a, sortBy).localeCompare(sortValue(b, sortBy), undefined, {
          numeric: true,
          sensitivity: 'base',
        }),
    );
  }
  const start = Math.max(0, page?.currentPageIndex ?? 0) * pageSize;
  return {
    entries: sorted.slice(start, start + pageSize),
    totalSize: entries.length,
    hasNextPage: start + pageSize < entries.length,
  };
}

@Injectable({ providedIn: 'root' })
export class BrowseService {
  private readonly api = inject(NuxeoApiBase);
  private readonly http = inject(HttpClient);

  private static readonly ACCESSIBLE_DOMAINS_NXQL =
    'SELECT * FROM Domain WHERE ecm:isTrashed = 0 ORDER BY dc:title';

  private static readonly ACCESSIBLE_NAV_NODES_NXQL = [
    'SELECT * FROM Document',
    "WHERE ecm:mixinType != 'HiddenInNavigation'",
    'AND ecm:isTrashed = 0',
    "AND ecm:primaryType IN ('Domain', 'Workspace', 'Folder', 'OrderedFolder')",
    'ORDER BY ecm:path',
  ].join(' ');

  getByPath(nuxeoPath: string): Observable<NuxeoDocument> {
    const safePath = nuxeoPath.replace(/\/+$/, '') || '/';
    return this.api.get<NuxeoDocument>(`/nuxeo/api/v1/path${safePath}`, undefined, {
      properties: '*',
      // `breadcrumb` is what gives the trail its ancestors' *titles*. Without it a breadcrumb can
      // only decode path segments, which are the folders' names, not their titles — a renamed
      // folder reads as its old URL segment for every crumb above the current one. Nuxeo Web UI's
      // `nuxeo-breadcrumb` reads the same enricher, so the whole trail still costs one request.
      'enrichers.document': 'acls,permissions,favorites,subscribedNotifications,breadcrumb',
    });
  }

  /** Current user's personal workspace (Web UI: `User.GetUserWorkspace` automation). */
  getUserWorkspace(): Observable<NuxeoDocument> {
    return this.api.post<NuxeoDocument>('/nuxeo/api/v1/automation/User.GetUserWorkspace', {
      params: {},
      context: {},
    });
  }

  /**
   * Repository root for the browse nav tree. Users with domain-only ACLs may receive 403 on
   * `GET /path/` but can still resolve the root uid from an accessible Domain via NXQL.
   */
  getRepositoryRoot(): Observable<NuxeoDocument> {
    return this.getByPath('/').pipe(catchError(() => this.resolveRepositoryRootFromDomains()));
  }

  /**
   * Loads the browse nav tree root plus top-level folder entries. Handles administrators,
   * domain-scoped users, and read-only users who only have workspace/folder ACLs.
   */
  getNavTreeBootstrap(pageSize = 50): Observable<NavTreeBootstrap> {
    return this.getRepositoryRoot().pipe(
      catchError(() => of(this.syntheticRepositoryRoot())),
      switchMap((root) => this.loadNavTreeBootstrapEntries(root, pageSize)),
      catchError(() =>
        this.getAccessibleTopLevelNavNodes(pageSize).pipe(
          map(({ entries, hasMore }) => ({
            root: this.syntheticRepositoryRoot(entries),
            entries,
            hasMore,
          })),
        ),
      ),
    );
  }

  /**
   * Loads the current browse folder and its children. When repository root is not readable,
   * falls back to accessible top-level folders (User Workspaces, domain-scoped ACLs, etc.).
   */
  getBrowseFolderContents(
    nuxeoPath: string,
    pageSize = 50,
    page?: BrowsePageRequest,
    filters?: BrowseFolderFilters,
  ): Observable<BrowseFolderContents> {
    const safePath = nuxeoPath.replace(/\/+$/, '') || '/';

    return this.getByPath(safePath).pipe(
      switchMap((folder) =>
        this.listBrowseFolderEntries(folder, safePath, pageSize, page, filters).pipe(
          // Spread rather than destructure: picking named fields is what dropped `hasNextPage`
          // on its way out, so the pager saw `undefined` and never offered a next page.
          map((page) => ({ folder, ...page })),
        ),
      ),
      catchError((error: unknown) => {
        // Nuxeo's own error, so a caller can tell "may not read this" (403) from "not there" (404)
        // from a failure; a replacement Error carried no status.
        if (safePath !== '/') {
          return throwError(() => error);
        }
        return this.getNavTreeBootstrap(pageSize).pipe(
          map(({ root, entries }) => {
            const paged = pageOfFullList(entries, pageSize, page);
            return {
              folder: root,
              // `...paged` carries `hasNextPage`, and is deliberately the only thing that sets it.
              //
              // It used to be `paged.hasNextPage || hasMore === true`, so the folder scan could
              // tell a truncated bootstrap from a complete one. The scan is gone, and for the
              // pager — now the only reader — that OR was a defect:
              // `getAccessibleTopLevelNavNodes` fetches **one** page and `nxqlSearch` takes no
              // page index, so wherever `hasMore` was true, page 1 sliced past a `pageSize`-long
              // array, rendered no rows, and still offered a next page. Endless empty pages, each
              // one re-requesting page zero.
              //
              // So this reports only pages it can actually hand over. Where the bootstrap source
              // was truncated, the listing then shows its first `pageSize` accessible nodes and
              // says nothing about the rest — a real limitation, and the lesser one, because this
              // fallback cannot page its source at all. `getNavTreeBootstrap` still returns
              // `hasMore` for a caller that pages the list itself.
              ...paged,
              redirectTo: entries.length === 1 ? entries[0].path : undefined,
              // The bootstrap is not a query, so the caller still has to narrow this itself. It
              // hands back the whole accessible list, so narrowing it client-side is complete.
              serverFiltered: false,
            };
          }),
        );
      }),
    );
  }

  /**
   * Every document type a container holds, for the browse toolbar's type dropdown.
   *
   * Its own request because the listing is now filtered by the server: under an active type filter
   * the rows on screen are all of that one type, so options built from them would collapse to the
   * type already chosen and leave no other to pick. Nothing else reads this — not the rows, the
   * count, the pages, nor selection — so a stale or failed answer can only leave the dropdown
   * offering what the current page shows, which is what it offered before any of this.
   *
   * One request, bounded by {@link BROWSE_TYPE_OPTION_LIMIT}, and the server cannot make it
   * smaller: `Repository.Query` takes `SELECT *` only. `SELECT DISTINCT ecm:primaryType` and a bare
   * `SELECT ecm:primaryType` both answer 200 with **zero** rows rather than an error, and
   * `GROUP BY` fails the operation outright — all three measured, which is why this reads the
   * documents and collects the types here.
   *
   * A container whose listing no query reproduces (the repository root) answers an empty list, and
   * the caller falls back to the types on its page.
   */
  getBrowseFolderTypes(
    nuxeoPath: string,
    maxDocuments = BROWSE_TYPE_OPTION_LIMIT,
  ): Observable<string[]> {
    const safePath = nuxeoPath.replace(/\/+$/, '') || '/';
    return this.getByPath(safePath).pipe(
      switchMap((folder) => {
        const scopeClause =
          folder.uid && folder.uid !== 'virtual-root' ? this.filteredScopeClause(folder) : null;
        if (!scopeClause) return of<string[]>([]);
        return this.api
          .post<NuxeoDocumentList>('/nuxeo/api/v1/automation/Repository.Query', {
            params: {
              // No filters: the same scope, trashed and hidden rules the filtered listing uses, so
              // the options can never describe a different set of documents than the rows do.
              query: this.buildFilteredChildrenQuery(scopeClause, {}),
              pageSize: maxDocuments,
            },
          })
          .pipe(
            // No `properties` header and no enrichers on purpose — see BROWSE_TYPE_OPTION_LIMIT.
            map((list) =>
              Array.from(
                new Set((list.entries ?? []).map((doc) => doc.type).filter(Boolean)),
              ).sort(),
            ),
          );
      }),
    );
  }

  /**
   * The NXQL clause that picks out one container's own listing, or `null` for a container whose
   * listing a query cannot reproduce.
   *
   * Two shapes, because the two container kinds list by different relations: an ordinary folder or
   * Domain lists what it *contains*, and a Collection or Favorites lists what *belongs* to it.
   * `collectionMember:collectionIds` was measured against `default_content_collection`, the page
   * provider the unfiltered listing uses, on every collection in this repository — Administrator's
   * Favorites (4 members), a fixture collection (1) and three empty ones — and agreed on all five,
   * uid for uid.
   *
   * `Root` returns `null` and keeps its client-side filter. `tree_children` lists only the root's
   * **Folderish** children (`docs/api-integrations.md`), so a containment query there could show a
   * file the unfiltered listing does not; and a user who cannot read the root never reaches this
   * code at all — `getBrowseFolderContents` falls back to the bootstrap, which hands back the whole
   * accessible list in one go, so narrowing that client-side is already complete.
   */
  private filteredScopeClause(folder: NuxeoDocument): string | null {
    if (folder.type === 'Root') return null;
    if (folder.type === 'Favorites' || folder.type === 'Collection') {
      return `collectionMember:collectionIds = '${escapeNxqlLiteral(folder.uid)}'`;
    }
    return `ecm:parentId = '${escapeNxqlLiteral(folder.uid)}'`;
  }

  /**
   * The NXQL a filtered listing runs, around whichever scope clause selects the container.
   *
   * Every property name here has been run against the server, because a wrong one is not an
   * error on the index-backed endpoint — it answers 200 with zero rows. (On
   * `Repository.Query` it does fail loudly: `dc:nosuchfield` returns "Failed to invoke
   * operation", which is the better of the two behaviours.) Verified: `ecm:parentId`,
   * `collectionMember:collectionIds`, `ecm:isTrashed`, `dc:title`, `ecm:primaryType`,
   * `dc:modified`, `dc:lastContributor`.
   *
   * `TIMESTAMP` literals are read as **UTC**, measured on a host at +0530: the newest child's
   * `dc:modified` rendered in UTC matched at minus one minute and not at plus one. So the picked
   * `Date`'s instant is formatted from its UTC components, which keeps the boundary exactly where
   * the previous client-side comparison of `getTime()` values put it.
   */
  private buildFilteredChildrenQuery(
    scopeClause: string,
    filters: BrowseFolderFilters,
    sort?: BrowseSortEntry[],
  ): string {
    const clauses = [
      scopeClause,
      'ecm:isTrashed = 0',
      // `@children` applies this and a raw `ecm:parentId` query does not, so without it a filter
      // shows documents the unfiltered listing hides. Measured on `/default-domain`: the bare
      // query answered 10 children against the listing's 8, the two extras being the `CommentRoot`
      // and `UserWorkspacesRoot` system containers; with this clause it answers the same 8, and an
      // `ecm:parentId` query on the repository root likewise drops from 7 to the 3 domains
      // `tree_children` lists. Every other NXQL in this service carries it for the same reason.
      "ecm:mixinType != 'HiddenInNavigation'",
    ];

    const text = filters.text?.trim();
    if (text) {
      clauses.push(`dc:title ILIKE '%${escapeNxqlPattern(text)}%'`);
    }
    if (filters.type) {
      clauses.push(`ecm:primaryType = '${escapeNxqlLiteral(filters.type)}'`);
    }
    if (filters.modifiedFrom) {
      clauses.push(`dc:modified >= TIMESTAMP '${nxqlTimestamp(filters.modifiedFrom)}'`);
    }
    if (filters.modifiedTo) {
      // Exclusive upper bound one day on, so the whole of the chosen day counts — the same
      // arithmetic the client-side filter used.
      const endOfDay = new Date(filters.modifiedTo.getTime() + 86_400_000);
      clauses.push(`dc:modified < TIMESTAMP '${nxqlTimestamp(endOfDay)}'`);
    }
    const contributor = filters.contributor?.trim();
    if (contributor) {
      clauses.push(`dc:lastContributor ILIKE '%${escapeNxqlPattern(contributor)}%'`);
    }

    const order = (sort ?? [])
      .map((entry) => `${entry.sortBy} ${entry.sortOrder === 'DESC' ? 'DESC' : 'ASC'}`)
      .join(', ');
    return (
      `SELECT * FROM Document WHERE ${clauses.join(' AND ')}` + (order ? ` ORDER BY ${order}` : '')
    );
  }

  /**
   * One page of a folder's children, filtered and ordered by the **server**.
   *
   * `automation/Repository.Query` and not `search/lang/NXQL/execute`: the latter is
   * OpenSearch-backed and, measured on a live instance, disagrees with `@children` in both
   * directions — 91 documents against 66, 13 live children missing from the index and 38 trashed
   * ones still indexed as `ecm:isTrashed = 0` — so a filter evaluated there drops real documents
   * and resurrects deleted ones, and `ILIKE` silently returns nothing. `Repository.Query` returned
   * exactly the same 66 uids as `@children`, honours `ILIKE` case-insensitively, and answers a
   * filtered 500-row query in ~28 ms.
   */
  private getFilteredChildren(
    scopeClause: string,
    filters: BrowseFolderFilters,
    pageSize: number,
    page?: BrowsePageRequest,
  ): Observable<{ entries: NuxeoDocument[]; totalSize: number; hasNextPage: boolean }> {
    return this.api
      .post<NuxeoDocumentList>(
        '/nuxeo/api/v1/automation/Repository.Query',
        {
          params: {
            query: this.buildFilteredChildrenQuery(scopeClause, filters, page?.sort),
            pageSize,
            currentPageIndex: page?.currentPageIndex ?? 0,
          },
        },
        // The same enricher the unfiltered listing asks for, or a filtered row would carry no
        // `contextParameters.permissions` and its actions would vanish.
        { properties: '*', 'enrichers.document': 'permissions' },
      )
      .pipe(
        map((list) => ({
          entries: list.entries ?? [],
          // A real count, unlike `@children`'s `-2`: the provider reports its total across pages.
          totalSize: list.resultsCount ?? list.totalSize ?? (list.entries ?? []).length,
          hasNextPage: list.isNextPageAvailable === true,
        })),
      );
  }

  private listBrowseFolderEntries(
    folder: NuxeoDocument,
    safePath: string,
    pageSize: number,
    page?: BrowsePageRequest,
    filters?: BrowseFolderFilters,
  ): Observable<{
    entries: NuxeoDocument[];
    totalSize: number;
    hasNextPage?: boolean;
    serverFiltered?: boolean;
  }> {
    // Filtered server-side wherever a query can reproduce this container's own listing: an
    // ordinary folder or Domain by containment, a Collection or Favorites by membership. Those are
    // also the listings the server pages, and so the only ones where a client-side filter could
    // miss rows it was never handed.
    //
    // `Root` is what {@link filteredScopeClause} declines, and the virtual root is not a document
    // to query at all. They report `serverFiltered: false` and the caller narrows what it got.
    const scopeClause =
      folder.uid && folder.uid !== 'virtual-root' ? this.filteredScopeClause(folder) : null;
    if (browseFolderFiltersActive(filters) && scopeClause) {
      return this.getFilteredChildren(
        scopeClause,
        filters as BrowseFolderFilters,
        pageSize,
        page,
      ).pipe(map((result) => ({ ...result, serverFiltered: true })));
    }
    // Each branch is asked for one page in the server's order. `Root`, `Domain`, `Favorites` and
    // `Collection` used to take only a page size, so a listing could never reach past its first
    // page there, and a sort the caller asked for was dropped without a word. A domain lists every
    // child through `@children`, as Nuxeo Web UI's domain view does: keeping only its folders after
    // the server had paged them left pages short, or empty, wherever files came first.
    if (folder.type === 'Root') {
      return this.getNavTreeChildren(folder, pageSize, page ?? {}).pipe(
        map((list) => this.toBrowseEntryList(list)),
      );
    }
    if (folder.type === 'Favorites' || folder.type === 'Collection') {
      return this.getCollectionMembers(folder.uid, pageSize, page).pipe(
        map((list) => this.toBrowseEntryList(list)),
      );
    }
    return this.getChildren(safePath, pageSize, page?.currentPageIndex ?? 0, page?.sort).pipe(
      map((list) => this.toBrowseEntryList(list)),
    );
  }

  /**
   * Collection / Favorites members, one page at a time (Nuxeo Web UI uses
   * `default_content_collection`, not `@children`).
   *
   * Unlike `@children`, this page provider answers a sort key it cannot use with HTTP 400 rather
   * than an empty page, and it counts every member, so `totalSize` is real on every page.
   */
  getCollectionMembers(
    collectionUid: string,
    pageSize = 50,
    page?: BrowsePageRequest,
  ): Observable<NuxeoDocumentList> {
    const params = withSort(
      new HttpParams()
        .set('queryParams', collectionUid)
        .set('pageSize', pageSize)
        .set('currentPageIndex', page?.currentPageIndex ?? 0),
      page?.sort,
    );

    return this.api.get<NuxeoDocumentList>(
      '/nuxeo/api/v1/search/pp/default_content_collection/execute',
      params,
      // `permissions`, as `getChildren` asks for, so a row's actions read its own permissions.
      { properties: '*', 'enrichers.document': 'permissions' },
    );
  }

  /**
   * Nuxeo's own pagination facts, not a substitute for them.
   *
   * Nuxeo sets `resultsCountLimit` to the **requested `pageSize`** and counts only within it. So
   * `resultsCount` is a real total exactly when the whole folder fits on one page, and `-2`
   * otherwise — measured on the local instance: `pageSize=39` over 39 children answered `39`;
   * `pageSize=20` over the same folder answered `-2`.
   *
   * **The total is therefore known only when there is nothing to page**, which is why the pager is
   * next/previous rather than numbered. `isNextPageAvailable` is accurate in both cases.
   *
   * Replacing an unknown total with the page length is the recorded `totalCount` defect: it makes a
   * paged list look complete.
   */
  private toBrowseEntryList(list: NuxeoDocumentList): {
    entries: NuxeoDocument[];
    totalSize: number;
    hasNextPage?: boolean;
  } {
    const reported = list.totalSize ?? list.resultsCount;
    return {
      entries: list.entries ?? [],
      // Negative means Nuxeo declined to count. Passed through as-is so a caller can tell
      // "unknown" from "zero"; `-1` and `-2` are Nuxeo's own conventions.
      totalSize: typeof reported === 'number' ? reported : -2,
      hasNextPage: (list as { isNextPageAvailable?: boolean }).isNextPageAvailable,
    };
  }

  private resolveRepositoryRootFromDomains(): Observable<NuxeoDocument> {
    return this.api.nxqlSearch(BrowseService.ACCESSIBLE_DOMAINS_NXQL, 50, { properties: '*' }).pipe(
      switchMap((list) => {
        const topLevelDomain = (list.entries ?? []).find((entry) => isTopLevelDomain(entry));
        if (!topLevelDomain?.parentRef) {
          return throwError(() => new Error('Unable to resolve repository root for browse tree'));
        }
        return of({
          uid: topLevelDomain.parentRef,
          title: 'Root',
          type: 'Root',
          path: '/',
          lastModified: topLevelDomain.lastModified ?? '',
          properties: {},
        });
      }),
    );
  }

  private loadNavTreeBootstrapEntries(
    root: NuxeoDocument,
    pageSize: number,
  ): Observable<NavTreeBootstrap> {
    return this.getNavTreeChildren(root, pageSize).pipe(
      switchMap((list) => {
        const entries = list.entries ?? [];
        return entries.length > 0
          ? of({ root, entries, hasMore: list.isNextPageAvailable === true })
          : this.getAccessibleTopLevelNavNodes(pageSize).pipe(
              map(({ entries: fallback, hasMore }) => ({ root, entries: fallback, hasMore })),
            );
      }),
    );
  }

  private getAccessibleTopLevelNavNodes(
    pageSize: number,
  ): Observable<{ entries: NuxeoDocument[]; hasMore: boolean }> {
    return this.api
      .nxqlSearch(BrowseService.ACCESSIBLE_NAV_NODES_NXQL, pageSize, { properties: '*' })
      .pipe(
        map((list) => ({
          entries: this.filterTopLevelNavNodes(list.entries ?? []),
          // Kept rather than recomputed from the array, which is the whole point: a caller cannot
          // rediscover "there were more" once the page has been handed over.
          hasMore: list.isNextPageAvailable === true,
        })),
      );
  }

  private filterTopLevelNavNodes(entries: NuxeoDocument[]): NuxeoDocument[] {
    const folderish = entries.filter((doc) => isBrowsableNavNode(doc));
    const accessible = new Set(folderish.map((doc) => doc.uid));
    return folderish.filter((doc) => !doc.parentRef || !accessible.has(doc.parentRef));
  }

  private syntheticRepositoryRoot(entries: NuxeoDocument[] = []): NuxeoDocument {
    const topLevel = entries.find((entry) => isTopLevelDomain(entry));
    const rootUid =
      topLevel?.parentRef ?? entries.find((entry) => entry.parentRef)?.parentRef ?? 'virtual-root';
    return {
      uid: rootUid,
      title: 'Root',
      type: 'Root',
      path: '/',
      lastModified: '',
      properties: {},
    };
  }

  /** Folder metadata plus allowed child document types (`@subtypes` enricher). */
  getFolderContext(nuxeoPath: string): Observable<NuxeoDocument> {
    const safePath = nuxeoPath.replace(/\/+$/, '') || '/';
    return this.api.get<NuxeoDocument>(`/nuxeo/api/v1/path${safePath}`, undefined, {
      properties: '*',
      'enrichers.document': 'subtypes',
    });
  }

  /**
   * Allowed child document types for `nuxeoPath`, from the Nuxeo `subtypes` enricher.
   * @see https://doc.nuxeo.com/rest-api/1/document-enrichers/#subtypes
   */
  getCreatableSubtypes(nuxeoPath: string): Observable<string[]> {
    return this.getFolderContext(nuxeoPath).pipe(map((doc) => resolveCreatableSubtypes(doc)));
  }

  /**
   * Folder children for the nav drawer tree. Repository root uses `tree_children`
   * so every accessible domain is listed; domains use `@children` so structural
   * containers (SectionRoot / TemplateRoot / WorkspaceRoot) are always listed.
   *
   * Without `page`, a repository root lists every page, as a tree level does. With `page`, the
   * root answers that one page in the order it asks for, as a listing does. A domain's level is its
   * folders on the first page of `@children`, whatever `page` says: a listing pages a domain
   * through `getBrowseFolderContents`, which keeps its files too.
   */
  getNavTreeChildren(
    parent: NuxeoDocument,
    pageSize = 50,
    page?: BrowsePageRequest,
  ): Observable<NuxeoDocumentList> {
    if (parent.type === 'Root') {
      return page
        ? this.getTreeChildrenPage(parent.uid, pageSize, page)
        : this.getTreeChildren(parent.uid, pageSize);
    }
    if (parent.type === 'Domain') {
      const safePath = parent.path?.replace(/\/+$/, '') ?? '';
      return this.getChildren(safePath, pageSize).pipe(
        map((list) => this.keepEntries(list, (doc) => isFolderishDocument(doc))),
      );
    }
    // User workspaces expose Favorites (type Favorites) via @children; tree_children omits it
    // once a Collections folder exists (NXSAT-204).
    if (parent.type === 'Workspace' && isUserWorkspacePath(parent.path ?? '')) {
      const safePath = parent.path?.replace(/\/+$/, '') ?? '';
      return this.getChildren(safePath, pageSize).pipe(
        map((list) => this.keepEntries(list, (doc) => isBrowsableNavNode(doc))),
      );
    }
    return this.getTreeChildrenWithPathFallback(parent, pageSize);
  }

  /**
   * Which of these folders contain at least one folder the browse tree would list.
   *
   * One query for a whole tree level, matching the `tree_children` page provider's own filter, so
   * a tree can drop the expand arrow from folders that hold only files. `null` when the answer is
   * incomplete — more matches than one page — so a caller keeps the arrow rather than hiding a
   * branch that exists.
   */
  getFolderIdsWithSubfolders(
    parentUids: readonly string[],
  ): Observable<ReadonlySet<string> | null> {
    if (parentUids.length === 0) {
      return of(new Set<string>());
    }
    const ids = parentUids.map((uid) => `'${escapeNxqlLiteral(uid)}'`).join(', ');
    const query =
      `SELECT * FROM Document WHERE ecm:parentId IN (${ids}) ` +
      `AND ecm:mixinType = 'Folderish' AND ecm:mixinType != 'HiddenInNavigation' ` +
      `AND ecm:isProxy = 0 AND ecm:isVersion = 0 AND ecm:isTrashed = 0`;
    return this.api
      .nxqlSearch(query, BrowseService.SUBFOLDER_PROBE_PAGE_SIZE, { properties: 'dublincore' })
      .pipe(
        map((list) =>
          (list as { isNextPageAvailable?: boolean }).isNextPageAvailable
            ? null
            : new Set((list.entries ?? []).map((doc) => doc.parentRef ?? '').filter(Boolean)),
        ),
      );
  }

  private static readonly SUBFOLDER_PROBE_PAGE_SIZE = 1000;

  /**
   * Filters a page of children and keeps its counts consistent with what is kept.
   *
   * Nuxeo's `totalSize` and `resultsCount` count every child, so passing them through beside a
   * filtered list showed "1–3 of 5" over three rows. The filtered length is the total only when
   * this page was the whole folder; beyond that the kept count of later pages is unknown.
   *
   * Nuxeo reports a count it declined to compute as a negative number, so a negative or missing
   * count stays unknown even without a next page, rather than passing as a complete total.
   */
  private keepEntries(
    list: NuxeoDocumentList,
    keep: (doc: NuxeoDocument) => boolean,
  ): NuxeoDocumentList {
    const entries = (list.entries ?? []).filter(keep);
    const hasNextPage = (list as { isNextPageAvailable?: boolean }).isNextPageAvailable === true;
    const counted = (count: number | undefined) => typeof count === 'number' && count >= 0;
    const complete = !hasNextPage && counted(list.totalSize) && counted(list.resultsCount);
    const total = complete ? entries.length : -2;
    return { ...list, entries, totalSize: total, resultsCount: total };
  }

  private getTreeChildrenWithPathFallback(
    parent: NuxeoDocument,
    pageSize: number,
  ): Observable<NuxeoDocumentList> {
    return this.getTreeChildren(parent.uid, pageSize).pipe(
      switchMap((list) => {
        if ((list.entries?.length ?? 0) > 0) {
          return of(list);
        }
        const safePath = parent.path?.replace(/\/+$/, '') ?? '';
        if (!safePath || safePath === '/') {
          return of(list);
        }
        return this.getChildren(safePath, pageSize).pipe(
          map((children) => ({
            ...children,
            entries: (children.entries ?? []).filter((doc) => isBrowsableNavNode(doc)),
          })),
          catchError(() => of(list)),
        );
      }),
    );
  }

  /**
   * A folder's children, one page at a time, optionally ordered by the server.
   *
   * `sortBy` takes Nuxeo property names — `dc:title`, `dc:modified` — and accepts several,
   * comma-separated, with a matching `sortOrder` list. Verified against the local instance.
   *
   * **A property Nuxeo cannot sort by returns HTTP 200 with zero entries**, not an error, which
   * is indistinguishable from an empty folder: `sortBy=ecm:isFolder` empties a folder of fifty
   * children. Nuxeo has no sortable folderish property, so "folders first" cannot be asked of the
   * server at all; `ecm:currentLifeCycleState` does sort. Callers must therefore validate the
   * field before calling, as browse does against its `SORT_FIELDS`, rather than forward a key
   * they cannot vouch for and render an empty list.
   */
  getChildren(
    nuxeoPath: string,
    pageSize = 50,
    currentPageIndex = 0,
    sort?: BrowseSortEntry[],
  ): Observable<NuxeoDocumentList> {
    const safePath = nuxeoPath.replace(/\/+$/, '');
    const params = withSort(
      new HttpParams().set('pageSize', pageSize).set('currentPageIndex', currentPageIndex),
      sort,
    );

    return this.api.get<NuxeoDocumentList>(`/nuxeo/api/v1/path${safePath}/@children`, params, {
      properties: '*',
      // `permissions` only — not the full enricher set `getFullDocument` asks for, which would
      // multiply the payload of every row. Without it a row carries no
      // `contextParameters.permissions`, and `hasDocumentPermission` reads that as no permission at
      // all, so row-level actions would disappear. Asking is cheaper than the alternatives:
      // guessing, or hardcoding.
      'enrichers.document': 'permissions',
    });
  }

  /**
   * Folder children for the browse tree via Nuxeo's `tree_children` page provider
   * (same query Nuxeo Web UI uses: Folderish, not trashed, not hidden in navigation).
   * Fetches all pages when the provider marks additional pages available.
   */
  getTreeChildren(parentUid: string, pageSize = 50): Observable<NuxeoDocumentList> {
    type TreeChildrenPage = NuxeoDocumentList & { isNextPageAvailable?: boolean };

    const fetchPage = (pageIndex: number) => {
      const params = new HttpParams()
        .set('queryParams', parentUid)
        .set('pageSize', pageSize)
        .set('currentPageIndex', pageIndex);

      return this.api.get<TreeChildrenPage>(
        '/nuxeo/api/v1/search/pp/tree_children/execute',
        params,
        { properties: '*' },
      );
    };

    const emptyList: NuxeoDocumentList = {
      entries: [],
      totalSize: 0,
      currentPageSize: 0,
      currentPageIndex: 0,
      numberOfPages: 1,
    };

    return fetchPage(0).pipe(
      expand((res) => (res.isNextPageAvailable ? fetchPage(res.currentPageIndex + 1) : EMPTY)),
      reduce<TreeChildrenPage, NuxeoDocumentList>((acc, res) => {
        const entries = [...acc.entries, ...(res.entries ?? [])];
        return {
          entries,
          totalSize: res.totalSize ?? entries.length,
          currentPageSize: entries.length,
          currentPageIndex: 0,
          numberOfPages: 1,
        };
      }, emptyList),
    );
  }

  /** One page of `tree_children`, in the order asked for: a repository root listed as a folder. */
  private getTreeChildrenPage(
    parentUid: string,
    pageSize: number,
    page: BrowsePageRequest,
  ): Observable<NuxeoDocumentList> {
    const params = withSort(
      new HttpParams()
        .set('queryParams', parentUid)
        .set('pageSize', pageSize)
        .set('currentPageIndex', page.currentPageIndex ?? 0),
      page.sort,
    );
    return this.api.get<NuxeoDocumentList>(
      '/nuxeo/api/v1/search/pp/tree_children/execute',
      params,
      { properties: '*' },
    );
  }

  updateDocument(
    uid: string,
    properties: Record<string, unknown>,
    options?: { enrichPermissions?: boolean },
  ): Observable<NuxeoDocument> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      properties: '*',
    };
    if (options?.enrichPermissions) {
      headers['enrichers.document'] = 'permissions';
    }
    return this.api.put<NuxeoDocument>(
      `/nuxeo/api/v1/id/${uid}`,
      { 'entity-type': 'document', properties },
      headers,
    );
  }

  /** Copy clipboard items into `targetUid` (Web UI: `Document.Copy`). */
  copyDocuments(uids: string[], targetUid: string): Observable<NuxeoDocument[]> {
    return this.runClipboardDocumentsOp('Document.Copy', uids, targetUid);
  }

  /** Move clipboard items into `targetUid` (Web UI: `Document.Move`). */
  moveDocuments(uids: string[], targetUid: string): Observable<NuxeoDocument[]> {
    return this.runClipboardDocumentsOp('Document.Move', uids, targetUid);
  }

  private runClipboardDocumentsOp(
    operation: 'Document.Copy' | 'Document.Move',
    uids: string[],
    targetUid: string,
  ): Observable<NuxeoDocument[]> {
    if (uids.length === 0) {
      return of([]);
    }

    if (uids.length === 1) {
      return this.api
        .post<NuxeoDocument | NuxeoDocumentList>(`/nuxeo/api/v1/automation/${operation}`, {
          params: { target: targetUid },
          context: {},
          input: `doc:${uids[0]}`,
        })
        .pipe(map((res) => this.normalizeClipboardOpResult(res)));
    }

    const input = `docs:${uids.join(',')}`;
    return this.api
      .post<NuxeoDocument | NuxeoDocumentList>(`/nuxeo/api/v1/automation/${operation}`, {
        params: { target: targetUid },
        context: {},
        input,
      })
      .pipe(
        map((res) => this.normalizeClipboardOpResult(res)),
        catchError(() =>
          forkJoin(
            uids.map((uid) =>
              this.api
                .post<NuxeoDocument>(`/nuxeo/api/v1/automation/${operation}`, {
                  params: { target: targetUid },
                  context: {},
                  input: `doc:${uid}`,
                })
                .pipe(catchError(() => of(null))),
            ),
          ).pipe(
            map((results) => results.filter((doc): doc is NuxeoDocument => doc !== null)),
            switchMap((results) =>
              results.length === 0
                ? throwError(() => new Error('All clipboard documents failed'))
                : of(results),
            ),
          ),
        ),
      );
  }

  private normalizeClipboardOpResult(res: NuxeoDocument | NuxeoDocumentList): NuxeoDocument[] {
    if (res && typeof res === 'object' && 'entries' in res && Array.isArray(res.entries)) {
      return res.entries;
    }
    if (res && typeof res === 'object' && 'uid' in res) {
      return [res as NuxeoDocument];
    }
    return [];
  }

  /** True when the Collections folder still has at least one non-trashed child collection. */
  hasChildCollections(collectionsFolderUid: string): Observable<boolean> {
    const parentId = escapeNxqlLiteral(collectionsFolderUid);
    const query =
      `SELECT * FROM Document WHERE ecm:parentId = '${parentId}' ` +
      `AND ecm:primaryType = 'Collection' AND ecm:isTrashed = 0 AND ecm:isVersion = 0`;
    return this.api
      .nxqlSearch(query, 1)
      .pipe(map((list) => (list.entries?.length ?? 0) > 0 || (list.totalSize ?? 0) > 0));
  }

  getTrashedChildren(parentUid: string, pageSize = 50): Observable<NuxeoDocumentList> {
    const query =
      `SELECT * FROM Document WHERE ecm:parentId = '${parentUid}' ` +
      `AND ecm:isTrashed = 1 ORDER BY dc:modified DESC`;
    const params = new HttpParams().set('query', query).set('pageSize', pageSize);
    return this.http.get<NuxeoDocumentList>(
      this.api.apiUrl('/nuxeo/api/v1/search/lang/NXQL/execute'),
      { params, headers: { properties: 'dublincore' } },
    );
  }

  restoreDocument(uid: string): Observable<NuxeoDocument> {
    return this.api.post<NuxeoDocument>(`/nuxeo/api/v1/id/${uid}/@op/Document.Untrash`, {
      params: {},
      context: {},
    });
  }

  /**
   * Triggers an async CSV export via Nuxeo Bulk.RunAction.
   *
   * POST /@async returns 202 with Location header containing the execution ID:
   *   Location: .../Bulk.RunAction/@async/{executionId}/status
   */
  startCsvExport(parentUid: string): Observable<string> {
    const query =
      `SELECT * FROM Document WHERE ecm:parentId = '${parentUid}' ` +
      `AND ecm:mixinType != 'HiddenInNavigation' ` +
      `AND ecm:isProxy = 0 AND ecm:isVersion = 0 AND ecm:isTrashed = 0`;
    return this.http
      .post(
        this.api.apiUrl('/nuxeo/api/v1/automation/Bulk.RunAction/@async'),
        {
          params: { action: 'csvExport', query },
          context: {},
        },
        {
          headers: { 'Content-Type': 'application/json' },
          observe: 'response',
          responseType: 'text',
        },
      )
      .pipe(
        map((resp) => {
          const location = resp.headers.get('Location') ?? '';
          const uuidMatch = location.match(
            /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
          );
          if (uuidMatch) return uuidMatch[1];
          const bodyMatch = (resp.body ?? '').match(
            /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
          );
          if (bodyMatch) return bodyMatch[1];
          throw new Error('Could not extract execution ID from response');
        }),
      );
  }

  /**
   * Polls /@async/{executionId}/status until done, then downloads the CSV.
   *
   * Native flow: GET /status → 202 (running) or 303 (done, redirects).
   * The 303 redirect goes cross-origin (proxy→Nuxeo), so the browser
   * drops the auth header causing a 401. We catch that 401 as the
   * "completed" signal, then fetch the result with a separate
   * authenticated request through the proxy.
   */
  pollAndDownloadCsv(executionId: string): Observable<Blob> {
    const statusUrl = this.api.apiUrl(
      `/nuxeo/site/api/v1/automation/Bulk.RunAction/@async/${executionId}/status`,
    );
    const resultUrl = this.api.apiUrl(
      `/nuxeo/site/api/v1/automation/Bulk.RunAction/@async/${executionId}`,
    );

    const fetchResult = (): Observable<Blob> =>
      this.http.get<{ url: string }>(resultUrl).pipe(
        switchMap((result) => {
          const blobPath = new URL(result.url).pathname;
          return this.http.get(this.api.apiUrl(blobPath), {
            responseType: 'blob',
          });
        }),
      );

    const poll = (): Observable<Blob> =>
      this.http.get(statusUrl, { observe: 'response', responseType: 'text' }).pipe(
        switchMap((resp) => {
          if (resp.status === 200 && resp.body) {
            try {
              const result = JSON.parse(resp.body) as { url: string };
              const blobPath = new URL(result.url).pathname;
              return this.http.get(this.api.apiUrl(blobPath), {
                responseType: 'blob',
              });
            } catch {
              return of(new Blob([resp.body], { type: 'text/csv' }));
            }
          }
          return timer(1500).pipe(switchMap(() => poll()));
        }),
        catchError((err) => {
          if (err.status === 401 || err.status === 0) {
            return fetchResult();
          }
          return throwError(() => err);
        }),
      );

    return timer(1000).pipe(switchMap(() => poll()));
  }
}
