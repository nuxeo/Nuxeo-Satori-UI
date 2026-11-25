import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { CURRENT_USERNAME } from '../current-user.token';
import type { NuxeoDocument } from '../models/document.model';
import { NUXEO_API_ORIGIN } from '../nuxeo-api.config';
import { DocumentDetailService } from '../services/document-detail.service';
import { ASSET_RIGHTS_ENRICHER, assetRights, assetRightsDecision } from './asset-rights';

function documentWith(contextParameters?: NuxeoDocument['contextParameters']): NuxeoDocument {
  return {
    uid: 'asset-503',
    title: 'Trailhead Rain Jacket, Moss, on model',
    type: 'AcmeAsset',
    path: '/default-domain/workspaces/acme-brand-assets/assets/ast-503',
    lastModified: '2026-11-23T10:00:00Z',
    properties: {},
    state: 'project',
    contextParameters,
  };
}

/** What `AssetRightsJsonEnricher` writes for asset 503 of the brand kit, as its Java test has it. */
const NO_PRINT = {
  type: 'AcmeAsset',
  today: '2026-11-24',
  rightsEnd: '2026-12-14',
  ended: false,
  channels: ['E-commerce', 'Social'],
  uses: [
    {
      use: 'original',
      name: null,
      allowed: false,
      reason: 'channel-not-covered',
      channel: 'Print',
    },
    { use: 'view', name: 'Medium', allowed: true, reason: 'preview' },
    { use: 'view', name: 'FullHD', allowed: true, reason: 'cleared', channel: 'E-commerce' },
    {
      use: 'view',
      name: 'OriginalJpeg',
      allowed: false,
      reason: 'channel-not-covered',
      channel: 'Print',
    },
    { use: 'rendition', name: 'thumbnail', allowed: true, reason: 'preview' },
  ],
  otherwise: { allowed: false, reason: 'not-cleared' },
};

describe('assetRights', () => {
  it('reads the enricher the Java add-on registers, by that name', () => {
    // `AssetRightsJsonEnricher.NAME` in nuxeo-agentic-assets: another name and the server is never asked.
    expect(ASSET_RIGHTS_ENRICHER).toBe('assetRights');
  });

  it('reads each use with its decision, and the answer for any other', () => {
    const rights = assetRights(documentWith({ assetRights: NO_PRINT }));

    expect(rights).not.toBeNull();
    expect(rights?.type).toBe('AcmeAsset');
    expect(rights?.channels).toEqual(['E-commerce', 'Social']);
    expect(rights?.uses).toHaveLength(5);
    expect(rights?.uses[3]).toEqual({
      kind: 'view',
      name: 'OriginalJpeg',
      allowed: false,
      reason: 'channel-not-covered',
      channel: 'Print',
      rightsEnd: null,
    });
    expect(rights?.otherwise).toEqual({
      allowed: false,
      reason: 'not-cleared',
      channel: null,
      rightsEnd: null,
    });
  });

  it('is none for a document fetched without it, or one no policy covers', () => {
    expect(assetRights(documentWith())).toBeNull();
    expect(assetRights(documentWith({ assetRights: null }))).toBeNull();
    expect(assetRights(null)).toBeNull();
  });

  it('is none when the answer has no readable decision for the uses it does not list', () => {
    expect(assetRights(documentWith({ assetRights: { ...NO_PRINT, otherwise: null } }))).toBeNull();
    expect(
      assetRights(
        documentWith({
          assetRights: { ...NO_PRINT, otherwise: { allowed: true, reason: 'nope' } },
        }),
      ),
    ).toBeNull();
  });

  /** Anything the enricher would not write is left out, so it falls to `otherwise`: refused. */
  it('leaves out a use that is not as the enricher writes one', () => {
    const rights = assetRights(
      documentWith({
        assetRights: {
          ...NO_PRINT,
          uses: [
            { use: 'view', name: 'A', allowed: true, reason: 'rights-ended' },
            { use: 'view', name: 'B', allowed: 'yes', reason: 'cleared' },
            { use: 'view', name: 'C', allowed: false, reason: 'because' },
            { use: 'unknown', name: 'D', allowed: false, reason: 'not-cleared' },
            { use: 'original', name: 'E', allowed: false, reason: 'not-cleared' },
            { use: 'view', name: null, allowed: true, reason: 'preview' },
            'Medium',
            { use: 'view', name: 'F', allowed: true, reason: 'preview' },
          ],
        },
      }),
    );

    expect(rights?.uses.map((use) => use.name)).toEqual(['F']);
  });
});

describe('assetRightsDecision', () => {
  const rights = assetRights(documentWith({ assetRights: NO_PRINT }))!;

  it("is the listed use's own decision", () => {
    expect(assetRightsDecision(rights, { kind: 'view', name: 'OriginalJpeg' })).toEqual({
      allowed: false,
      reason: 'channel-not-covered',
      channel: 'Print',
      rightsEnd: null,
    });
    expect(assetRightsDecision(rights, { kind: 'original', name: null }).reason).toBe(
      'channel-not-covered',
    );
  });

  it('matches the kind as well as the name', () => {
    expect(assetRightsDecision(rights, { kind: 'rendition', name: 'OriginalJpeg' }).reason).toBe(
      'not-cleared',
    );
  });

  it('is `otherwise` for a use it does not list', () => {
    expect(assetRightsDecision(rights, { kind: 'view', name: 'Huge' })).toBe(rights.otherwise);
  });
});

describe('DocumentDetailService.fetchAssetRights', () => {
  let service: DocumentDetailService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        { provide: NUXEO_API_ORIGIN, useValue: '' },
        { provide: CURRENT_USERNAME, useValue: () => 'brand-user' },
      ],
    });
    service = TestBed.inject(DocumentDetailService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('asks the record again for the enricher alone, and reads its answer', async () => {
    const answer = firstValueFrom(service.fetchAssetRights('asset-503'));

    const request = http.expectOne('/nuxeo/api/v1/id/asset-503');
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('enrichers.document')).toBe('assetRights');
    expect(request.request.headers.get('properties')).toBe('dublincore');
    request.flush(documentWith({ assetRights: NO_PRINT }));

    expect((await answer)?.uses[3].reason).toBe('channel-not-covered');
  });

  it('answers none when the server explains nothing', async () => {
    const answer = firstValueFrom(service.fetchAssetRights('file-1'));
    http.expectOne('/nuxeo/api/v1/id/file-1').flush(documentWith({}));
    expect(await answer).toBeNull();
  });
});
