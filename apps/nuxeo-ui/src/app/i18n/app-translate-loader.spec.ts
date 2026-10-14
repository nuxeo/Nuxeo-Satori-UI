import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AppConfigService } from '@nuxeo-satori/platform/app-config';
import { signal } from '@angular/core';

import { AppTranslateLoader } from './app-translate-loader';
import { EN_FALLBACK_TRANSLATIONS } from './en-fallback';

/** The one upstream folder `UPSTREAM_FOLDERS` declares, then the app's own catalogue last. */
const UPSTREAM_FOLDER_COUNT = 1;

/** A catalogue as served: nested or flat, string leaves only once flattened. */
type CatalogueBody = Record<string, unknown>;

describe('AppTranslateLoader', () => {
  let loader: AppTranslateLoader;
  let httpMock: HttpTestingController;

  function configure(labels: Record<string, string> = {}): void {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AppConfigService,
          useValue: { manifest: signal({ labels }) },
        },
      ],
    });

    loader = TestBed.inject(AppTranslateLoader);
    httpMock = TestBed.inject(HttpTestingController);
  }

  /**
   * Answers every outstanding request: the upstream folders in declaration order, then the app's
   * own catalogue. `getTranslation` issues them in one `forkJoin`, so they are all pending at
   * once and the order of `httpMock.match` is the order the loader built them in.
   */
  function flushCatalogues(folders: CatalogueBody[], app: CatalogueBody): void {
    const requests = httpMock.match(() => true);
    expect(requests.length).toBe(UPSTREAM_FOLDER_COUNT + 1);

    requests.slice(0, UPSTREAM_FOLDER_COUNT).forEach((request, index) => {
      request.flush(folders[index] ?? {});
    });
    requests[UPSTREAM_FOLDER_COUNT].flush(app);
  }

  afterEach(() => httpMock.verify());

  /**
   * Exactly two catalogues per language: the app's own, and satori-ui's, which names controls —
   * `sat-platform-nav`'s toggle has an empty accessible name without it.
   */
  it('fetches the satori-ui catalogue and the app catalogue, and nothing else', () => {
    configure();
    loader.getTranslation('fr').subscribe();

    const urls = httpMock
      .match(() => true)
      .map((request) => {
        request.flush({});
        return request.request.url;
      });

    expect(urls).toEqual([
      'assets/satori-ui/i18n/fr.json',
      jasmine.stringMatching(/\/i18n\/fr\.json$/),
    ]);
    expect(urls[1]).not.toContain('assets/');
  });

  it('applies precedence folders < app catalogue < manifest labels', () => {
    configure({ 'a.key': 'from manifest' });
    let merged: Record<string, string> | undefined;
    loader.getTranslation('en').subscribe((value) => (merged = value));

    flushCatalogues([{ a: { key: 'from folder' }, 'only.folder': 'folder' }], {
      a: { key: 'from app' },
      'only.app': 'app',
    });

    expect(merged?.['a.key']).toBe('from manifest');
    expect(merged?.['only.folder']).toBe('folder');
    expect(merged?.['only.app']).toBe('app');
  });

  it('falls back to the compiled-in English map when the app catalogue cannot be fetched', () => {
    configure();
    let merged: Record<string, string> | undefined;
    loader.getTranslation('en').subscribe((value) => (merged = value));

    const requests = httpMock.match(() => true);
    requests.slice(0, UPSTREAM_FOLDER_COUNT).forEach((request) => request.flush({}));
    requests[UPSTREAM_FOLDER_COUNT].flush('', { status: 404, statusText: 'Not Found' });

    expect(merged?.['app.title']).toBe(EN_FALLBACK_TRANSLATIONS['app.title']);
  });

  /**
   * Regression test for the themes search button, whose `[attr.aria-label]` is
   * `settings.themes.search`. The key was in the shipped catalogue and absent from the fallback,
   * so a failed fetch named that control with the raw key. Asserted here rather than only in the
   * guardrail because this is the path that actually renders the wrong name.
   */
  it('names every accessible-name key on a failed fetch, not just some of them', () => {
    configure();
    let merged: Record<string, string> | undefined;
    loader.getTranslation('en').subscribe((value) => (merged = value));

    const requests = httpMock.match(() => true);
    requests.slice(0, UPSTREAM_FOLDER_COUNT).forEach((request) => request.flush({}));
    requests[UPSTREAM_FOLDER_COUNT].flush('', { status: 500, statusText: 'Server Error' });

    expect(merged?.['settings.themes.search']).toBe('Search themes');
    expect(merged?.['document-detail.hide-details']).toBe('Hide details');
    expect(merged?.['document-detail.show-details']).toBe('Show details');
  });
});
