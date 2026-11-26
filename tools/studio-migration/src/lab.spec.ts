import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DRAWN_BY_THE_PAGE,
  appLayoutMode,
  appLayouts,
  asksForTheDocument,
  compareDocument,
  enrichersAsked,
  schemasAsked,
  webUiLayoutMode,
  webUiLayouts,
  type AppPage,
  type AppRecording,
  type LabDocument,
  type LoadedLayout,
  type RecordedRequest,
} from './lab';

const ROOT = join(__dirname, '../../..');

const DOCUMENT: LabDocument = {
  uid: '9cd9b1cf-6f0b-442f-afa0-c2539996ba30',
  path: '/default-domain/workspaces/payers demo/member-1',
  type: 'Member',
  title: 'John Smith',
};

function request(overrides: Partial<RecordedRequest> = {}): RecordedRequest {
  return {
    method: 'GET',
    path: '/nuxeo/api/v1/me',
    query: '',
    kind: 'fetch',
    asks: {},
    status: 200,
    signed: true,
    ...overrides,
  };
}

/** An app's read of the document, answered with `properties`. */
function read(
  properties: readonly string[],
  overrides: Partial<RecordedRequest> = {},
): RecordedRequest {
  return request({
    path: `/nuxeo/api/v1/id/${DOCUMENT.uid}`,
    asks: { properties: '*', 'enrichers-document': 'permissions, breadcrumb' },
    documentProperties: properties,
    ...overrides,
  });
}

const FETCHED = ['dc:title', 'dc:expired', 'member:email', 'member:number', 'member:ssn'];

/** Web UI's metadata layout for Member, in Web UI's own format, as Studio writes one. */
const WEB_UI_LAYOUT = `<dom-module id="nuxeo-member-metadata-layout">
  <template>
    <div role="widget">
      <label>[[i18n('label.dublincore.title')]]</label>
      <div name="title">[[document.properties.dc:title]]</div>
    </div>
    <div role="widget" hidden$="[[!document.properties.dc:expired]]">
      <label>Expires</label>
      <nuxeo-date datetime="[[document.properties.dc:expired]]"></nuxeo-date>
    </div>
    <div role="widget">
      <label>Email</label>
      <div>[[document.properties.member:email]]</div>
    </div>
    <nuxeo-filter document="[[document]]" group="member-services">
      <template>
        <div role="widget">
          <label>SSN</label>
          <div>[[document.properties.member:ssn]]</div>
        </div>
      </template>
    </nuxeo-filter>
    <nuxeo-document-attachments role="widget" document="[[document]]"></nuxeo-document-attachments>
  </template>
  <script>
    Polymer({ is: 'nuxeo-member-metadata-layout', behaviors: [Nuxeo.LayoutBehavior] });
  </script>
</dom-module>`;

function webUiLayout(html = WEB_UI_LAYOUT): LoadedLayout[] {
  return webUiLayouts(
    [
      {
        path: '/nuxeo/ui/document/member/nuxeo-member-metadata-layout.html',
        status: 200,
        body: Buffer.from(html),
      },
      {
        path: '/nuxeo/ui/document/member/nuxeo-member-view-layout.html',
        status: 404,
        body: Buffer.alloc(0),
      },
    ],
    'Member',
  );
}

function webUi(overrides: Partial<AppRecording> = {}): AppRecording {
  return {
    app: 'web-ui',
    url: 'http://localhost:8080/nuxeo/ui/#!/doc/x',
    requests: [
      request({
        method: 'POST',
        path: '/nuxeo/api/v1/automation/login',
        answeredAs: 'Administrator',
      }),
      read(FETCHED, {
        asks: {
          'x-nxdocumentproperties': '*',
          'enrichers-document': 'hasContent,permissions,breadcrumb',
        },
      }),
      request({
        path: '/nuxeo/api/v1/search/pp/advanced_document_content/execute',
        query: `?pageSize=40&ecm_parentId=${DOCUMENT.uid}`,
        resultsCount: 3,
      }),
      request({
        method: 'POST',
        path: '/nuxeo/api/v1/automation/User.GetUserWorkspace',
        status: 'refused',
        reason: 'the operation User.GetUserWorkspace, which may write',
        signed: false,
      }),
    ],
    layouts: webUiLayout(),
    identity: [],
    screenshot: '1-web-ui.png',
    ...overrides,
  };
}

/** The new app's metadata layout file for Member, in the envelope config:dev serves it in. */
function appLayout(fields: readonly string[]): LoadedLayout[] {
  return appLayouts(
    [
      {
        path: '/agentic-ui-config/layouts/Member/metadata.layout.json',
        status: 200,
        body: Buffer.from(
          JSON.stringify({
            format: 'nuxeo-agentic-ui-config/1',
            layer: 'layout',
            type: 'Member',
            mode: 'metadata',
            content: { version: 1, sections: [{ id: 'member', fields }] },
          }),
        ),
      },
    ],
    'Member',
  );
}

function newApp(
  fields: readonly string[],
  overrides: Partial<AppRecording> = {},
  page: AppPage = 'document',
): AppRecording {
  return {
    app: 'new-app',
    url: 'http://localhost:4297/#/doc/x',
    requests: [
      request({ answeredAs: 'Administrator' }),
      read(FETCHED, { asks: { properties: '*', 'enrichers.document': 'acls,permissions' } }),
    ],
    layouts: appLayout(fields),
    page: { kind: page, fields },
    identity: [],
    screenshot: '1-new-app.png',
    ...overrides,
  };
}

const findingsOf = (web: AppRecording, app: AppRecording): readonly string[] =>
  compareDocument(DOCUMENT, web, app).checks.find((check) => check.number === 7)?.findings ?? [];

describe('lab mode: reading what each app loaded', () => {
  it("reads Web UI's layout with the inventory's own reader: each binding, and which sit under a condition", () => {
    const [metadata, view] = webUiLayout();
    expect(metadata.mode).toBe('metadata');
    expect(metadata.fields).toEqual([
      { xpath: 'dc:title', conditional: false },
      // `hidden$` hides an empty value; it is not a condition.
      { xpath: 'dc:expired', conditional: false },
      { xpath: 'member:email', conditional: false },
      { xpath: 'member:ssn', conditional: true },
    ]);
    // A layout Web UI asked for and did not get shows nothing.
    expect(view).toEqual(expect.objectContaining({ status: 404, mode: 'view', fields: [] }));
    // The attachments widget names no property: listed, not held.
    expect(metadata.unbound).toEqual(['nuxeo-document-attachments']);
  });

  it('reads every property a widget names, and one it names in an `xpath`', () => {
    const [layout] = webUiLayout(
      WEB_UI_LAYOUT.replace(
        '<nuxeo-document-attachments role="widget" document="[[document]]"></nuxeo-document-attachments>',
        `<div role="widget"><label>Insurer</label><div>[[document.properties.member:insurer]] ([[document.properties.member:plan]])</div></div>
    <nuxeo-document-blob role="widget" document="[[document]]" xpath="member:scan"></nuxeo-document-blob>`,
      ),
    );
    expect(layout.fields.map((field) => field.xpath)).toEqual([
      'dc:title',
      'dc:expired',
      'member:email',
      'member:ssn',
      'member:insurer',
      'member:plan',
      'member:scan',
    ]);
    expect(layout.unbound).toEqual([]);
  });

  it("reads nothing of a layout Web UI was refused, whatever the answer's body holds", () => {
    const [refused] = webUiLayouts(
      [
        {
          path: '/nuxeo/ui/document/member/nuxeo-member-view-layout.html',
          status: 404,
          body: Buffer.from(WEB_UI_LAYOUT.replaceAll('metadata', 'view')),
        },
      ],
      'Member',
    );
    expect(refused).toEqual(expect.objectContaining({ status: 404, fields: [] }));
  });

  it("reads Web UI's layout of the document's type only, wherever it is served", () => {
    expect(
      webUiLayoutMode('Member', '/nuxeo/ui/document/member/nuxeo-member-view-layout.html'),
    ).toBe('view');
    expect(
      webUiLayoutMode('Member', '/nuxeo/ui/document/claim/nuxeo-claim-view-layout.html'),
    ).toBeNull();
    expect(
      webUiLayoutMode('Member', '/nuxeo/ui/search/member/nuxeo-member-search-form.html'),
    ).toBeNull();
  });

  it("reads the new app's layout file out of the envelope the servlet and config:dev serve it in, and as the registry serves it", () => {
    expect(appLayout(['member:email']).flatMap((layout) => layout.fields)).toEqual([
      { xpath: 'member:email', conditional: false },
    ]);
    const bare = appLayouts(
      [
        {
          path: '/nuxeo/agentic-ui-apps/payers/layouts/Member/view.layout.json',
          status: 200,
          body: Buffer.from(
            JSON.stringify({
              version: 2,
              cards: [{ id: 'c', fields: [{ field: 'member:plan' }] }],
            }),
          ),
        },
      ],
      'Member',
    );
    expect(bare).toEqual([
      expect.objectContaining({
        mode: 'view',
        fields: [{ xpath: 'member:plan', conditional: false }],
      }),
    ]);
    expect(appLayoutMode('Member', '/agentic-ui-config/layouts/Claim/view.layout.json')).toBeNull();
  });

  it('knows a read of the document by its id, by its path, and through a repository, and nothing else', () => {
    expect(asksForTheDocument(read([]), DOCUMENT)).toBe(true);
    expect(
      asksForTheDocument(
        read([], {
          path: '/nuxeo/api/v1/repo/default/path/default-domain/workspaces/payers%20demo/member-1',
        }),
        DOCUMENT,
      ),
    ).toBe(true);
    expect(
      asksForTheDocument(read([], { path: `/nuxeo/api/v1/id/${DOCUMENT.uid}/@audit` }), DOCUMENT),
    ).toBe(false);
    expect(asksForTheDocument(read([], { method: 'PUT' }), DOCUMENT)).toBe(false);
  });

  it('reads the schemas and enrichers a request asks for, from each header that names them', () => {
    expect([
      ...schemasAsked(request({ asks: { properties: 'dublincore, file', 'x-nxproperties': '*' } })),
    ]).toEqual(['dublincore', 'file', '*']);
    expect([
      ...enrichersAsked(
        request({ asks: { 'enrichers-document': 'a, b', 'enrichers.document': 'c' } }),
      ),
    ]).toEqual(['a', 'b', 'c']);
  });
});

describe('lab mode: the request-log rule', () => {
  it('finds nothing when the new app fetches and can show what Web UI shows; the rest of check 7 is still to come', () => {
    const comparison = compareDocument(
      DOCUMENT,
      webUi(),
      newApp(['member:email', 'member:number']),
    );
    expect(comparison.checks).toEqual([
      expect.objectContaining({ number: 6, status: 'partial' }),
      expect.objectContaining({ number: 7, status: 'partial', findings: [] }),
    ]);
    expect(comparison.checks[0].reason).toContain('1-web-ui.png and 1-new-app.png');
  });

  // The negative control of the task: a layout of the new app that leaves out a property Web UI shows.
  it('reports a property Web UI shows that a layout of the new app leaves out', () => {
    expect(findingsOf(webUi(), newApp(['member:number']))).toEqual([
      'Web UI shows member:email (nuxeo-member-metadata-layout.html); the new app fetches it, but its document page does not show it: no field of the page, no layout file it loaded for Member, and no row it draws itself',
    ]);
  });

  it('reports a property Web UI shows that the new app does not fetch', () => {
    const app = newApp(['member:email'], {
      requests: [request({ answeredAs: 'Administrator' }), read(['dc:title', 'dc:expired'])],
    });
    expect(findingsOf(webUi(), app)).toEqual([
      'Web UI shows member:email (nuxeo-member-metadata-layout.html); the new app does not fetch it',
    ]);
  });

  it('takes a field of a layout file the new app loaded as one it can show, as on a tab not opened', () => {
    const app = newApp(['member:number'], {
      layouts: appLayout(['member:number', 'member:email']),
    });
    expect(findingsOf(webUi(), app)).toEqual([]);
  });

  it('takes a field on the page as one it can show, as the layout the app generates with no file', () => {
    expect(findingsOf(webUi(), newApp(['member:email'], { layouts: [] }))).toEqual([]);
    expect(findingsOf(webUi(), newApp([], { layouts: [] }))).toEqual([
      expect.stringContaining('Web UI shows member:email'),
    ]);
  });

  it('takes the rows the page draws itself, on its own page only', () => {
    // dc:title and dc:expired are the document page's Properties panel's own rows.
    expect(findingsOf(webUi(), newApp(['member:email']))).toEqual([]);
    // Browse's info panel shows the title but not the expiry date.
    expect(findingsOf(webUi(), newApp(['member:email'], {}, 'browse'))).toEqual([
      expect.stringContaining(
        "Web UI shows dc:expired (nuxeo-member-metadata-layout.html); the new app fetches it, but its folder's page (Browse) does not show it",
      ),
    ]);
    expect(findingsOf(webUi(), newApp(['member:email'], {}, 'other'))).toHaveLength(2);
  });

  it('lists a field under a condition without holding it, and holds nothing Web UI did not fetch', () => {
    const comparison = compareDocument(DOCUMENT, webUi(), newApp(['member:email']));
    // member:ssn is under a filter; the new app does not show it, and that is check 5's.
    expect(comparison.checks[1].findings).toEqual([]);
    expect(comparison.listing.join('\n')).toContain('1 of them under a condition, not held');
    const web = webUi({
      requests: [
        request({
          method: 'POST',
          path: '/nuxeo/api/v1/automation/login',
          answeredAs: 'Administrator',
        }),
        read(['dc:title']),
      ],
    });
    expect(findingsOf(web, newApp([]))).toEqual([]);
  });

  it('reports a new app that never asks for the document, or is answered otherwise', () => {
    const never = newApp(['member:email'], {
      requests: [request({ answeredAs: 'Administrator' })],
    });
    expect(findingsOf(webUi(), never)[0]).toBe(
      `the new app never asks for the document, which Web UI asks for with GET /nuxeo/api/v1/id/${DOCUMENT.uid} 200`,
    );
    const refused = newApp(['member:email'], {
      requests: [request({ answeredAs: 'Administrator' }), read([], { status: 403 })],
    });
    expect(findingsOf(webUi(), refused)).toContain(
      'the document is answered 200 to Web UI and 403 to the new app',
    );
  });

  it('reports a schema Web UI asks the document with that the new app does not, read as each browser sent it', () => {
    const narrow = (properties: string): AppRecording =>
      newApp(['member:email'], {
        requests: [
          request({ answeredAs: 'Administrator' }),
          read(FETCHED, { asks: { properties } }),
        ],
      });
    expect(findingsOf(webUi(), narrow('dublincore'))).toEqual([
      'Web UI asks for the document with every schema (*), the new app only with dublincore',
    ]);
    const named = webUi({
      requests: [
        request({
          method: 'POST',
          path: '/nuxeo/api/v1/automation/login',
          answeredAs: 'Administrator',
        }),
        read(FETCHED, { asks: { properties: 'dublincore,member' } }),
      ],
    });
    expect(findingsOf(named, narrow('dublincore'))).toEqual([
      'Web UI asks for the document with the schema member, the new app does not',
    ]);
    expect(findingsOf(named, narrow('*'))).toEqual([]);
    // No header asks for no schema at all: Nuxeo then answers with no property.
    expect(
      findingsOf(
        webUi(),
        newApp(['member:email'], {
          requests: [request({ answeredAs: 'Administrator' }), read(FETCHED, { asks: {} })],
        }),
      ),
    ).toContain('Web UI asks for the document with every schema (*), the new app only with none');
  });

  it('compares nothing when not every request ran as the user, and says why', () => {
    const comparison = compareDocument(
      DOCUMENT,
      webUi(),
      newApp(['member:email'], {
        identity: ['its sign-in answered as Anonymous, not as Administrator'],
      }),
    );
    expect(comparison.identityFailed).toBe(true);
    expect(comparison.checks.map((check) => check.status)).toEqual(['not run', 'not run']);
    expect(comparison.checks[1].reason).toContain('the new app: its sign-in answered as Anonymous');
  });

  it('compares nothing when what either app showed could not be read, rather than holding less', () => {
    for (const [web, app] of [
      [webUi({ unreadable: ['its layout /x could not be read: gone'] }), newApp(['member:email'])],
      [webUi(), newApp(['member:email'], { unreadable: ['its page could not be read: gone'] })],
    ] as const) {
      const comparison = compareDocument(DOCUMENT, web, app);
      expect(comparison.identityFailed).toBe(false);
      expect(comparison.checks.map((check) => check.status)).toEqual(['not run', 'not run']);
      expect(comparison.checks[1].reason).toContain('could not read all each app showed');
    }
  });

  it('compares nothing when Web UI never asked for the document', () => {
    const comparison = compareDocument(DOCUMENT, webUi({ requests: [] }), newApp([]));
    expect(comparison.identityFailed).toBe(false);
    expect(comparison.checks[1]).toEqual(expect.objectContaining({ status: 'not run' }));
  });

  it('lists the enrichers, page providers, other endpoints and refused requests side by side', () => {
    const listing = compareDocument(DOCUMENT, webUi(), newApp(['member:email'])).listing.join('\n');
    expect(listing).toContain("The document's enrichers, asked by both: permissions");
    expect(listing).toContain('a field naming no property, not held: nuxeo-document-attachments');
    expect(listing).toContain("The document's enrichers, by Web UI only: breadcrumb, hasContent");
    expect(listing).toContain("The document's enrichers, by the new app only: acls");
    expect(listing).toContain(
      `Web UI's page providers: advanced_document_content (ecm_parentId=${DOCUMENT.uid}; page size 40) 200, 3 results`,
    );
    expect(listing).toContain(
      'Other endpoints, by Web UI only: GET search/pp/advanced_document_content/execute, POST automation/login',
    );
    expect(listing).toContain(
      'Refused by lab mode, so never sent, from Web UI: POST automation/User.GetUserWorkspace (the operation User.GetUserWorkspace, which may write)',
    );
  });

  it('says when Web UI has no layout for the type, so the rule holds none of its properties', () => {
    const comparison = compareDocument(DOCUMENT, webUi({ layouts: [] }), newApp([]));
    expect(comparison.checks[1].findings).toEqual([]);
    expect(comparison.listing).toContain(
      "Web UI has no document layout for Member on this server, so the rule holds none of the document's properties: what Web UI's page shows outside its layouts, such as its info rows, it does not hold yet",
    );
  });

  it('compares nothing while a page was still sending, or a layout could not be read', () => {
    for (const [web, app] of [
      [webUi({ unsettled: 'the page was still sending after 60 s' }), newApp(['member:email'])],
      [webUi(), newApp(['member:email'], { unsettled: 'the page did not load within 60 s' })],
      [
        webUi({
          layouts: [
            ...webUiLayout(),
            {
              path: '/nuxeo/ui/document/member/nuxeo-member-edit-layout.html',
              status: 0,
              mode: 'edit',
              fields: [],
              unreadable: 'net::ERR_FAILED',
            },
          ],
        }),
        newApp(['member:email']),
      ],
    ] as const) {
      const comparison = compareDocument(DOCUMENT, web, app);
      expect(comparison.checks.map((check) => check.status)).toEqual(['not run', 'not run']);
      expect(comparison.checks[1].reason).toMatch(
        /^Not compared, because lab mode could not read all/,
      );
    }
  });

  it("does not take a form's layout file as one the document's page can show", () => {
    const form = appLayouts(
      [
        {
          path: '/agentic-ui-config/layouts/Member/edit.layout.json',
          status: 200,
          body: Buffer.from(
            JSON.stringify({ version: 1, sections: [{ id: 'f', fields: ['member:email'] }] }),
          ),
        },
      ],
      'Member',
    );
    expect(findingsOf(webUi(), newApp([], { layouts: form }))).toEqual([
      expect.stringContaining('Web UI shows member:email'),
    ]);
  });
});

describe("lab mode: the rows the new app's pages draw themselves", () => {
  // DRAWN_BY_THE_PAGE is a copy of what these files read; held to them so neither drifts unseen.
  const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

  it("is the document page's Properties panel, with the header's title and the note's format the page hands it", () => {
    const panel = read(
      'libs/shared/satori-components/src/lib/properties-panel/properties-panel.component.ts',
    );
    const rows = [...panel.matchAll(/props\(\)\['([\w-]+:[\w-]+)'\]/g)].map((match) => match[1]);
    expect(rows.length).toBeGreaterThan(5);
    expect([...DRAWN_BY_THE_PAGE.document].sort()).toEqual(
      [...new Set([...rows, 'dc:title', 'note:mime_type'])].sort(),
    );
    expect(panel).toContain('readonly format = input(');
    const page = read('libs/features/document-detail/src/lib/document-detail/document-detail.html');
    expect(page).toContain('[format]="isNoteDocument() ? noteFormatDisplay() : \'\'"');

    // Each row is drawn: the computed value that reads it is used in the panel's template.
    const template = read(
      'libs/shared/satori-components/src/lib/properties-panel/properties-panel.component.html',
    );
    const computedOf = (xpath: string): string | undefined =>
      [...panel.matchAll(/readonly (\w+) = computed\(([\s\S]*?)\n {2}\}?\)?;/g)].find((match) =>
        match[2].includes(`props()['${xpath}']`),
      )?.[1];
    for (const row of rows) {
      const name = computedOf(row);
      expect(name, `${row} is read by a computed value`).toBeDefined();
      expect(template, `${row} is drawn by ${name}()`).toContain(`${name}()`);
    }
    expect(template).toContain('{{ doc.title }}');
    expect(template).toContain('format()');

    // Lab mode takes the page for the document page by its header, drawn once the document is.
    expect(page.indexOf('class="detail-header"')).toBeGreaterThan(
      page.indexOf('} @else if (doc()) {'),
    );
    expect(page.indexOf('} @else if (doc()) {')).toBeGreaterThan(page.indexOf('@if (loading())'));
  });

  it("is Browse's info panel, less its State row, which shows dc:nature under another name", () => {
    const html = read('libs/features/browse/src/lib/browse/browse.html');
    const ts = read('libs/features/browse/src/lib/browse/browse.ts');
    const body = (name: string): string =>
      ts.slice(ts.indexOf(`  ${name}(`), ts.indexOf('\n  }\n', ts.indexOf(`  ${name}(`)));
    const rows = [
      ...[...html.matchAll(/doc\.properties\['([\w-]+:[\w-]+)'\]/g)].map((match) => match[1]),
      ...['docCreator', 'lastContributor'].flatMap((name) =>
        [...body(name).matchAll(/properties\?\.\['([\w-]+:[\w-]+)'\]/g)].map((match) => match[1]),
      ),
    ];
    expect(html).toContain('{{ doc.title }}');
    expect(html).toContain('[documentUid]="doc.uid"');
    expect(body('docState')).toContain("properties?.['dc:nature']");
    expect([...DRAWN_BY_THE_PAGE.browse].sort()).toEqual(
      [...new Set([...rows, 'dc:title', 'nxtag:tags'])].sort(),
    );
    expect(DRAWN_BY_THE_PAGE.browse.has('dc:nature')).toBe(false);
    // Lab mode takes the page for Browse by the button that opens its info panel.
    expect(html).toContain('class="panel-toggle-btn"');
    expect(html).toContain('(click)="togglePanel()"');
  });
});
