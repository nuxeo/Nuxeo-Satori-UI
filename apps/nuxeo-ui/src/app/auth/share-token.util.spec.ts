import {
  SHARED_DOCUMENT_STORAGE_KEY,
  clearSharedDocumentLanding,
  readLandingPathFromBrowserUrl,
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

describe('shared document landing', () => {
  const KEY = SHARED_DOCUMENT_STORAGE_KEY;
  afterEach(() => window.sessionStorage.removeItem(KEY));

  it('reads the hash route, without its query, as the landing', () => {
    expect(
      readLandingPathFromBrowserUrl(
        'https://host/nuxeo/agentic-ui/#/browse/default-domain/workspaces/ws-1/doc?token=abc123',
      ),
    ).toBe('/browse/default-domain/workspaces/ws-1/doc');
  });

  it('reads no landing from a link with no in-app route, or only the root', () => {
    expect(readLandingPathFromBrowserUrl('https://host/nuxeo/agentic-ui/?token=abc123')).toBeNull();
    expect(
      readLandingPathFromBrowserUrl('https://host/nuxeo/agentic-ui/#/?token=abc123'),
    ).toBeNull();
  });

  it('remembers the landing for the principal it was issued to', () => {
    rememberSharedDocumentLanding('/browse/default-domain/doc', 'transient/a@example.invalid');
    expect(JSON.parse(window.sessionStorage.getItem(KEY) ?? 'null')).toEqual({
      user: 'transient/a@example.invalid',
      path: '/browse/default-domain/doc',
    });
  });

  it('forgets a previous landing when a second share link does not give one', () => {
    rememberSharedDocumentLanding('/browse/default-domain/first', 'transient/a@example.invalid');
    rememberSharedDocumentLanding(null, 'transient/b@example.invalid');
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it('remembers nothing when the exchange did not sign anyone in', () => {
    rememberSharedDocumentLanding('/browse/default-domain/doc', null);
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it('clears what was remembered when asked to forget it', () => {
    rememberSharedDocumentLanding('/browse/default-domain/doc', 'transient/a@example.invalid');
    clearSharedDocumentLanding();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });
});
