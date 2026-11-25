import {
  identityProblems,
  labControl,
  READ_ONLY_OPERATIONS,
  recordApp,
  refusal,
  type LabTarget,
  type PwBrowser,
} from './lab-browser';
import type { LabDocument, RecordedRequest } from './lab';

const TARGET: LabTarget = {
  nuxeo: 'http://nuxeo.test:8080',
  webUi: 'http://nuxeo.test:8080/nuxeo/ui/',
  app: 'http://app.test:4297/',
};
const USER = { username: 'alice', password: 'not-a-real-password' };
const AUTHORIZATION = `Basic ${Buffer.from('alice:not-a-real-password').toString('base64')}`;
const DOCUMENT: LabDocument = { uid: 'f00d', path: '/ws/note', type: 'Note', title: 'A note' };

describe('lab mode: what it refuses to send', () => {
  const at = (path: string): URL => new URL(`http://nuxeo.test:8080${path}`);

  it('lets a read go, and the operations that only read', () => {
    expect(refusal('GET', at('/nuxeo/api/v1/id/f00d'))).toBeNull();
    expect(refusal('HEAD', at('/nuxeo/ui/themes/default/theme.html'))).toBeNull();
    for (const operation of READ_ONLY_OPERATIONS)
      expect(refusal('POST', at(`/nuxeo/api/v1/automation/${operation}`))).toBeNull();
    expect(refusal('POST', at('/nuxeo/site/automation/Repository.Query'))).toBeNull();
  });

  it('refuses every other operation, every other method, and every download', () => {
    expect(refusal('POST', at('/nuxeo/api/v1/automation/User.GetUserWorkspace'))).toBe(
      'the operation User.GetUserWorkspace, which may write',
    );
    expect(refusal('POST', at('/nuxeo/api/v1/automation/Document.Update'))).toContain('may write');
    // A read-only operation's name, sent with another method, writes as that method may.
    expect(refusal('PUT', at('/nuxeo/api/v1/automation/Repository.Query'))).toContain('may write');
    expect(refusal('PUT', at('/nuxeo/api/v1/id/f00d'))).toBe('a PUT, which may write');
    expect(refusal('DELETE', at('/nuxeo/api/v1/id/f00d'))).toBe('a DELETE, which may write');
    expect(refusal('POST', at('/nuxeo/api/v1/upload/'))).toBe('a POST, which may write');
    for (const path of [
      '/nuxeo/api/v1/id/f00d/@blob/file:content',
      '/nuxeo/api/v1/repo/default/id/f00d/@rendition/thumbnail',
      '/nuxeo/api/v1/id/f00d/@preview',
      '/nuxeo/nxfile/default/f00d/file:content/a.pdf',
      '/nuxeo/nxthumb/default/f00d/thumb:thumbnail/a.png',
    ])
      expect(refusal('GET', at(path))).toBe(
        'a download, which the server may write to its audit log',
      );
  });
});

describe('lab mode: its controls', () => {
  it('reads each control, and refuses what is none', () => {
    expect(labControl('withhold-property=dc:description')).toEqual({
      kind: 'withhold-property',
      xpath: 'dc:description',
    });
    expect(labControl('narrow-schemas=dublincore,file')).toEqual({
      kind: 'narrow-schemas',
      schemas: 'dublincore,file',
    });
    for (const wrong of [
      'withhold-property',
      'withhold-property=title',
      'narrow-schemas=',
      'drop-everything=x',
    ])
      expect(labControl(wrong)).toEqual(expect.stringContaining('is not a control'));
  });
});

describe('lab mode: who the requests ran as', () => {
  const me = (
    answeredAs: string | null,
    overrides: Partial<RecordedRequest> = {},
  ): RecordedRequest => ({
    method: 'GET',
    path: '/nuxeo/api/v1/me',
    query: '',
    kind: 'fetch',
    asks: {},
    status: 200,
    signed: true,
    answeredAs,
    ...overrides,
  });

  it('finds nothing when every API request was signed and every answer names the user', () => {
    expect(identityProblems('new-app', [me('alice')], 'alice')).toEqual([]);
  });

  it('refuses an unsigned request, the guest, another user, and a run where nothing named the user', () => {
    expect(
      identityProblems(
        'new-app',
        [
          me('alice'),
          me(null, { path: '/nuxeo/api/v1/id/f00d', signed: false, answeredAs: undefined }),
        ],
        'alice',
      ),
    ).toEqual([
      "1 request to Nuxeo's API went out without the user's credentials, such as GET /nuxeo/api/v1/id/f00d",
    ]);
    expect(
      identityProblems('new-app', [me('Guest', { answeredAnonymous: true })], 'alice')[0],
    ).toContain('anonymous guest');
    expect(identityProblems('new-app', [me('bob')], 'alice')[0]).toContain('as bob, not as alice');
    const login = me('bob', { method: 'POST', path: '/nuxeo/api/v1/automation/login' });
    expect(identityProblems('web-ui', [login], 'alice')).toContain(
      'its sign-in answered as bob, not as alice',
    );
    expect(identityProblems('web-ui', [], 'alice')).toEqual([
      'nothing Web UI read said who its requests ran as: neither /me nor a sign-in was answered for alice',
    ]);
    // A refused request was never sent, so it ran as no one.
    expect(
      identityProblems(
        'new-app',
        [
          me('alice'),
          me(null, {
            path: '/nuxeo/api/v1/automation/X',
            status: 'refused',
            signed: false,
            answeredAs: undefined,
          }),
        ],
        'alice',
      ),
    ).toEqual([]);
  });
});

/** One request a fake page sends, and what the fake server answers it with. */
interface Scripted {
  readonly method?: string;
  readonly url: string;
  readonly kind?: string;
  readonly headers?: Record<string, string>;
  readonly status?: number;
  readonly body?: unknown;
  /** Its answer's body cannot be read, as after the page moved on. */
  readonly bodyGone?: boolean;
}

/** What a fake browser saw: each request as it went out, and what each route did with it. */
interface Seen {
  readonly continued: { url: string; headers: Record<string, string> }[];
  readonly aborted: string[];
  readonly fulfilled: { url: string; body: string }[];
  readonly initScripts: string[];
}

/**
 * A browser that plays `script` when a page goes anywhere: each request through the context's
 * route, then answered as scripted, or as fulfilled, or failed when aborted. Just enough of
 * Playwright for `recordApp`.
 */
function fakeBrowser(
  script: readonly Scripted[],
  page: { kind: string; fields: string[] } | 'unreadable',
): { browser: PwBrowser; seen: Seen } {
  const seen: Seen = { continued: [], aborted: [], fulfilled: [], initScripts: [] };
  const browser = {
    async newContext() {
      let handler: ((route: unknown) => Promise<void>) | undefined;
      return {
        async addInitScript(init: { content: string }) {
          seen.initScripts.push(init.content);
        },
        async route(_pattern: string, given: (route: unknown) => Promise<void>) {
          handler = given;
        },
        close: () => Promise.resolve(),
        async newPage() {
          const listeners: Record<string, ((request: unknown) => void)[]> = {};
          const emit = (event: string, request: unknown): void => {
            for (const listener of listeners[event] ?? []) listener(request);
          };
          return {
            on(event: string, listener: (request: unknown) => void) {
              (listeners[event] ??= []).push(listener);
            },
            async evaluate() {
              if (page === 'unreadable') throw new Error('Execution context was destroyed');
              return page;
            },
            screenshot: () => Promise.resolve(),
            async goto() {
              for (const step of script) {
                const headers = { ...(step.headers ?? {}) };
                let sent = headers;
                const scripted = {
                  status: step.status ?? 200,
                  text: typeof step.body === 'string' ? step.body : JSON.stringify(step.body ?? {}),
                };
                let answer: { status: number; text: string } | null = scripted;
                let failure: string | null = null;
                const request = {
                  method: () => step.method ?? 'GET',
                  url: () => step.url,
                  resourceType: () => step.kind ?? 'fetch',
                  headers: () => headers,
                  allHeaders: async () => sent,
                  response: async () => {
                    const given = answer;
                    return (
                      given && {
                        status: () => given.status,
                        body: async () => {
                          if (step.bodyGone) throw new Error('Response body is unavailable\nmore');
                          return Buffer.from(given.text);
                        },
                      }
                    );
                  },
                  failure: () => (failure === null ? null : { errorText: failure }),
                };
                emit('request', request);
                if (!handler) throw new Error('no route');
                await handler({
                  request: () => request,
                  async abort() {
                    seen.aborted.push(step.url);
                    failure = 'net::ERR_BLOCKED_BY_CLIENT';
                    answer = null;
                  },
                  async continue(options?: { headers?: Record<string, string> }) {
                    sent = options?.headers ?? headers;
                    seen.continued.push({ url: step.url, headers: sent });
                  },
                  async fetch() {
                    return {
                      status: () => scripted.status,
                      headers: () => ({ 'content-length': '1' }),
                      body: async () => Buffer.from(scripted.text),
                    };
                  },
                  async fulfill(options: { status: number; body: string }) {
                    seen.fulfilled.push({ url: step.url, body: options.body });
                    answer = { status: options.status, text: options.body };
                  },
                });
                emit(failure === null ? 'requestfinished' : 'requestfailed', request);
              }
            },
          };
        },
      };
    },
    close: () => Promise.resolve(),
  } as unknown as PwBrowser;
  return { browser, seen };
}

const DOCUMENT_ANSWER = {
  'entity-type': 'document',
  uid: 'f00d',
  properties: {
    'dc:title': 'A note',
    'dc:description': 'About it',
    'note:mime_type': 'text/plain',
  },
};
const OPTIONS = { screenshot: { out: '/nowhere', file: '1.png' }, quietMs: 5, settleMs: 2_000 };

describe('lab mode: recording an app', () => {
  it("sends Web UI the user's header on the server's origin alone, refuses what may write, and reads its layouts", async () => {
    const { browser, seen } = fakeBrowser(
      [
        {
          method: 'POST',
          url: 'http://nuxeo.test:8080/nuxeo/api/v1/automation/login',
          body: { username: 'alice' },
        },
        {
          url: 'http://nuxeo.test:8080/nuxeo/api/v1/id/f00d',
          headers: { 'x-nxdocumentproperties': '*', 'enrichers-document': 'breadcrumb' },
          body: DOCUMENT_ANSWER,
        },
        {
          method: 'POST',
          url: 'http://nuxeo.test:8080/nuxeo/api/v1/automation/User.GetUserWorkspace',
        },
        { url: 'http://nuxeo.test:8080/nuxeo/nxfile/default/f00d/file:content/a.pdf' },
        {
          url: 'http://nuxeo.test:8080/nuxeo/ui/document/note/nuxeo-note-metadata-layout.html',
          kind: 'xhr',
          body: '<dom-module id="nuxeo-note-metadata-layout"><template><div role="widget"><div>[[document.properties.dc:description]]</div></div></template></dom-module>',
        },
        { url: 'http://cdn.test/font.css', kind: 'stylesheet' },
      ],
      { kind: 'other', fields: [] },
    );
    const recording = await recordApp(browser, 'web-ui', TARGET, USER, DOCUMENT, OPTIONS);

    expect(seen.initScripts).toEqual(['window.automationReady = true;']);
    expect(seen.aborted).toEqual([
      'http://nuxeo.test:8080/nuxeo/api/v1/automation/User.GetUserWorkspace',
      'http://nuxeo.test:8080/nuxeo/nxfile/default/f00d/file:content/a.pdf',
    ]);
    for (const sent of seen.continued)
      expect(sent.headers['authorization']).toBe(
        sent.url.startsWith('http://nuxeo.test:8080/') ? AUTHORIZATION : undefined,
      );
    expect(recording.identity).toEqual([]);
    expect(
      recording.requests.map((request) => [request.method, request.path, request.status]),
    ).toEqual([
      ['POST', '/nuxeo/api/v1/automation/login', 200],
      ['GET', '/nuxeo/api/v1/id/f00d', 200],
      ['POST', '/nuxeo/api/v1/automation/User.GetUserWorkspace', 'refused'],
      ['GET', '/nuxeo/nxfile/default/f00d/file:content/a.pdf', 'refused'],
      ['GET', '/nuxeo/ui/document/note/nuxeo-note-metadata-layout.html', 200],
    ]);
    const read = recording.requests[1];
    expect(read.documentProperties).toEqual(['dc:title', 'dc:description', 'note:mime_type']);
    expect(read.asks).toEqual({
      'x-nxdocumentproperties': '*',
      'enrichers-document': 'breadcrumb',
    });
    // Nothing recorded holds a credential.
    expect(JSON.stringify(recording)).not.toContain(
      Buffer.from('alice:not-a-real-password').toString('base64'),
    );
    expect(recording.layouts).toEqual([
      expect.objectContaining({
        mode: 'metadata',
        fields: [{ xpath: 'dc:description', conditional: false }],
      }),
    ]);
  });

  it('gives the new app its session before its first script, judges its own header, and reads its page', async () => {
    const { browser, seen } = fakeBrowser(
      [
        {
          url: 'http://app.test:4297/nuxeo/api/v1/me',
          headers: { authorization: AUTHORIZATION },
          body: { id: 'alice' },
        },
        {
          url: 'http://app.test:4297/nuxeo/api/v1/id/f00d',
          headers: { authorization: AUTHORIZATION, properties: '*' },
          body: DOCUMENT_ANSWER,
        },
        { url: 'http://app.test:4297/nuxeo/api/v1/id/f00d/@audit', headers: {}, body: {} },
      ],
      { kind: 'document', fields: ['dc:description'] },
    );
    const recording = await recordApp(browser, 'new-app', TARGET, USER, DOCUMENT, OPTIONS);
    expect(seen.initScripts).toHaveLength(1);
    expect(seen.initScripts[0]).toContain('sessionStorage.setItem("agentic_ui_nuxeo_session"');
    expect(seen.initScripts[0]).toContain('if (location.origin === "http://app.test:4297")');
    // Lab mode never adds the header to the new app's requests: it judges the app's own.
    expect(
      seen.continued.every(
        (sent) =>
          sent.headers['authorization'] === undefined ||
          sent.headers['authorization'] === AUTHORIZATION,
      ),
    ).toBe(true);
    expect(recording.page).toEqual({ kind: 'document', fields: ['dc:description'] });
    expect(recording.identity).toEqual([
      "1 request to Nuxeo's API went out without the user's credentials, such as GET /nuxeo/api/v1/id/f00d/@audit",
    ]);
    expect(JSON.stringify(recording)).not.toContain(
      Buffer.from('alice:not-a-real-password').toString('base64'),
    );
  });

  it('keeps a layout whose answer could not be read, and a page it could not read, as unreadable', async () => {
    const web = fakeBrowser(
      [
        {
          method: 'POST',
          url: 'http://nuxeo.test:8080/nuxeo/api/v1/automation/login',
          body: { username: 'alice' },
        },
        {
          url: 'http://nuxeo.test:8080/nuxeo/ui/document/note/nuxeo-note-view-layout.html',
          kind: 'xhr',
          bodyGone: true,
        },
      ],
      { kind: 'other', fields: [] },
    );
    const recording = await recordApp(web.browser, 'web-ui', TARGET, USER, DOCUMENT, OPTIONS);
    expect(recording.unreadable).toEqual([
      'its layout /nuxeo/ui/document/note/nuxeo-note-view-layout.html was loaded, and its answer could not be read: Response body is unavailable',
    ]);
    expect(recording.layouts).toEqual([expect.objectContaining({ status: 200, fields: [] })]);

    const app = fakeBrowser(
      [
        {
          url: 'http://app.test:4297/nuxeo/api/v1/me',
          headers: { authorization: AUTHORIZATION },
          body: { id: 'alice' },
        },
      ],
      'unreadable',
    );
    const unread = await recordApp(app.browser, 'new-app', TARGET, USER, DOCUMENT, OPTIONS);
    expect(unread.unreadable).toEqual([
      'its page could not be read: Execution context was destroyed',
    ]);
    expect(unread.page).toBeUndefined();
  });

  it('puts a control into the new app alone: a property withheld from its answers, or fewer schemas asked', async () => {
    const script: Scripted[] = [
      {
        url: 'http://app.test:4297/nuxeo/api/v1/me',
        headers: { authorization: AUTHORIZATION },
        body: { id: 'alice' },
      },
      {
        url: 'http://app.test:4297/nuxeo/api/v1/id/f00d',
        headers: { authorization: AUTHORIZATION, properties: '*' },
        body: DOCUMENT_ANSWER,
      },
    ];
    const withheld = fakeBrowser(script, { kind: 'document', fields: [] });
    const recording = await recordApp(withheld.browser, 'new-app', TARGET, USER, DOCUMENT, {
      ...OPTIONS,
      control: { kind: 'withhold-property', xpath: 'dc:description' },
    });
    expect(withheld.seen.fulfilled).toHaveLength(1);
    expect(recording.requests[1].documentProperties).toEqual(['dc:title', 'note:mime_type']);

    const narrowed = fakeBrowser(script, { kind: 'document', fields: [] });
    const narrow = await recordApp(narrowed.browser, 'new-app', TARGET, USER, DOCUMENT, {
      ...OPTIONS,
      control: { kind: 'narrow-schemas', schemas: 'dublincore' },
    });
    expect(narrow.requests[1].asks).toEqual({ properties: 'dublincore' });

    // Web UI is never touched by a control.
    const web = fakeBrowser(
      [
        {
          url: 'http://nuxeo.test:8080/nuxeo/api/v1/id/f00d',
          headers: { properties: '*' },
          body: DOCUMENT_ANSWER,
        },
      ],
      { kind: 'other', fields: [] },
    );
    const untouched = await recordApp(web.browser, 'web-ui', TARGET, USER, DOCUMENT, {
      ...OPTIONS,
      control: { kind: 'withhold-property', xpath: 'dc:description' },
    });
    expect(web.seen.fulfilled).toEqual([]);
    expect(untouched.requests[0].documentProperties).toContain('dc:description');
  });
});
