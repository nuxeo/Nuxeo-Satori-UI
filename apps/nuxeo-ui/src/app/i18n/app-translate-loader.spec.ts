import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AppConfigService, DEFAULT_APP_BOOTSTRAP_CONFIG } from '@nuxeo/satori-platform/app-config';
import { signal } from '@angular/core';

import {
  AppTranslateLoader,
  UPSTREAM_FOLDERS,
  packageLabelsUrl,
  readPackageLabels,
  upstreamCatalogueFor,
} from './app-translate-loader';
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
        provideHttpClient(withXhr()),
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
   * own catalogue, then the business app's labels, which are absent unless a test gives them.
   * `getTranslation` issues them in one `forkJoin`, so they are all pending at once and the order
   * of `httpMock.match` is the order the loader built them in.
   */
  function flushCatalogues(
    folders: CatalogueBody[],
    app: CatalogueBody,
    packageLabels?: CatalogueBody,
  ): void {
    const requests = httpMock.match(() => true);
    expect(requests.length).toBe(UPSTREAM_FOLDER_COUNT + 2);

    requests.slice(0, UPSTREAM_FOLDER_COUNT).forEach((request, index) => {
      request.flush(folders[index] ?? {});
    });
    requests[UPSTREAM_FOLDER_COUNT].flush(app);
    const labels = requests[UPSTREAM_FOLDER_COUNT + 1];
    if (packageLabels) labels.flush(packageLabels);
    else labels.flush('', { status: 404, statusText: 'Not Found' });
  }

  afterEach(() => httpMock.verify());

  /**
   * Three files per language: the app's own catalogue; satori-ui's, which names controls —
   * `sat-platform-nav`'s toggle has an empty accessible name without it; and the business app's
   * labels, beside `bootstrap.json`.
   */
  it('fetches the satori-ui catalogue, the app catalogue and the business app labels, and nothing else', () => {
    configure();
    loader.getTranslation('fr').subscribe();

    const urls = httpMock
      .match(() => true)
      .map((request) => {
        request.flush({});
        return request.request.url;
      });

    // The app catalogue keeps the bare name; satori-ui's is the regional file `aliases` names,
    // because 1.0.0 no longer ships `fr.json`.
    expect(urls).toEqual([
      'assets/satori-ui/i18n/fr-FR.json',
      jasmine.stringMatching(/\/i18n\/fr\.json$/),
      '/agentic-ui-config/labels/fr.json',
    ]);
    expect(urls[1]).not.toContain('assets/');
  });

  /**
   * `en` has two regional candidates. The bare `en.json` satori-ui shipped before 1.0.0 carried
   * the `en-US` strings, so that is what `en` must keep getting — not whichever English region
   * sorts first.
   */
  it('asks satori-ui for US English when the application is in English', () => {
    configure();
    loader.getTranslation('en').subscribe();

    const urls = httpMock
      .match(() => true)
      .map((request) => {
        request.flush({});
        return request.request.url;
      });

    expect(urls[0]).toBe('assets/satori-ui/i18n/en-US.json');
  });

  /**
   * Every bare code satori-ui shipped before 1.0.0, against the regional file it must now reach.
   *
   * Written out here rather than derived from `UPSTREAM_FOLDERS` or `upstreamCatalogueFor`, because
   * a check computed from the same table as the loader cannot notice a row going missing: delete
   * `de` from `aliases` and both sides expect no request, so the invariant test below still passes
   * and so does the dangling-alias check, which only sees aliases that exist. This list is the
   * independent statement of what each language must fetch.
   */
  const EXPECTED_SATORI_CATALOGUE: Readonly<Record<string, string>> = {
    de: 'de-DE',
    en: 'en-US',
    es: 'es-ES',
    fr: 'fr-FR',
    it: 'it-IT',
    pl: 'pl-PL',
    pt: 'pt-PT',
  };

  for (const [lang, catalogue] of Object.entries(EXPECTED_SATORI_CATALOGUE)) {
    it(`asks satori-ui for ${catalogue}.json when the application is in ${lang}`, () => {
      configure();
      loader.getTranslation(lang).subscribe();

      const upstream = httpMock
        .match(() => true)
        .map((request) => {
          request.flush({});
          return request.request.url;
        })
        .filter((url) => url.startsWith('assets/satori-ui/'));

      expect(upstream).toEqual([`assets/satori-ui/i18n/${catalogue}.json`]);
    });
  }

  /**
   * An alias pointing at a catalogue the folder does not list would be skipped silently by
   * `upstreamCatalogueFor`, leaving that language's `sat.*` keys in English with no error. The
   * guardrail keeps `languages` equal to the installed files, so this check is what ties the
   * aliases to the installed files as well.
   */
  it('aliases only to catalogues the folder lists', () => {
    configure();
    const dangling = UPSTREAM_FOLDERS.flatMap((folder) =>
      Object.entries(folder.aliases ?? {})
        .filter(([, target]) => !folder.languages.includes(target))
        .map(([lang, target]) => `${folder.path}: ${lang} -> ${target}`),
    );

    expect(dangling).toEqual([]);
  });

  /**
   * A deployment can be set to a regional code itself (`defaultLanguage: 'fr-FR'`). That must
   * reach the same file directly, without passing through `aliases`, and the app's own catalogue
   * keeps the code as given.
   */
  it('asks satori-ui for a regional code by its own name', () => {
    configure();
    loader.getTranslation('fr-FR').subscribe();

    const upstream = httpMock
      .match(() => true)
      .map((request) => {
        request.flush({});
        return request.request.url;
      })
      .filter((url) => url.startsWith('assets/satori-ui/'));

    expect(upstream).toEqual(['assets/satori-ui/i18n/fr-FR.json']);
  });

  /**
   * The resolution rule on folders built here, so each case is stated rather than inherited from
   * whatever `UPSTREAM_FOLDERS` happens to hold.
   */
  describe('upstreamCatalogueFor', () => {
    // No HTTP here, but the suite's `afterEach` calls `httpMock.verify()` and only `configure()`
    // assigns `httpMock`. Karma runs specs in random order, so without this these failed in CI
    // whenever one of them ran before any other spec — and passed locally by the luck of the order.
    beforeEach(() => configure());

    const folder = (languages: string[], aliases?: Record<string, string>) => ({
      path: 'assets/vendor',
      languages,
      aliases,
    });

    it('resolves a shipped regional code to itself', () => {
      expect(upstreamCatalogueFor(folder(['en-US', 'fr-FR']), 'fr-FR')).toBe('fr-FR');
    });

    it('prefers a file shipped under the requested name over a conflicting alias', () => {
      // A vendor that ships `en.json` again must be asked for it, even with `en` still aliased.
      expect(upstreamCatalogueFor(folder(['en', 'en-US'], { en: 'en-US' }), 'en')).toBe('en');
    });

    it('follows an alias when the requested name is not shipped', () => {
      expect(upstreamCatalogueFor(folder(['en-US'], { en: 'en-US' }), 'en')).toBe('en-US');
    });

    it('ignores an alias whose target is not shipped', () => {
      expect(upstreamCatalogueFor(folder(['en-US'], { en: 'en-GB' }), 'en')).toBeNull();
    });

    it('does not fall back from an unshipped regional code to its base language', () => {
      // `pt-BR` is neither shipped nor aliased, so Portuguese strings are not substituted for it.
      expect(upstreamCatalogueFor(folder(['pt-PT'], { pt: 'pt-PT' }), 'pt-BR')).toBeNull();
    });
  });

  /**
   * `@hylandsoftware/satori-ui` ships catalogues for de, en, es, fr, it, pl and pt only (as
   * regional files since 1.0.0, reached through `aliases`), while
   * `availableLanguages` advertises en, fr, de, ja, nl, th and zh. Requesting the folder for a
   * language it does not contain cannot succeed: it is a 404 and one browser console error on
   * every page load, for four of the seven shipped languages (NXSAT-732).
   *
   * Asserted as the absence of the request rather than as a tolerated failure, because
   * `catchError` already made the failure harmless — the defect is that the request is issued
   * at all.
   */
  it('does not request an upstream folder for a language that folder does not ship', () => {
    configure();
    loader.getTranslation('ja').subscribe();

    const urls = httpMock
      .match(() => true)
      .map((request) => {
        request.flush({});
        return request.request.url;
      });

    // The app catalogue, and the business app's labels, which are asked for in every language.
    expect(urls).toEqual([
      jasmine.stringMatching(/\/i18n\/ja\.json$/),
      '/agentic-ui-config/labels/ja.json',
    ]);
    expect(urls).not.toContain('assets/satori-ui/i18n/ja.json');
  });

  /**
   * The rule, over whatever `availableLanguages` currently holds rather than over a list spelled
   * out here.
   *
   * Which languages a deployment advertises is Layer 0 configuration and it moves: it was
   * `en fr de ja nl th zh`, Thai and Chinese were dropped, and the supported set is being taken
   * to ten — Arabic, Hebrew, Italian, Spanish and Swedish among them. A spec naming the set it
   * expected would have to be edited on each of those changes, and until someone did it would be
   * asserting the old world. Iterating the configured list instead means this test states the
   * invariant — **a folder is asked for a language exactly when it ships it** — and keeps
   * asserting it for free as the list changes.
   *
   * It is also what makes the declared `languages` list safe: the loader never reads
   * `availableLanguages`, so adding a language needs no change in the loader, and this is the
   * check that says so.
   */
  describe('over every advertised language', () => {
    const advertised = DEFAULT_APP_BOOTSTRAP_CONFIG.availableLanguages;

    // `configure()` even though this assertion needs no HTTP: the suite's `afterEach` calls
    // `httpMock.verify()`, and `httpMock` is only assigned here. Karma runs specs in random
    // order by default, so without this the teardown dereferences `undefined` whenever this
    // spec happens to run first — an intermittent failure that a full run masks, because some
    // other spec has usually configured already. Verified by focusing this spec alone:
    // `TypeError: Cannot read properties of undefined (reading 'verify')`.
    it('has languages to check, so the loop cannot pass by iterating nothing', () => {
      configure();

      expect(advertised.length).toBeGreaterThan(0);
    });

    /** The upstream URLs one `getTranslation` issues. Configured once — the loader is stateless. */
    function upstreamUrlsFor(lang: string): string[] {
      loader.getTranslation(lang).subscribe();
      return httpMock
        .match(() => true)
        .map((request) => {
          request.flush({});
          return request.request.url;
        })
        .filter((url) => url.startsWith('assets/'));
    }

    it('asks a folder for a language exactly when that folder ships it', () => {
      configure();
      const unexpected: string[] = [];
      const missing: string[] = [];

      for (const lang of advertised) {
        const urls = upstreamUrlsFor(lang);
        for (const folder of UPSTREAM_FOLDERS) {
          const catalogue = upstreamCatalogueFor(folder, lang);
          const folderUrls = urls.filter((url) => url.startsWith(`${folder.path}/`));
          const expected = catalogue === null ? [] : [`${folder.path}/i18n/${catalogue}.json`];
          for (const url of folderUrls) {
            if (!expected.includes(url)) unexpected.push(`${lang} -> ${url}`);
          }
          for (const url of expected) {
            if (!folderUrls.includes(url)) missing.push(`${lang} -> ${url}`);
          }
        }
      }

      // A doomed request is the defect NXSAT-732 reported: a 404 and a console error per load.
      expect(unexpected)
        .withContext('requests for a language the folder does not ship')
        .toEqual([]);
      // And the inverse, so the fix cannot degrade into fetching no upstream catalogue at all.
      expect(missing).withContext('shipped languages that were not requested').toEqual([]);
    });

    it('still asks for at least one upstream catalogue, so the filter is not a blanket skip', () => {
      configure();
      const asked = advertised.flatMap((lang) => upstreamUrlsFor(lang));

      expect(asked.length).toBeGreaterThan(0);
    });
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

  describe("the business app's labels", () => {
    let warnings: string[];

    beforeEach(() => {
      warnings = [];
      spyOn(console, 'warn').and.callFake((message: unknown) => {
        warnings.push(String(message));
      });
    });

    it('come above the platform catalogue and below the manifest labels', () => {
      configure({ 'payers.member.claims': 'Claims, as the customer relabelled them' });
      let merged: Record<string, string> | undefined;
      loader.getTranslation('en').subscribe((value) => (merged = value));

      flushCatalogues(
        [{}],
        { 'layout.field.claim:memberId': 'Member', 'only.app': 'app' },
        {
          version: 2,
          labels: {
            'payers.member.claims': 'Claims',
            'payers.member.cases': 'Cases',
            'layout.field.claim:memberId': 'Member ID',
          },
        },
      );

      expect(merged?.['payers.member.cases']).toBe('Cases');
      // The package replaces the platform's own key in its language, as section 7 says.
      expect(merged?.['layout.field.claim:memberId']).toBe('Member ID');
      expect(merged?.['only.app']).toBe('app');
      // And a customer's relabelling still wins.
      expect(merged?.['payers.member.claims']).toBe('Claims, as the customer relabelled them');
    });

    it('are read for the language asked, beside bootstrap.json', () => {
      configure();
      expect(packageLabelsUrl('/agentic-ui-config/bootstrap.json', 'en')).toBe(
        '/agentic-ui-config/labels/en.json',
      );
      expect(packageLabelsUrl('/nuxeo/agentic-ui-config/bootstrap.json?v=2', 'pt-BR')).toBe(
        '/nuxeo/agentic-ui-config/labels/pt-BR.json',
      );
    });

    it('are simply absent where none are served, and the rest still loads', () => {
      configure();
      let merged: Record<string, string> | undefined;
      loader.getTranslation('en').subscribe((value) => (merged = value));
      flushCatalogues([{}], { 'only.app': 'app' });
      expect(merged?.['only.app']).toBe('app');
      expect(warnings).toEqual([]);
    });

    it('leave out a file that is not version 2, and each key or text the validator refuses', () => {
      expect(readPackageLabels({ version: 1, labels: { a: 'A' } }, 'labels/en.json')).toEqual({});
      expect(readPackageLabels('<html>', 'labels/en.json')).toEqual({});
      expect(
        readPackageLabels(
          { version: 2, labels: { 'payers.ok': 'Fine', 'payers.empty': '  ', 'bad key!': 'X' } },
          'labels/en.json',
        ),
      ).toEqual({ 'payers.ok': 'Fine' });
      expect(warnings).toContain(
        '[agentic-ui-config] labels/en.json ignored: it is not a version 2 labels file',
      );
      expect(
        warnings.some((w) => w.includes('labels["payers.empty"]') && w.endsWith('left out')),
      ).toBe(true);
      expect(warnings.some((w) => w.includes('labels["bad key!"]') && w.endsWith('left out'))).toBe(
        true,
      );
    });
  });

  it('falls back to the compiled-in English map when the app catalogue cannot be fetched', () => {
    configure();
    let merged: Record<string, string> | undefined;
    loader.getTranslation('en').subscribe((value) => (merged = value));

    const requests = httpMock.match(() => true);
    requests.slice(0, UPSTREAM_FOLDER_COUNT).forEach((request) => request.flush({}));
    requests[UPSTREAM_FOLDER_COUNT].flush('', { status: 404, statusText: 'Not Found' });
    requests[UPSTREAM_FOLDER_COUNT + 1].flush('', { status: 404, statusText: 'Not Found' });

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
    requests[UPSTREAM_FOLDER_COUNT + 1].flush('', { status: 404, statusText: 'Not Found' });

    expect(merged?.['settings.themes.search']).toBe('Search themes');
    expect(merged?.['document-detail.hide-details']).toBe('Hide details');
    expect(merged?.['document-detail.show-details']).toBe('Show details');
  });
});
