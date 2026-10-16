import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TranslateService } from '@ngx-translate/core';

import { CLIPBOARD_STORAGE_KEY } from '@nuxeo/satori-platform/nuxeo-client';

import { appConfig } from '../app.config';
import { AppShellComponent } from './app-shell.component';
import { AuthService } from '../auth/auth.service';
import type { AppNavItem } from '../platform-nav-items';

/**
 * The accessible name of the Clipboard navigation item.
 *
 * It used to be built by interpolation — `` `${navText(item)}, ${count} ${noun}` `` with `noun`
 * chosen in TypeScript. That is an INFO-144 violation, and worse than merely untranslated: a
 * string assembled at runtime has no catalogue entry, so no locale could ever have reached it.
 *
 * **Nothing exercised this path.** The keys were added, the catalogue and `en-fallback.ts` were
 * updated, and no test read the result — so the concatenation could have come back unnoticed.
 * That gap is why this file exists.
 *
 * ## Why the catalogue is supplied here rather than loaded
 *
 * `appConfig.providers` wires the real `AppTranslateLoader`, which **fetches** the catalogue, and
 * `provideHttpClientTesting()` serves nothing — so under this harness every key passes straight
 * through and an assertion on visible text reads `nav.clipboard.aria-label-one`.
 *
 * Supplying the strings with `setTranslation` makes the test deterministic and, more importantly,
 * lets it use **distinct singular and plural text with markers**. Asserting the real English
 * (`Clipboard, 1 item`) would be weaker: the interpolated version this replaced produces the same
 * bytes, so an English assertion cannot tell the two apart. That is the same trap as the `en-US`
 * date assertions elsewhere in this repository, which agreed with the hardcoded implementation on
 * every machine.
 *
 * Catalogue *presence* of these keys is covered elsewhere: `en-fallback.ts` carries both, and the
 * `guardrails` gate fails any key with no `en.context.json` entry.
 */
describe('Clipboard nav accessible name', () => {
  // Signals, not arrow functions — the shell reads `auth.username()` as a signal, and the
  // interceptor reads the two credential getters on the request the constructor issues. Shape
  // copied from `app-shell-header-a11y.spec.ts`, the working precedent.
  const authMock = {
    isAuthenticated: signal(true),
    username: signal('test.user'),
    hasAdministrationAccess: signal(false),
    isAdministrator: signal(false),
    basicCredentials: () => null,
    shareAuthToken: () => null,
    logout: () => undefined,
  } as unknown as AuthService;

  /**
   * `label` is required, not padding: `navText()` returns `item.label` when there is no
   * `labelKey`, and an item without one leaves `{{ name }}` uninterpolated — which is exactly
   * what the first version of this spec produced, `⟦one:{{ name }}/1⟧`.
   */
  const CLIPBOARD = {
    id: 'app.navbar.clipboard',
    path: '/clipboard',
    label: 'Clipboard',
  } as AppNavItem;

  const CATALOGUE = {
    nav: {
      clipboard: {
        'aria-label-one': '⟦one:{{ name }}/{{ count }}⟧',
        'aria-label-many': '⟦many:{{ name }}/{{ count }}⟧',
      },
    },
  };

  /** Seeds the clipboard before the shell constructs — it reads the count in its constructor. */
  function withClipboard(count: number): void {
    const docs = Array.from({ length: count }, (_, i) => ({
      uid: `doc-${i}`,
      title: `Doc ${i}`,
      type: 'File',
    }));
    localStorage.setItem(CLIPBOARD_STORAGE_KEY, JSON.stringify(docs));
  }

  async function shellWith(count: number): Promise<AppShellComponent> {
    withClipboard(count);
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [AppShellComponent],
      providers: [...appConfig.providers, provideHttpClientTesting()],
    })
      .overrideProvider(AuthService, { useValue: authMock })
      .compileComponents();

    const component = TestBed.createComponent(AppShellComponent).componentInstance;
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('zz', CATALOGUE);
    translate.use('zz');
    return component;
  }

  afterEach(() => localStorage.removeItem(CLIPBOARD_STORAGE_KEY));

  it('picks the singular key for one document, and interpolates both parameters', async () => {
    const shell = await shellWith(1);

    // `one:` proves the `count === 1` branch chose the right KEY; `Clipboard` proves `name` was
    // passed as a parameter rather than concatenated; `1` proves `count` was too.
    expect(shell.clipboardNavAriaLabel(CLIPBOARD)).toBe('⟦one:Clipboard/1⟧');
  });

  it('picks the plural key for more than one', async () => {
    const shell = await shellWith(4);

    expect(shell.clipboardNavAriaLabel(CLIPBOARD)).toBe('⟦many:Clipboard/4⟧');
  });

  it('returns null for an empty clipboard, so zero never reaches a plural key', async () => {
    // Not incidental. French maps 0 to the CLDR `one` category while `en` and `de` map it to
    // `other`, so a two-key `count === 1` test is wrong for French at zero. This call site is
    // exempt only because it never renders zero — if it returned a label here, the French text
    // would be wrong and nothing else would catch it.
    const shell = await shellWith(0);

    expect(shell.clipboardNavAriaLabel(CLIPBOARD)).toBeNull();
  });

  it('returns null for any other nav item', async () => {
    const shell = await shellWith(2);

    expect(
      shell.clipboardNavAriaLabel({
        id: 'app.navbar.browse',
        path: '/browse',
        label: 'Browse',
      } as AppNavItem),
    ).toBeNull();
  });
});
