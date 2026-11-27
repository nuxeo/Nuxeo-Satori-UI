import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { CURRENT_USERNAME } from '../current-user.token';
import type { NuxeoDocument } from '../models/document.model';
import { NUXEO_API_ORIGIN } from '../nuxeo-api.config';
import { DocumentDetailService } from '../services/document-detail.service';
import { ASSET_REVIEW_ENRICHER, assetReview } from './asset-review';

function documentWith(contextParameters?: NuxeoDocument['contextParameters']): NuxeoDocument {
  return {
    uid: 'asset-501',
    title: 'Trailhead Rain Jacket, Moss, front',
    type: 'AcmeAsset',
    path: '/default-domain/workspaces/acme-brand-assets/assets/ast-501',
    lastModified: '2026-11-27T10:00:00Z',
    properties: {},
    state: 'project',
    contextParameters,
  };
}

/** What `AssetReviewJsonEnricher` writes for a reviewer, as its Java test has it. */
const REVIEWER = { type: 'AcmeAsset', mayDecide: true, reason: null, permission: 'ReviewAsset' };

describe('assetReview', () => {
  it('reads the enricher the Java add-on registers, by that name', () => {
    // `AssetReviewJsonEnricher.NAME` in nuxeo-agentic-assets: another name and the server is never asked.
    expect(ASSET_REVIEW_ENRICHER).toBe('assetReview');
  });

  it("reads a reviewer's answer, and one who may not decide, with the server's reason", () => {
    expect(assetReview(documentWith({ assetReview: REVIEWER }))).toEqual(REVIEWER);
    expect(
      assetReview(
        documentWith({
          assetReview: { ...REVIEWER, mayDecide: false, reason: 'not-a-reviewer' },
        }),
      ),
    ).toEqual({ ...REVIEWER, mayDecide: false, reason: 'not-a-reviewer' });
  });

  it('is none for a document fetched without it, or one no review policy covers', () => {
    expect(assetReview(documentWith())).toBeNull();
    expect(assetReview(documentWith({ assetReview: null }))).toBeNull();
    expect(assetReview(null)).toBeNull();
  });

  it('is none for anything the enricher would not write: no decision is offered from it', () => {
    for (const written of [
      { ...REVIEWER, mayDecide: 'true' },
      { ...REVIEWER, reason: 'not-a-reviewer' },
      { ...REVIEWER, mayDecide: false, reason: null },
      { ...REVIEWER, mayDecide: false, reason: 'tired' },
      { ...REVIEWER, type: '' },
      { ...REVIEWER, permission: undefined },
      [REVIEWER],
      'yes',
    ]) {
      expect(assetReview(documentWith({ assetReview: written }))).toBeNull();
    }
  });
});

describe('DocumentDetailService, the review and watermarked files', () => {
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

  it('asks the record again for the review enricher alone, and reads its answer', async () => {
    const answer = firstValueFrom(service.fetchAssetReview('asset-501'));

    const request = http.expectOne('/nuxeo/api/v1/id/asset-501');
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('enrichers.document')).toBe('assetReview');
    expect(request.request.headers.get('properties')).toBe('dublincore');
    request.flush(documentWith({ assetReview: REVIEWER }));

    expect((await answer)?.mayDecide).toBe(true);
  });

  it('answers none when the server says nothing of the review', async () => {
    const answer = firstValueFrom(service.fetchAssetReview('file-1'));
    http.expectOne('/nuxeo/api/v1/id/file-1').flush(documentWith({}));
    expect(await answer).toBeNull();
  });

  it("asks Asset.GetWatermarked for the use, with the record as its input, and answers its file's bytes", async () => {
    const answer = firstValueFrom(service.fetchWatermarked('asset-501', 'view:Medium'));

    const request = http.expectOne('/nuxeo/api/v1/automation/Asset.GetWatermarked');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      input: 'doc:asset-501',
      params: { use: 'view:Medium' },
      context: {},
    });
    expect(request.request.responseType).toBe('blob');
    request.flush(new Blob(['marked'], { type: 'image/jpeg' }));

    expect((await answer).type).toBe('image/jpeg');
  });
});
