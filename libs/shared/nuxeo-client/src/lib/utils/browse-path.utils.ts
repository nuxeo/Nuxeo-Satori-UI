import type { NuxeoDocument } from '../models/document.model';
import { isFolderishDocument } from '../services/document-import.service';

/** Decode a single URL-encoded browse path segment (e.g. `Domain%201` → `Domain 1`). */
export function decodeNuxeoPathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** True when the router URL is a browse main-view route. */
export function isBrowseRouterUrl(routerUrl: string): boolean {
  const withoutQuery = routerUrl.split('?')[0];
  const path = (withoutQuery.includes('#') ? withoutQuery.split('#').pop() : withoutQuery) ?? '/';
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return normalized === '/browse' || normalized.startsWith('/browse/');
}

/** Parse the Nuxeo repository path from a router URL (e.g. `/#/browse/default-domain/foo` → `/default-domain/foo`). */
export function parseBrowseNuxeoPathFromRouterUrl(routerUrl: string): string {
  const withoutQuery = routerUrl.split('?')[0];
  const path = (withoutQuery.includes('#') ? withoutQuery.split('#').pop() : withoutQuery) ?? '/';
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const prefix = '/browse';
  if (normalized === prefix || normalized === `${prefix}/`) return '/';
  if (!normalized.startsWith(`${prefix}/`)) return '/';
  const remainder = normalized.slice(prefix.length);
  const decoded = remainder
    .split('/')
    .filter(Boolean)
    .map((segment) => decodeNuxeoPathSegment(segment))
    .join('/');
  return decoded ? `/${decoded}` : '/';
}

/** Normalize a Nuxeo path for stable comparisons. */
export function normalizeNuxeoPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed || trimmed === '/') return '/';
  const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeading.replace(/\/+$/, '') || '/';
}

/** Case-insensitive Nuxeo path equality (Nuxeo may vary segment casing per server). */
export function nuxeoPathsEqual(a: string, b: string): boolean {
  return normalizeNuxeoPath(a).toLowerCase() === normalizeNuxeoPath(b).toLowerCase();
}

/** Slugify a single path segment for flexible matching (`Domain 1` ≈ `domain-1`). */
export function slugifyNuxeoPathSegment(segment: string): string {
  return decodeNuxeoPathSegment(segment).trim().toLowerCase().replace(/\s+/g, '-');
}

/** Segment-wise path comparison tolerating spaces vs hyphens and casing. */
export function nuxeoPathSegments(path: string): string[] {
  return normalizeNuxeoPath(path).split('/').filter(Boolean).map(slugifyNuxeoPathSegment);
}

export function nuxeoPathsEqualFlexible(a: string, b: string): boolean {
  const left = nuxeoPathSegments(a);
  const right = nuxeoPathSegments(b);
  if (left.length !== right.length) return false;
  return left.every((segment, index) => segment === right[index]);
}

/** Build an app browse route from a repository path. */
export function toBrowseRouterUrl(nuxeoPath: string): string {
  const normalized = normalizeNuxeoPath(nuxeoPath);
  if (normalized === '/') return '/browse';
  const encodedPath = normalized
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `/browse/${encodedPath}`;
}

/** Parent folder path for a document path (e.g. `/a/b/file.pdf` → `/a/b`). */
export function parentNuxeoFolderPath(docPath: string): string {
  const normalized = normalizeNuxeoPath(docPath);
  if (normalized === '/') return '/';
  const parts = normalized.split('/').filter(Boolean);
  parts.pop();
  return parts.length ? `/${parts.join('/')}` : '/';
}

/**
 * Nuxeo Web UI browse-tree context: folderish containers use their path;
 * leaf documents highlight their containing folder in the tree.
 */
export function browseTreeContextPath(doc: NuxeoDocument): string {
  if (doc.type === 'Root') {
    return normalizeNuxeoPath(doc.path);
  }
  if (isFolderishDocument(doc) && doc.type !== 'Collection') {
    return normalizeNuxeoPath(doc.path);
  }
  return parentNuxeoFolderPath(doc.path);
}

/**
 * Cumulative path prefixes for tree expansion, e.g.
 * `/default-domain/workspaces` → [`/default-domain`, `/default-domain/workspaces`].
 */
export function cumulativeNuxeoPathPrefixes(nuxeoPath: string): string[] {
  const normalized = normalizeNuxeoPath(nuxeoPath);
  if (normalized === '/') return [];
  const parts = normalized.split('/').filter(Boolean);
  const prefixes: string[] = [];
  let accumulated = '';
  for (const part of parts) {
    accumulated += `/${part}`;
    prefixes.push(accumulated);
  }
  return prefixes;
}

/** First path segment as a folder path (e.g. `/Domain-5/workspaces` → `/Domain-5`). */
export function topLevelNuxeoFolderPath(nuxeoPath: string): string | null {
  const normalized = normalizeNuxeoPath(nuxeoPath);
  if (normalized === '/') return null;
  const parts = normalized.split('/').filter(Boolean);
  return parts.length > 0 ? `/${parts[0]}` : null;
}

/** Prefixes that must be expanded to reveal the active folder (all but the last segment). */
export function expandableNuxeoPathPrefixes(nuxeoPath: string): string[] {
  const prefixes = cumulativeNuxeoPathPrefixes(nuxeoPath);
  return prefixes.slice(0, -1);
}

/** True when `path` is under a `UserWorkspaces` segment (personal workspace tree). */
export function isUserWorkspacePath(nuxeoPath: string): boolean {
  return nuxeoPathSegments(nuxeoPath).includes('userworkspaces');
}

/** Owner username from a personal workspace path, e.g. `/…/UserWorkspaces/jdoe/…` → `jdoe`. */
export function userWorkspaceOwnerFromPath(nuxeoPath: string): string | null {
  const segments = normalizeNuxeoPath(nuxeoPath).split('/').filter(Boolean);
  const uwIndex = segments.findIndex(
    (segment) => slugifyNuxeoPathSegment(segment) === 'userworkspaces',
  );
  if (uwIndex === -1 || uwIndex + 1 >= segments.length) return null;
  return decodeNuxeoPathSegment(segments[uwIndex + 1]);
}

/** Personal workspace root path, e.g. `/default-domain/UserWorkspaces/jdoe`. */
export function userWorkspaceRootFromPath(nuxeoPath: string): string | null {
  const segments = normalizeNuxeoPath(nuxeoPath).split('/').filter(Boolean);
  const uwIndex = segments.findIndex(
    (segment) => slugifyNuxeoPathSegment(segment) === 'userworkspaces',
  );
  if (uwIndex === -1 || uwIndex + 1 >= segments.length) return null;
  return `/${segments.slice(0, uwIndex + 2).join('/')}`;
}

/**
 * Web UI: non-admins viewing another user's personal workspace do not get breadcrumbs.
 * Admins and the workspace owner always see them.
 */
export function shouldShowUserWorkspaceBreadcrumbs(
  nuxeoPath: string,
  currentUsername: string | null,
  isAdministrator: boolean,
): boolean {
  if (!isUserWorkspacePath(nuxeoPath)) return true;
  if (isAdministrator) return true;
  const owner = userWorkspaceOwnerFromPath(nuxeoPath);
  if (!owner || !currentUsername) return false;
  return slugifyNuxeoPathSegment(owner) === slugifyNuxeoPathSegment(currentUsername);
}

/** Browse route to open after trashing a document under UserWorkspaces (workspace root). */
export function userWorkspaceBrowseRouterUrl(nuxeoPath: string): string | null {
  const root = userWorkspaceRootFromPath(nuxeoPath);
  return root ? toBrowseRouterUrl(root) : null;
}

/** Fallback browse route after trash: parent folder, else workspace root, else repository root. */
export function postTrashBrowseRouterUrl(deletedDocPath: string): string {
  const parentPath = parentNuxeoFolderPath(deletedDocPath);
  if (parentPath !== '/') {
    return toBrowseRouterUrl(parentPath);
  }
  const workspaceUrl = userWorkspaceBrowseRouterUrl(deletedDocPath);
  if (workspaceUrl) return workspaceUrl;
  return '/browse';
}

/** True when the document is a user collection (type or facet; optional create-time type hint). */
export function isCollectionDocument(
  doc: Pick<NuxeoDocument, 'type' | 'facets'> | null | undefined,
  docTypeHint?: string,
): boolean {
  if (docTypeHint === 'Collection') return true;
  if (!doc) return false;
  return doc.type === 'Collection' || doc.facets?.includes('Collection') === true;
}

/**
 * Web UI parity: Collection documents open the collection view; folderish containers open
 * browse; everything else opens document detail.
 */
export function documentNavigationUrl(
  doc: Pick<NuxeoDocument, 'uid' | 'type' | 'path' | 'facets'>,
  docTypeHint?: string,
): string {
  if (isCollectionDocument(doc, docTypeHint)) {
    return `/collections/${doc.uid}`;
  }
  if (doc.type === 'Favorites' || isFolderishDocument(doc)) {
    return toBrowseRouterUrl(doc.path);
  }
  return `/doc/${doc.uid}`;
}
