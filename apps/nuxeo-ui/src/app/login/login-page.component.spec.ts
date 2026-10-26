import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom, of, Observable } from 'rxjs';

import { AppConfigService, DEFAULT_APP_BOOTSTRAP_CONFIG } from '@nuxeo/satori-platform/app-config';
import type { NuxeoSamlLoginEndpoint } from '@nuxeo/satori-platform/nuxeo-client';

import { AuthService, SignInError } from '../auth/auth.service';
import { LoginPageComponent } from './login-page.component';
import { testTranslateModule } from '../i18n/translate-testing';

/** Synthetic values for unit tests only — not Nuxeo or dev default credentials. */
const MOCK_LOGIN_USER = 'nxeng-login-spec-user';
const MOCK_LOGIN_SECRET = 'nxeng-login-spec-secret';

/**
 * Every element under `root`, following open shadow roots — an element focusable inside one
 * still takes focus away from a keyboard user.
 */
function allDescendants(root: Element): Element[] {
  const found: Element[] = [];
  const visit = (node: Element | ShadowRoot) => {
    // Checked on entry, not per child, so a shadow root attached to `root` itself is
    // traversed too — the caller's own element is exactly where a component under test
    // attaches one.
    if (node instanceof Element && node.shadowRoot) {
      visit(node.shadowRoot);
    }
    for (const child of Array.from(node.children)) {
      found.push(child);
      visit(child);
    }
  };
  visit(root);
  return found;
}

/**
 * Whether an element can actually take focus — asked of the browser, by focusing it.
 *
 * Not a selector list. The first version of this guard enumerated
 * `a[href],button,input,…` and the reviewer was right that such a list is permanently
 * incomplete: it missed `area[href]`, `iframe`, `object`, `audio[controls]`,
 * `video[controls]` and `summary`, and it would miss whatever the next HTML revision makes
 * focusable. `@angular/cdk/a11y`'s `InteractivityChecker` has the same gap, being a
 * maintained list rather than a complete one.
 *
 * These specs run in real Chrome, so focus semantics are available directly, and the
 * question `aria-hidden` actually raises — can a keyboard user land on something inside a
 * subtree screen readers cannot see — is exactly what `focus()` answers.
 *
 * Focus moving anywhere off `<body>` counts: an element inside a shadow root reports its
 * host as `document.activeElement`, so comparing against the element itself would read a
 * real focus move as a miss.
 */
function canTakeFocus(element: Element): boolean {
  (document.activeElement as HTMLElement | null)?.blur();
  (element as HTMLElement).focus?.();
  const took = document.activeElement !== null && document.activeElement !== document.body;
  (document.activeElement as HTMLElement | null)?.blur();
  return took;
}

describe('LoginPageComponent', () => {
  let fixture: ComponentFixture<LoginPageComponent>;
  let component: LoginPageComponent;
  let auth: jasmine.SpyObj<Pick<AuthService, 'login' | 'startSamlLogin' | 'samlLoginOptions'>>;
  const brandingLogo = signal<{ url: string; alt: string } | null>(null);
  const bootstrap = signal(DEFAULT_APP_BOOTSTRAP_CONFIG);
  const samlEndpoint: NuxeoSamlLoginEndpoint = {
    id: 'azure',
    label: 'Azure SAML',
    path: '/nuxeo/login/azure',
  };

  beforeEach(async () => {
    brandingLogo.set(null);
    bootstrap.set(DEFAULT_APP_BOOTSTRAP_CONFIG);
    auth = jasmine.createSpyObj('AuthService', ['login', 'startSamlLogin']);
    auth.login.and.returnValue(of(undefined));
    Object.defineProperty(auth, 'samlLoginOptions', {
      get: () => signal([]),
    });

    await TestBed.configureTestingModule({
      imports: [
        testTranslateModule({
          'app.login-page.log-in': 'Log in',
          'app.login-page.sign-in-credentials': 'Sign in credentials',
          'app.login-page.username-required': 'Username (required)',
          'app.login-page.password-required': 'Password (required)',
          'app.login-page.username-is-required': 'Username is required',
          'app.login-page.password-is-required': 'Password is required',
          'app.login-page.copyright-c-1992-2026-hyland-software':
            'Copyright (C) 1992–2026 Hyland Software, Inc.',
          'login.skip-link': 'Skip to sign in',
        }),
        LoginPageComponent,
      ],
      providers: [
        provideRouter([{ path: 'dashboard', component: LoginPageComponent }]),
        { provide: AuthService, useValue: auth },
        { provide: AppConfigService, useValue: { brandingLogo, bootstrap } },
      ],
    }).compileComponents();

    await firstValueFrom(TestBed.inject(TranslateService).use('en'));

    fixture = TestBed.createComponent(LoginPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  describe('brand (branding.logo)', () => {
    const brandLink = () => (fixture.nativeElement as HTMLElement).querySelector('a.login-brand');

    it('shows the Satori lockup under the "Hyland" name when no logo is configured', () => {
      expect(brandLink()?.querySelector('sat-logo')).toBeTruthy();
      expect(brandLink()?.querySelector('img')).toBeNull();
      expect(brandLink()?.getAttribute('aria-label')).toBe('Hyland');
    });

    it('replaces the lockup with the configured logo and names the link after it', () => {
      brandingLogo.set({ url: 'https://nuxeo.example/agentic-ui-config/acme.svg', alt: 'Acme' });
      fixture.detectChanges();

      const img = brandLink()?.querySelector('img.login-brand-logo');
      expect(img?.getAttribute('src')).toBe('https://nuxeo.example/agentic-ui-config/acme.svg');
      expect(img?.getAttribute('alt'))
        .withContext('the link carries the name, so the image is decorative')
        .toBe('');
      expect(img?.getAttribute('crossorigin'))
        .withContext('a redirect from a remote logo must not carry the session cookie')
        .toBe('anonymous');
      expect(brandLink()?.querySelector('sat-logo')).toBeNull();
      expect(brandLink()?.getAttribute('aria-label')).toBe('Acme');
    });

    it('falls back to the application title when the logo has no alt', () => {
      brandingLogo.set({ url: 'https://nuxeo.example/agentic-ui-config/acme.svg', alt: '' });
      bootstrap.set({
        ...DEFAULT_APP_BOOTSTRAP_CONFIG,
        branding: { ...DEFAULT_APP_BOOTSTRAP_CONFIG.branding, applicationTitle: 'Acme Insurance' },
      });
      fixture.detectChanges();

      expect(brandLink()?.getAttribute('aria-label')).toBe('Acme Insurance');
    });
  });

  it('provides a skip link to the sign-in landmark (WCAG 2.4.1)', () => {
    const el = fixture.nativeElement as HTMLElement;
    const skip = el.querySelector('a.login-skip-link');
    expect(skip).toBeTruthy();
    expect(skip?.getAttribute('href')).toBe('#login-main');
    expect(skip?.textContent?.trim()).toContain('Skip to sign in');

    const landmark = el.querySelector('#login-main');
    expect(landmark).toBeTruthy();
    expect(landmark?.getAttribute('tabindex')).toBe('-1');
    expect(landmark?.getAttribute('aria-label')).toBe('Log in');
  });

  it('focuses the username field and cancels navigation when the skip link is activated', () => {
    const el = fixture.nativeElement as HTMLElement;
    const usernameInput = el.querySelector('input[formcontrolname="username"]') as HTMLInputElement;
    const event = new MouseEvent('click', { cancelable: true, bubbles: true });
    const preventSpy = spyOn(event, 'preventDefault').and.callThrough();

    component.skipToSignIn(event);
    fixture.detectChanges();

    expect(preventSpy).toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(usernameInput);
  });

  it('does not expose redundant aria-required on username when HTML required is set (NXENG-753)', async () => {
    const usernameInput = fixture.nativeElement.querySelector(
      'input[formcontrolname="username"]',
    ) as HTMLInputElement;
    expect(usernameInput.required).toBe(true);
    expect(usernameInput.getAttribute('aria-required')).toBeNull();

    const strippedAfterMaterialRestore = new Promise<void>((resolve) => {
      const watch = new MutationObserver(() => {
        if (usernameInput.getAttribute('aria-required') === null) {
          watch.disconnect();
          resolve();
        }
      });
      watch.observe(usernameInput, {
        attributes: true,
        attributeFilter: ['aria-required'],
      });
      usernameInput.setAttribute('aria-required', 'true');
    });

    await strippedAfterMaterialRestore;
    expect(usernameInput.getAttribute('aria-required')).toBeNull();
  });

  it('disconnects the username aria-required observer on destroy (NXENG-753)', async () => {
    const usernameInput = fixture.nativeElement.querySelector(
      'input[formcontrolname="username"]',
    ) as HTMLInputElement;

    fixture.destroy();
    usernameInput.setAttribute('aria-required', 'true');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(usernameInput.getAttribute('aria-required')).toBe('true');
  });

  it('does not expose redundant aria-required on password when HTML required is set (NXENG-755)', async () => {
    const passwordInput = fixture.nativeElement.querySelector(
      'input[formcontrolname="password"]',
    ) as HTMLInputElement;

    expect(passwordInput.required).toBe(true);
    expect(passwordInput.getAttribute('aria-required')).toBeNull();

    const strippedAfterMaterialRestore = new Promise<void>((resolve) => {
      const watch = new MutationObserver(() => {
        if (passwordInput.getAttribute('aria-required') === null) {
          watch.disconnect();
          resolve();
        }
      });
      watch.observe(passwordInput, {
        attributes: true,
        attributeFilter: ['aria-required'],
      });
      passwordInput.setAttribute('aria-required', 'true');
    });

    await strippedAfterMaterialRestore;
    expect(passwordInput.getAttribute('aria-required')).toBeNull();
  });

  it('disconnects the password aria-required observer on destroy (NXENG-755)', async () => {
    const passwordInput = fixture.nativeElement.querySelector(
      'input[formcontrolname="password"]',
    ) as HTMLInputElement;

    fixture.destroy();
    passwordInput.setAttribute('aria-required', 'true');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(passwordInput.getAttribute('aria-required')).toBe('true');
  });

  it('keeps the credential field above siblings when focused (NXENG-749)', () => {
    const secretInput = fixture.nativeElement.querySelector(
      'input[type="password"]',
    ) as HTMLInputElement;
    secretInput.focus();
    fixture.detectChanges();

    const secretField = secretInput.closest('mat-form-field') as HTMLElement;
    const wrapper = secretInput.closest('.mat-mdc-text-field-wrapper') as HTMLElement;
    expect(secretField).toBeTruthy();
    expect(secretField.classList.contains('login-field-password')).toBe(true);
    expect(getComputedStyle(wrapper).overflow).toBe('visible');
    expect(getComputedStyle(secretField).zIndex).toBe('2');
    expect(getComputedStyle(secretField).position).toBe('relative');
    expect(getComputedStyle(secretInput).scrollMarginBlock).not.toBe('0px');
  });

  it('groups username and password in a credentials fieldset (NXENG-752)', () => {
    const el = fixture.nativeElement as HTMLElement;
    const fieldset = el.querySelector('fieldset.login-credentials');
    expect(fieldset).toBeTruthy();
    const legend = fieldset?.querySelector('legend');
    expect(legend?.textContent?.trim()).toBe('Sign in credentials');
    expect(fieldset?.contains(el.querySelector('input[formcontrolname="username"]'))).toBe(true);
    expect(fieldset?.contains(el.querySelector('input[formcontrolname="password"]'))).toBe(true);
    expect(fieldset?.contains(el.querySelector('button.login-submit'))).toBe(false);
  });

  it('shows username required error after empty submit (NXENG-748)', () => {
    component.form.setValue({ username: '', password: '' });
    component.submit();
    fixture.detectChanges();

    const errors = Array.from(fixture.nativeElement.querySelectorAll('mat-error')).map(
      (el) => (el as HTMLElement).textContent?.trim() ?? '',
    );
    expect(errors).toContain('Username is required');
  });

  it('keeps the username field focus affordance visible (NXENG-748)', () => {
    const usernameInput = fixture.nativeElement.querySelector(
      'input[formcontrolname="username"]',
    ) as HTMLInputElement;
    usernameInput.focus();
    fixture.detectChanges();

    const field = usernameInput.closest('.login-field-username') as HTMLElement;
    expect(field).toBeTruthy();
    expect(getComputedStyle(field).overflow).toBe('visible');
    expect(getComputedStyle(usernameInput).scrollMarginTop).not.toBe('0px');
  });

  it('exposes a visually hidden level-one heading for the login page (WCAG 1.3.1)', () => {
    const el = fixture.nativeElement as HTMLElement;
    const heading = el.querySelector('#login-page-heading');
    expect(heading?.tagName).toBe('H1');
    expect(heading?.textContent?.trim()).toBe('Log in');
    expect(heading?.classList.contains('cdk-visually-hidden')).toBe(true);

    const styles = getComputedStyle(heading as HTMLElement);
    expect(styles.position).toBe('absolute');
    expect(styles.height).toBe('1px');
    expect(styles.width).toBe('1px');
    expect(styles.overflow).toBe('hidden');
  });

  it('uses a decorative img for hero art instead of CSS background-image (NXENG-751)', () => {
    const hero = fixture.nativeElement.querySelector('.login-hero');
    expect(hero).withContext('hero region').not.toBeNull();
    if (!hero) {
      return;
    }
    expect(hero.getAttribute('style')).toBeNull();
    expect(getComputedStyle(hero).backgroundImage).toBe('none');

    const img = hero.querySelector('img.login-hero-image');
    expect(img).withContext('hero image element').not.toBeNull();
    if (!img) {
      return;
    }
    expect(img.getAttribute('alt')).toBe('');
    expect(img.getAttribute('src')).toContain('images/Login-background.svg');
  });

  /**
   * NXSAT-318. The Marketplace package serves the app from `/nuxeo/agentic-ui/`, and a
   * root-absolute `/images/…` resolves to the server root there and 404s. This suite runs under
   * base href `/`, where both forms resolve to the same URL, so the packaged base is spelled out.
   */
  it('resolves the hero art against a packaged base href (NXSAT-318)', () => {
    const img = fixture.nativeElement.querySelector('img.login-hero-image') as HTMLImageElement;
    const src = img.getAttribute('src') ?? '';

    expect(new URL(src, 'http://nuxeo.test/nuxeo/agentic-ui/').pathname).toBe(
      '/nuxeo/agentic-ui/images/Login-background.svg',
    );
    expect(new URL(src, 'http://nuxeo.test/').pathname).toBe('/images/Login-background.svg');
  });

  it('fills the hero box without expanding it from intrinsic image size (NXENG-751)', () => {
    const hero = fixture.nativeElement.querySelector('.login-hero') as HTMLElement;
    const img = hero.querySelector('.login-hero-image') as HTMLElement;
    expect(getComputedStyle(hero).position).toBe('relative');
    expect(getComputedStyle(img).position).toBe('absolute');
  });

  it('shows username and password on one form (Web UI parity)', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('input[formcontrolname="username"]')).toBeTruthy();
    expect(el.querySelector('input[formcontrolname="password"]')).toBeTruthy();
    expect(el.textContent).not.toContain('Forgot Password?');
    expect(el.textContent).not.toContain('Remember Me');
    expect(el.textContent).not.toContain('Azure SAML');
    expect(el.textContent).not.toContain('Okta SAML');
    expect(el.textContent).toContain('Log in');
  });

  /**
   * NXENG-743 / NXENG-746. The brand link renders the Satori logo lockup, whose two marks are
   * vendor components each drawing an unlabelled `<svg>`. An `<svg>` with no accessible name is
   * announced as an unnamed image — WCAG 2.1 1.1.1 Non-text Content, level A — and nothing in
   * this repo can put an attribute on that `<svg>`, because the markup belongs to
   * `@hylandsoftware/satori-ui/logo`.
   *
   * The assertion is the guarantee rather than the attribute's placement: no graphic inside the
   * brand link reaches assistive technology, and the link still carries the name. A test for
   * `aria-hidden` on one specific element would pass while a newly added third mark went
   * unhidden.
   *
   * It also enforces both preconditions that make `aria-hidden` the right tool here, rather
   * than leaving them as prose in the PR. `aria-hidden` over focusable content is itself a
   * violation, and a vendor release that adds a focusable element inside the lockup would
   * otherwise introduce `aria_hidden_focus_misuse` with every check still green — the repo's
   * runtime axe harness records the login page as unreachable, so nothing else covers it.
   */
  it('hides the decorative brand logo from assistive technology', () => {
    const link = (fixture.nativeElement as HTMLElement).querySelector('a.login-brand');
    expect(link).toBeTruthy();
    expect(link!.getAttribute('aria-label')).toBe('Hyland');
    // The link itself must stay exposed: it is the only thing that conveys "Hyland".
    expect(link!.closest('[aria-hidden="true"]')).toBeNull();

    const graphics = Array.from(link!.querySelectorAll('svg'));
    expect(graphics).toHaveSize(2);
    for (const svg of graphics) {
      expect(svg.closest('[aria-hidden="true"]')).toBeTruthy();
    }

    const hiddenSubtrees = Array.from(link!.querySelectorAll('[aria-hidden="true"]'));
    expect(hiddenSubtrees).toHaveSize(1);
    for (const hidden of hiddenSubtrees) {
      expect(canTakeFocus(hidden)).toBe(false);
      for (const element of allDescendants(hidden)) {
        expect(canTakeFocus(element)).toBe(false);
      }
    }
  });

  /**
   * The negative control for the guard above, committed rather than run once by hand: an
   * assertion nobody has watched fail is not coverage, and the risk it guards against —
   * a vendor release adding focusable content inside the logo lockup — cannot be staged from
   * our own template, because `<sat-logo>` projects only the two mark components.
   *
   * So the focusable elements are injected into the rendered hidden subtree here. Each is one
   * the earlier hand-written selector missed.
   */
  it('detects focusable content that a vendor release could add inside the hidden lockup', () => {
    const link = (fixture.nativeElement as HTMLElement).querySelector('a.login-brand');
    const hidden = link!.querySelector('[aria-hidden="true"]');
    expect(hidden).toBeTruthy();

    for (const html of [
      '<div tabindex="0">focusable div</div>',
      '<iframe title="probe"></iframe>',
      '<video controls></video>',
      '<audio controls></audio>',
      '<details><summary>probe</summary>body</details>',
      '<a href="#probe">probe</a>',
      '<button type="button">probe</button>',
    ]) {
      hidden!.insertAdjacentHTML('beforeend', html);
      const injected = hidden!.lastElementChild!;
      const reached = [injected, ...allDescendants(injected)].some(canTakeFocus);
      expect(reached).withContext(`the guard must see ${html} as focusable`).toBe(true);
      injected.remove();
    }

    // The same, one level deeper: focusable content inside a shadow root attached to the
    // element the walk starts from. An earlier version of `allDescendants` checked only its
    // children's shadow roots, so this case walked straight past.
    const host = document.createElement('div');
    hidden!.append(host);
    host.attachShadow({ mode: 'open' }).innerHTML = '<button type="button">probe</button>';
    expect([host, ...allDescendants(host)].some(canTakeFocus))
      .withContext('the guard must see focusable content inside a shadow root on the host')
      .toBe(true);
    host.remove();
  });

  it('names required fields in the label instead of a color-only marker', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Username (required)');
    expect(el.textContent).toContain('Password (required)');
    expect(el.querySelector('.mat-mdc-form-field-required-marker')).toBeNull();
  });

  it('prefixes validation errors with text, not color alone', () => {
    component.form.setValue({ username: '', password: '' });
    component.submit();
    fixture.detectChanges();

    const error = fixture.nativeElement.querySelector('mat-error') as HTMLElement | null;
    expect(error).withContext('expected a visible mat-error').not.toBeNull();
    expect(error!.textContent?.trim()).toContain('Username is required');
    expect(getComputedStyle(error!, '::before').content).toContain('Error');
  });

  it('submits username and password together', async () => {
    const router = TestBed.inject(Router);
    spyOn(router, 'navigateByUrl').and.returnValue(Promise.resolve(true));

    component.form.setValue({ username: MOCK_LOGIN_USER, password: MOCK_LOGIN_SECRET });
    component.submit();
    await Promise.resolve();

    expect(auth.login).toHaveBeenCalledWith(MOCK_LOGIN_USER, MOCK_LOGIN_SECRET, false);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/dashboard');
  });

  it('does not submit when fields are empty', () => {
    component.form.setValue({ username: '', password: '' });
    component.submit();

    expect(auth.login).not.toHaveBeenCalled();
  });

  it('starts SAML login for external providers', () => {
    component.startSamlLogin(samlEndpoint);
    expect(auth.startSamlLogin).toHaveBeenCalledWith(samlEndpoint);
  });

  it('disables Log in when required fields are empty', () => {
    component.form.setValue({ username: '', password: '' });
    fixture.detectChanges();

    expect(component.submitDisabled()).toBe(true);
    const submit = (fixture.nativeElement as HTMLElement).querySelector(
      'button.login-submit',
    ) as HTMLButtonElement;
    expect(submit.getAttribute('aria-disabled')).toBe('true');
    expect(submit.tabIndex).toBeGreaterThanOrEqual(0);
    submit.focus();
    expect(document.activeElement).toBe(submit);
  });

  it('enables Log in when username and password are present', () => {
    component.form.setValue({ username: MOCK_LOGIN_USER, password: MOCK_LOGIN_SECRET });
    fixture.detectChanges();

    expect(component.submitDisabled()).toBe(false);
  });

  it('syncs browser-autofilled credentials into the reactive form', () => {
    const el = fixture.nativeElement as HTMLElement;
    const usernameInput = el.querySelector('input[formcontrolname="username"]') as HTMLInputElement;
    const passwordInput = el.querySelector('input[formcontrolname="password"]') as HTMLInputElement;

    component.form.setValue({ username: '', password: '' });
    usernameInput.value = MOCK_LOGIN_USER;
    passwordInput.value = MOCK_LOGIN_SECRET;
    component.onCredentialInput();
    fixture.detectChanges();

    expect(component.form.getRawValue()).toEqual({
      username: MOCK_LOGIN_USER,
      password: MOCK_LOGIN_SECRET,
    });
    expect(component.submitDisabled()).toBe(false);
  });

  it('submits autofilled password even when reactive form was stale', async () => {
    const router = TestBed.inject(Router);
    spyOn(router, 'navigateByUrl').and.returnValue(Promise.resolve(true));

    const el = fixture.nativeElement as HTMLElement;
    const usernameInput = el.querySelector('input[formcontrolname="username"]') as HTMLInputElement;
    const passwordInput = el.querySelector('input[formcontrolname="password"]') as HTMLInputElement;

    component.form.setValue({ username: MOCK_LOGIN_USER, password: '' });
    passwordInput.value = MOCK_LOGIN_SECRET;

    component.submit();
    await Promise.resolve();

    expect(auth.login).toHaveBeenCalledWith(MOCK_LOGIN_USER, MOCK_LOGIN_SECRET, false);
  });

  it('reacts to scoped autofill animation names from emulated encapsulation', () => {
    const el = fixture.nativeElement as HTMLElement;
    const usernameInput = el.querySelector('input[formcontrolname="username"]') as HTMLInputElement;
    const passwordInput = el.querySelector('input[formcontrolname="password"]') as HTMLInputElement;
    usernameInput.value = MOCK_LOGIN_USER;
    passwordInput.value = MOCK_LOGIN_SECRET;

    component.onAutofillAnimation({
      animationName: 'ng-c1234567890_login-autofill-start',
    } as AnimationEvent);
    fixture.detectChanges();

    expect(component.form.getRawValue()).toEqual({
      username: MOCK_LOGIN_USER,
      password: MOCK_LOGIN_SECRET,
    });
  });

  /**
   * NXENG-948 / NXENG-756. Login fields and footer text must live inside a landmark so
   * screen-reader users can navigate by region — WCAG 2.1 1.3.1 (IBM aria_content_in_landmark,
   * issue 3563006691) / axe `region`.
   */
  describe('accessibility', () => {
    it('wraps the login surface in a named main landmark', () => {
      const root = fixture.nativeElement as HTMLElement;
      const main = root.querySelector('main.login-panel');
      expect(main).not.toBeNull();
      expect(main?.getAttribute('id')).toBe('login-main');
      expect(main?.getAttribute('aria-label')).toBe('Log in');
      expect(main?.querySelector('form.login-form')).not.toBeNull();
      expect(main?.querySelector('footer.login-footer')).not.toBeNull();
    });

    it('hides the decorative hero image from assistive technologies', () => {
      const hero = (fixture.nativeElement as HTMLElement).querySelector('.login-hero');
      expect(hero?.getAttribute('aria-hidden')).toBe('true');
    });
  });

  it('shows a sign-in failure in the active language, from its catalogue key', () => {
    const snackBar = fixture.debugElement.injector.get(MatSnackBar);
    spyOn(snackBar, 'open');

    auth.login.and.returnValue(
      new Observable((subscriber) => {
        subscriber.error(new SignInError('login.message.server-unreachable'));
      }),
    );

    component.form.setValue({ username: 'user', password: 'secret' });
    component.submit();

    expect(snackBar.open).toHaveBeenCalledWith(
      'Could not reach Nuxeo. Check the server, proxy, and URL.',
      'Dismiss',
      { duration: 6000 },
    );
  });

  it('resets submitting and shows snackbar on auth failure', () => {
    const snackBar = fixture.debugElement.injector.get(MatSnackBar);
    spyOn(snackBar, 'open');

    auth.login.and.returnValue(
      new Observable((subscriber) => {
        subscriber.error(new Error('Invalid username or password.'));
      }),
    );

    component.form.setValue({ username: 'bad-user', password: 'bad-secret' });
    component.submit();

    expect(auth.login).toHaveBeenCalled();
    expect(snackBar.open).toHaveBeenCalledWith('Invalid username or password.', 'Dismiss', {
      duration: 6000,
    });
    expect(component.submitting()).toBe(false);
  });
});
