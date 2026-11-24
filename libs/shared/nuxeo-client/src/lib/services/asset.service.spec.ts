import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import type { AssetSearchResult } from '../models/asset.model';
import { NUXEO_API_ORIGIN } from '../nuxeo-api.config';
import { AssetService } from './asset.service';

const SEARCH_URL = 'https://nuxeo.example/nuxeo/api/v1/search/pp/assets_search/execute';

describe('AssetService.searchAssets', () => {
  let service: AssetService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        { provide: NUXEO_API_ORIGIN, useValue: 'https://nuxeo.example/' },
      ],
    });
    service = TestBed.inject(AssetService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const expectSearch = () => http.expectOne((r) => r.url === SEARCH_URL);

  it('runs the assets_search page provider, first page of 40, with every property', () => {
    service.searchAssets().subscribe();

    const request = expectSearch();
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('properties')).toBe('*');
    expect(request.request.params.get('currentPageIndex')).toBe('0');
    expect(request.request.params.get('offset')).toBe('0');
    expect(request.request.params.get('pageSize')).toBe('40');
    request.flush({ entries: [] });
  });

  it('sends the offset of the requested page, so page 3 of 25 starts at entry 75', () => {
    service.searchAssets({ pageIndex: 3, pageSize: 25 }).subscribe();

    const request = expectSearch();
    expect(request.request.params.get('currentPageIndex')).toBe('3');
    expect(request.request.params.get('offset')).toBe('75');
    expect(request.request.params.get('pageSize')).toBe('25');
    request.flush({ entries: [] });
  });

  it('sends each selected aggregation as a JSON array under its page-provider name', () => {
    service
      .searchAssets({
        primaryTypes: ['Picture', 'Video'],
        mimeTypes: ['image/png'],
        widths: ['1920'],
        heights: ['1080'],
        colorProfiles: ['sRGB'],
        colorDepths: ['24'],
        videoDurations: ['short'],
      })
      .subscribe();

    const request = expectSearch();
    const params = request.request.params;
    expect(params.get('system_primaryType_agg')).toBe('["Picture","Video"]');
    expect(params.get('system_mimetype_agg')).toBe('["image/png"]');
    expect(params.get('asset_width_agg')).toBe('["1920"]');
    expect(params.get('asset_height_agg')).toBe('["1080"]');
    expect(params.get('color_profile_agg')).toBe('["sRGB"]');
    expect(params.get('color_depth_agg')).toBe('["24"]');
    expect(params.get('video_duration_agg')).toBe('["short"]');
    request.flush({ entries: [] });
  });

  it('leaves an aggregation with nothing selected out, rather than filtering by an empty list', () => {
    service.searchAssets({ primaryTypes: [], mimeTypes: ['image/png'] }).subscribe();

    const request = expectSearch();
    expect(request.request.params.has('system_primaryType_agg')).toBe(false);
    expect(request.request.params.has('system_mimetype_agg')).toBe(true);
    expect(request.request.params.keys()).not.toContain('asset_width_agg');
    request.flush({ entries: [] });
  });

  it('sends the sort only when one is chosen', () => {
    service.searchAssets({ sortBy: 'dc:modified', sortOrder: 'desc' }).subscribe();
    const sorted = expectSearch();
    expect(sorted.request.params.get('sortBy')).toBe('dc:modified');
    expect(sorted.request.params.get('sortOrder')).toBe('desc');
    sorted.flush({ entries: [] });

    service.searchAssets().subscribe();
    const unsorted = expectSearch();
    expect(unsorted.request.params.has('sortBy')).toBe(false);
    expect(unsorted.request.params.has('sortOrder')).toBe(false);
    unsorted.flush({ entries: [] });
  });

  it('trims the full-text term, and sends none for a blank one', () => {
    service.searchAssets({ ecmFulltext: '  logo  ' }).subscribe();
    const trimmed = expectSearch();
    expect(trimmed.request.params.get('ecm_fulltext')).toBe('logo');
    trimmed.flush({ entries: [] });

    service.searchAssets({ ecmFulltext: '   ' }).subscribe();
    const blank = expectSearch();
    expect(blank.request.params.has('ecm_fulltext')).toBe(false);
    blank.flush({ entries: [] });
  });

  it('answers with the page provider’s result as Nuxeo returns it', () => {
    let result: AssetSearchResult | undefined;
    service.searchAssets().subscribe((r) => (result = r));

    const body = {
      entries: [{ uid: 'a1', title: 'Logo', type: 'Picture' }],
      resultsCount: 1,
      aggregations: { system_primaryType_agg: { buckets: [{ key: 'Picture', docCount: 1 }] } },
    };
    expectSearch().flush(body);

    expect(result).toEqual(body);
  });

  it('passes a server error to the caller', () => {
    let status: number | undefined;
    service.searchAssets().subscribe({ error: (e) => (status = e.status) });

    expectSearch().flush('boom', { status: 500, statusText: 'Server Error' });

    expect(status).toBe(500);
  });
});
