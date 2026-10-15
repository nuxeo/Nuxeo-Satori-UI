import type { NuxeoDocument } from '../models/document.model';
import {
  browseTreeContextPath,
  cumulativeNuxeoPathPrefixes,
  decodeNuxeoPathSegment,
  expandableNuxeoPathPrefixes,
  normalizeNuxeoPath,
  nuxeoPathsEqual,
  nuxeoPathsEqualFlexible,
  parentNuxeoFolderPath,
  parseBrowseNuxeoPathFromRouterUrl,
  toBrowseRouterUrl,
  topLevelNuxeoFolderPath,
  isUserWorkspacePath,
  userWorkspaceOwnerFromPath,
  userWorkspaceRootFromPath,
  shouldShowUserWorkspaceBreadcrumbs,
  userWorkspaceBrowseRouterUrl,
  postTrashBrowseRouterUrl,
  documentNavigationUrl,
  isCollectionDocument,
} from './browse-path.utils';

describe('browse-path.utils', () => {
  describe('decodeNuxeoPathSegment', () => {
    it('decodes percent-encoded segments', () => {
      expect(decodeNuxeoPathSegment('Domain%201')).toBe('Domain 1');
    });

    it('returns the raw segment when decoding fails', () => {
      expect(decodeNuxeoPathSegment('100% done')).toBe('100% done');
    });
  });

  describe('parseBrowseNuxeoPathFromRouterUrl', () => {
    it('returns / for bare browse route', () => {
      expect(parseBrowseNuxeoPathFromRouterUrl('/#/browse')).toBe('/');
      expect(parseBrowseNuxeoPathFromRouterUrl('/browse/')).toBe('/');
    });

    it('extracts nested folder path from hash route', () => {
      expect(parseBrowseNuxeoPathFromRouterUrl('/#/browse/default-domain/workspaces')).toBe(
        '/default-domain/workspaces',
      );
    });

    it('decodes percent-encoded path segments', () => {
      expect(parseBrowseNuxeoPathFromRouterUrl('/#/browse/Domain%201/workspaces')).toBe(
        '/Domain 1/workspaces',
      );
    });
  });

  describe('parentNuxeoFolderPath', () => {
    it('returns parent folder for a file path', () => {
      expect(parentNuxeoFolderPath('/default-domain/workspaces/demo/report.pdf')).toBe(
        '/default-domain/workspaces/demo',
      );
    });
  });

  describe('browseTreeContextPath', () => {
    it('uses document path for folderish containers', () => {
      const workspace = {
        uid: 'ws-1',
        path: '/default-domain/workspaces/demo',
        type: 'Workspace',
        title: 'Demo',
      } as NuxeoDocument;
      expect(browseTreeContextPath(workspace)).toBe('/default-domain/workspaces/demo');
    });

    it('uses parent folder for leaf documents', () => {
      const file = {
        uid: 'file-1',
        path: '/default-domain/workspaces/demo/report.pdf',
        type: 'File',
        title: 'Report',
      } as NuxeoDocument;
      expect(browseTreeContextPath(file)).toBe('/default-domain/workspaces/demo');
    });
  });

  describe('cumulativeNuxeoPathPrefixes', () => {
    it('builds cumulative prefixes for nested paths', () => {
      expect(cumulativeNuxeoPathPrefixes('/default-domain/workspaces/demo')).toEqual([
        '/default-domain',
        '/default-domain/workspaces',
        '/default-domain/workspaces/demo',
      ]);
    });
  });

  describe('cumulativeNuxeoPathPrefixes', () => {
    it('includes the active folder so tree children are visible', () => {
      expect(cumulativeNuxeoPathPrefixes('/domain-5/workspaces')).toEqual([
        '/domain-5',
        '/domain-5/workspaces',
      ]);
    });
  });

  describe('expandableNuxeoPathPrefixes', () => {
    it('excludes the active folder segment', () => {
      expect(expandableNuxeoPathPrefixes('/default-domain/workspaces')).toEqual([
        '/default-domain',
      ]);
    });
  });

  describe('normalizeNuxeoPath', () => {
    it('normalizes trailing slashes', () => {
      expect(normalizeNuxeoPath('/default-domain/')).toBe('/default-domain');
    });
  });

  describe('nuxeoPathsEqualFlexible', () => {
    it('treats spaced and hyphenated domain segments as equal', () => {
      expect(nuxeoPathsEqualFlexible('/Domain 1/workspaces', '/domain-1/workspaces')).toBe(true);
    });

    it('does not throw when a segment contains a literal percent sign', () => {
      expect(() => nuxeoPathsEqualFlexible('/100% done', '/100% done')).not.toThrow();
      expect(nuxeoPathsEqualFlexible('/100% done', '/100% done')).toBe(true);
    });
  });

  describe('nuxeoPathsEqual', () => {
    it('matches paths regardless of segment casing', () => {
      expect(nuxeoPathsEqual('/domain-1/workspaces', '/Domain-1/Workspaces')).toBe(true);
    });
  });

  describe('topLevelNuxeoFolderPath', () => {
    it('returns the first segment for nested paths', () => {
      expect(topLevelNuxeoFolderPath('/Domain-5/workspaces')).toBe('/Domain-5');
    });

    it('returns null at repository root', () => {
      expect(topLevelNuxeoFolderPath('/')).toBeNull();
    });
  });

  describe('toBrowseRouterUrl', () => {
    it('encodes browse routes from repository paths', () => {
      expect(toBrowseRouterUrl('/domain-1/workspaces')).toBe('/browse/domain-1/workspaces');
      expect(toBrowseRouterUrl('/')).toBe('/browse');
    });
  });

  describe('user workspace path helpers', () => {
    const workspacePath = '/default-domain/UserWorkspaces/jdoe/Collections/demo';

    it('detects user workspace paths', () => {
      expect(isUserWorkspacePath(workspacePath)).toBe(true);
      expect(isUserWorkspacePath('/default-domain/workspaces/demo')).toBe(false);
    });

    it('extracts workspace owner and root', () => {
      expect(userWorkspaceOwnerFromPath(workspacePath)).toBe('jdoe');
      expect(userWorkspaceRootFromPath(workspacePath)).toBe('/default-domain/UserWorkspaces/jdoe');
    });

    it('shouldShowUserWorkspaceBreadcrumbs hides other users for non-admins', () => {
      expect(shouldShowUserWorkspaceBreadcrumbs(workspacePath, 'jdoe', false)).toBe(true);
      expect(shouldShowUserWorkspaceBreadcrumbs(workspacePath, 'alice', false)).toBe(false);
      expect(shouldShowUserWorkspaceBreadcrumbs(workspacePath, 'alice', true)).toBe(true);
      expect(
        shouldShowUserWorkspaceBreadcrumbs('/default-domain/workspaces/demo', 'alice', false),
      ).toBe(true);
    });

    it('postTrashBrowseRouterUrl returns parent folder for personal collections', () => {
      expect(postTrashBrowseRouterUrl(workspacePath)).toBe(
        '/browse/default-domain/UserWorkspaces/jdoe/Collections',
      );
      expect(userWorkspaceBrowseRouterUrl(workspacePath)).toBe(
        '/browse/default-domain/UserWorkspaces/jdoe',
      );
    });

    it('postTrashBrowseRouterUrl uses parent when deleting directly under workspace', () => {
      expect(postTrashBrowseRouterUrl('/default-domain/UserWorkspaces/jdoe/my-folder')).toBe(
        '/browse/default-domain/UserWorkspaces/jdoe',
      );
    });

    it('documentNavigationUrl routes Collection to collection view', () => {
      expect(
        documentNavigationUrl({
          uid: 'col-1',
          type: 'Collection',
          path: '/default-domain/UserWorkspaces/jdoe/Collections/demo',
        }),
      ).toBe('/collections/col-1');
    });

    it('documentNavigationUrl uses docTypeHint when create response omits type', () => {
      expect(
        documentNavigationUrl(
          {
            uid: 'col-2',
            type: '',
            path: '/default-domain/UserWorkspaces/jdoe/Collections/demo-2',
          },
          'Collection',
        ),
      ).toBe('/collections/col-2');
    });

    it('documentNavigationUrl routes by Collection facet', () => {
      expect(
        documentNavigationUrl({
          uid: 'col-3',
          type: 'Document',
          facets: ['Collection', 'Folderish'],
          path: '/default-domain/UserWorkspaces/jdoe/Collections/demo-3',
        }),
      ).toBe('/collections/col-3');
    });

    it('isCollectionDocument detects type, facet, and hint', () => {
      expect(isCollectionDocument({ type: 'Collection' })).toBe(true);
      expect(isCollectionDocument({ type: 'File', facets: ['Collection'] })).toBe(true);
      expect(isCollectionDocument({ type: 'File' }, 'Collection')).toBe(true);
      expect(isCollectionDocument({ type: 'File' })).toBe(false);
    });
  });
});
