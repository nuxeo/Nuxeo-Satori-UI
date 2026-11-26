import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  SHARE_LINK_OPERATIONS,
  ShareLinkService,
  createdShareLinkOf,
  shareLinkDownloadsOf,
  shareLinkLabel,
  shareLinkListOf,
  shareLinkOf,
  shareLinkUrl,
  shareLinkViewItem,
  shareLinkViewTitle,
  type CreatedShareLink,
  type ShareLink,
  type ShareLinkDownloads,
} from './share-link.service';

const ID = 'ab12cd34'.padEnd(64, '0');
const OTHER = 'ffee0011'.padEnd(64, '9');
/** A token of the server's form, made here for the test only: no server ever issued it. */
const TOKEN = 'T'.repeat(43);

const LINK = {
  id: ID,
  document: 'asset-1',
  renditions: ['view:FullHD', 'original'],
  end: '2026-12-14',
  created: '2026-11-25T10:00:00Z',
  createdBy: 'jdoe',
  revoked: null,
  revokedBy: null,
  state: 'active',
};

describe('ShareLinkService', () => {
  let service: ShareLinkService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withXhr()), provideHttpClientTesting()],
    });
    service = TestBed.inject(ShareLinkService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const expectCall = (operation: string) =>
    http.expectOne((r) => r.url.endsWith(`/nuxeo/api/v1/automation/${operation}`));

  it('lists the asset’s links through ShareLink.List, with the asset as input', () => {
    let links: ShareLink[] = [];
    service.list('asset-1').subscribe((answer) => (links = answer));
    const request = expectCall(SHARE_LINK_OPERATIONS.list);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ params: {}, context: {}, input: 'doc:asset-1' });
    request.flush({ links: [LINK] });
    expect(links).toEqual([LINK]);
  });

  it('creates a link with the items and the end day, and answers its token and path', () => {
    let created: CreatedShareLink | undefined;
    service
      .create('asset-1', ['view:FullHD', 'original'], '2026-12-14')
      .subscribe((answer) => (created = answer));
    const request = expectCall(SHARE_LINK_OPERATIONS.create);
    expect(request.request.body).toEqual({
      params: { renditions: ['view:FullHD', 'original'], end: '2026-12-14' },
      context: {},
      input: 'doc:asset-1',
    });
    request.flush({ link: LINK, token: TOKEN, path: `/nuxeo/agentic-share/${TOKEN}/` });
    expect(created).toEqual({
      kind: 'created',
      link: LINK,
      token: TOKEN,
      path: `/nuxeo/agentic-share/${TOKEN}/`,
    });
  });

  it('answers the items the server refused, and no link', () => {
    let created: CreatedShareLink | undefined;
    service.create('asset-1', ['original'], '2026-12-14').subscribe((answer) => (created = answer));
    expectCall(SHARE_LINK_OPERATIONS.create).flush({
      refused: [{ rendition: 'original', reason: 'channel-not-covered' }],
    });
    expect(created).toEqual({
      kind: 'refused',
      refused: [{ rendition: 'original', reason: 'channel-not-covered' }],
    });
  });

  it('revokes one link by its id', () => {
    let revoked: ShareLink | undefined;
    service.revoke('asset-1', ID).subscribe((answer) => (revoked = answer));
    const request = expectCall(SHARE_LINK_OPERATIONS.revoke);
    expect(request.request.body).toEqual({
      params: { link: ID },
      context: {},
      input: 'doc:asset-1',
    });
    const answer = {
      ...LINK,
      revoked: '2026-11-26T09:00:00Z',
      revokedBy: 'jdoe',
      state: 'revoked',
    };
    request.flush({ link: answer });
    expect(revoked).toEqual(answer);
  });

  it('reads the downloads, and whether the server sent them all', () => {
    let read: ShareLinkDownloads | undefined;
    service.downloads('asset-1').subscribe((answer) => (read = answer));
    const request = expectCall(SHARE_LINK_OPERATIONS.downloads);
    expect(request.request.body).toEqual({ params: {}, context: {}, input: 'doc:asset-1' });
    request.flush({
      downloads: [{ time: '2026-11-25T11:00:00Z', link: ID, rendition: 'view:FullHD' }],
      truncated: true,
    });
    expect(read).toEqual({
      downloads: [{ time: '2026-11-25T11:00:00Z', link: ID, rendition: 'view:FullHD' }],
      truncated: true,
    });
  });

  it('passes the server’s refusal on, with its status, for the caller to read a 403', () => {
    let status = 0;
    service.list('asset-1').subscribe({ error: (error) => (status = error.status) });
    expectCall(SHARE_LINK_OPERATIONS.list).flush(
      { 'entity-type': 'exception', status: 403 },
      { status: 403, statusText: 'Forbidden' },
    );
    expect(status).toBe(403);
  });

  it('fails an answer that is not of the operation’s shape, status 500, rather than guess', () => {
    let status = 0;
    service.list('asset-1').subscribe({ error: (error) => (status = error.status) });
    expectCall(SHARE_LINK_OPERATIONS.list).flush({ links: [{ ...LINK, id: 'short' }] });
    expect(status).toBe(500);
  });
});

describe('a share link, held to its shape', () => {
  it('keeps a link of the server’s shape, revoked or not', () => {
    expect(shareLinkOf(LINK)).toEqual(LINK);
    const revoked = {
      ...LINK,
      revoked: '2026-11-26T09:00:00Z',
      revokedBy: 'jdoe',
      state: 'revoked',
    };
    expect(shareLinkOf(revoked)).toEqual(revoked);
  });

  it.each([
    ['an id that is not a SHA-256', { id: 'ab12cd34' }],
    ['an id in capitals', { id: ID.toUpperCase().replace(/0/g, 'A') }],
    ['no document', { document: '' }],
    ['items that are not texts', { renditions: ['original', 3] }],
    ['an end that is not a day', { end: '2026-12-14T00:00:00Z' }],
    ['a state it does not have', { state: 'paused' }],
    ['a revoked that is neither null nor an instant', { revoked: false }],
  ])('refuses %s', (_, change) => {
    expect(shareLinkOf({ ...LINK, ...change })).toBeNull();
  });

  it('refuses a list whose answer has no links, or one link out of shape', () => {
    expect(() => shareLinkListOf({})).toThrow();
    expect(() => shareLinkListOf({ links: [LINK, { ...LINK, state: 'paused' }] })).toThrow();
    expect(shareLinkListOf({ links: [] })).toEqual([]);
  });
});

describe('a created link, held to its shape', () => {
  const created = { link: LINK, token: TOKEN, path: `/nuxeo/agentic-share/${TOKEN}/` };

  it('refuses a path that would open on another server', () => {
    for (const path of [
      `//evil.example/nuxeo/agentic-share/${TOKEN}/`,
      `https://evil.example/nuxeo/agentic-share/${TOKEN}/`,
      `/\\evil.example/${TOKEN}/`,
      `nuxeo/agentic-share/${TOKEN}/`,
    ]) {
      expect(() => createdShareLinkOf({ ...created, path })).toThrow();
    }
  });

  it('refuses a path that is not the token’s own, and a token of another form', () => {
    expect(() => createdShareLinkOf({ ...created, path: '/nuxeo/agentic-share/other/' })).toThrow();
    expect(() => createdShareLinkOf({ ...created, token: 'with space' })).toThrow();
    expect(() => createdShareLinkOf({ ...created, token: '' })).toThrow();
  });

  it('refuses an answer that is both a link and a refusal, or an empty refusal', () => {
    expect(() =>
      createdShareLinkOf({ ...created, refused: [{ rendition: 'original', reason: 'x' }] }),
    ).toThrow();
    expect(() => createdShareLinkOf({ refused: [] })).toThrow();
    expect(() => createdShareLinkOf({ refused: [{ rendition: 'original' }] })).toThrow();
  });

  it('refuses downloads out of shape', () => {
    expect(() => shareLinkDownloadsOf({ downloads: [] })).toThrow();
    expect(() =>
      shareLinkDownloadsOf({
        downloads: [{ time: 'x', link: 'short', rendition: 'original' }],
        truncated: false,
      }),
    ).toThrow();
    expect(shareLinkDownloadsOf({ downloads: [], truncated: false })).toEqual({
      downloads: [],
      truncated: false,
    });
  });
});

describe('the address a created link opens at', () => {
  it('is this page’s origin and the server’s path', () => {
    expect(shareLinkUrl(`/nuxeo/agentic-share/${TOKEN}/`, 'http://localhost:4200')).toBe(
      `http://localhost:4200/nuxeo/agentic-share/${TOKEN}/`,
    );
  });

  it('is never another origin’s', () => {
    expect(shareLinkUrl('//evil.example/x', 'http://localhost:4200')).toBeNull();
    expect(shareLinkUrl('https://evil.example/x', 'http://localhost:4200')).toBeNull();
    expect(shareLinkUrl('/\\evil.example/x', 'http://localhost:4200')).toBeNull();
  });
});

describe('items and labels', () => {
  it('names a view by its exact title, and reads the title back', () => {
    expect(shareLinkViewItem('FullHD')).toBe('view:FullHD');
    expect(shareLinkViewTitle('view:Full HD: web')).toBe('Full HD: web');
    expect(shareLinkViewTitle('original')).toBeNull();
    expect(shareLinkViewTitle('view:')).toBeNull();
  });

  it('labels a link by its id’s first 8, as the watermark prints it', () => {
    expect(shareLinkLabel(ID)).toBe('ab12cd34');
    expect(shareLinkLabel(OTHER)).toBe('ffee0011');
  });
});
