import {
  SHARED_DOCUMENT_STORAGE_KEY,
  readShareTokenFromBrowserUrl,
  rememberSharedDocumentLanding,
  stripShareTokenFromBrowserUrl,
} from './share-token.util';

describe('share-token.util', () => {
  it('reads token from search query before hash', () => {
    expect(
      readShareTokenFromBrowserUrl('https://host/nuxeo/agentic-ui/?token=abc123#/doc/doc-1'),
    ).toBe('abc123');
  });

  it('reads token from hash query', () => {
    expect(
      readShareTokenFromBrowserUrl('https://host/nuxeo/agentic-ui/#/doc/doc-1?token=abc123'),
    ).toBe('abc123');
  });

  it('returns null when token is absent', () => {
    expect(readShareTokenFromBrowserUrl('https://host/nuxeo/agentic-ui/#/doc/doc-1')).toBeNull();
  });

  it('strips token from search and hash query', () => {
    const replaceState = jasmine.createSpy('replaceState');
    const original = window.history.replaceState;
    window.history.replaceState = replaceState;

    try {
      stripShareTokenFromBrowserUrl('https://host/nuxeo/agentic-ui/?token=abc123#/doc/doc-1');
      expect(replaceState).toHaveBeenCalledWith(
        window.history.state,
        '',
        'https://host/nuxeo/agentic-ui/#/doc/doc-1',
      );

      replaceState.calls.reset();
      stripShareTokenFromBrowserUrl('https://host/nuxeo/agentic-ui/#/doc/doc-1?token=abc123');
      expect(replaceState).toHaveBeenCalledWith(
        window.history.state,
        '',
        'https://host/nuxeo/agentic-ui/#/doc/doc-1',
      );
    } finally {
      window.history.replaceState = original;
    }
  });
});

describe('rememberSharedDocumentLanding', () => {
  afterEach(() => window.sessionStorage.removeItem(SHARED_DOCUMENT_STORAGE_KEY));

  it('keeps the hash route the share link opened, without the token', () => {
    rememberSharedDocumentLanding(
      'https://host/nuxeo/agentic-ui/#/browse/default-domain/workspaces/ws-1/doc?token=abc123',
    );
    expect(window.sessionStorage.getItem(SHARED_DOCUMENT_STORAGE_KEY)).toBe(
      '/browse/default-domain/workspaces/ws-1/doc',
    );
  });

  it('keeps nothing for a link with no in-app route', () => {
    rememberSharedDocumentLanding('https://host/nuxeo/agentic-ui/?token=abc123');
    expect(window.sessionStorage.getItem(SHARED_DOCUMENT_STORAGE_KEY)).toBeNull();
  });

  it('keeps nothing for the bare root, which a recipient cannot use either', () => {
    rememberSharedDocumentLanding('https://host/nuxeo/agentic-ui/#/?token=abc123');
    expect(window.sessionStorage.getItem(SHARED_DOCUMENT_STORAGE_KEY)).toBeNull();
  });
});
