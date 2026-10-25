import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { SatPlatformNavState } from '@hylandsoftware/satori-ui/platform-nav';

import { appConfig } from '../app.config';
import { AuthService } from '../auth/auth.service';
import { AppShellComponent } from './app-shell.component';

/**
 * Whether `node` sits inside an `aria-hidden="true"` subtree.
 */
function isAriaHiddenFromAssistiveTech(node: Node): boolean {
  for (let el: Element | null = node instanceof Element ? node : node.parentElement; el;) {
    if (el.getAttribute('aria-hidden') === 'true') return true;
    el = el.parentElement;
  }
  return false;
}

/**
 * Visible text IBM Equal Access treats as labelling the control — text nodes that are not
 * aria-hidden and not `display:none` / `visibility:hidden`.
 */
function visibleLabelTexts(root: Element): string[] {
  const texts: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentElement;
      if (!parent || isAriaHiddenFromAssistiveTech(parent)) return;
      const style = getComputedStyle(parent);
      if (style.display === 'none' || style.visibility === 'hidden') return;
      const t = node.textContent?.trim();
      if (t) texts.push(t);
      return;
    }
    if (node instanceof Element) {
      if (isAriaHiddenFromAssistiveTech(node)) return;
      for (const child of Array.from(node.childNodes)) walk(child);
    }
  };
  walk(root);
  return texts;
}

/** Full visible label IBM compares against the accessible name (WCAG 2.5.3). */
function visibleLabelJoined(root: Element): string {
  return visibleLabelTexts(root).join(' ').replace(/\s+/g, ' ').trim();
}

/** Accessible name when `aria-label` is set (same precedence as accname). */
function accessibleName(el: Element): string {
  const labelledBy = el.getAttribute('aria-labelledby')?.trim();
  if (labelledBy) {
    const root = el.getRootNode();
    const doc = root instanceof Document || root instanceof ShadowRoot ? root : null;
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => doc?.getElementById(id)?.textContent?.trim())
      .filter(Boolean);
    if (parts.length) return parts.join(' ');
  }
  const ariaLabel = el.getAttribute('aria-label')?.trim();
  if (ariaLabel) return ariaLabel;
  return visibleLabelTexts(el).join(' ');
}

/**
 * WCAG 2.5.3 / IBM `label_name_visible` (Issue 2972081309 on `#sat-platform-nav-user-profile`).
 *
 * The vendor profile button sets `aria-label` to the display name while also rendering
 * auto-generated avatar initials as visible text. Those initials are not part of the
 * accessible name, so the visible label and the name diverge.
 */
describe('platform sidebar — user profile label in name (NXENG-894)', () => {
  const authMock = {
    isAuthenticated: signal(true),
    username: signal('Administrator'),
    hasAdministrationAccess: signal(true),
    isAdministrator: signal(true),
    basicCredentials: () => null,
    shareAuthToken: () => null,
    logout: () => undefined,
  } as unknown as AuthService;

  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppShellComponent],
      providers: [...appConfig.providers, provideHttpClientTesting()],
    })
      .overrideProvider(AuthService, { useValue: authMock })
      .compileComponents();

    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    const emptyDocumentList = {
      entries: [],
      totalSize: 0,
      currentPageSize: 0,
      currentPageIndex: 0,
      numberOfPages: 0,
    };
    http.match(() => true).forEach((request) => request.flush(emptyDocumentList));
    http.verify();
  });

  function profileButton(root: HTMLElement): HTMLButtonElement {
    const btn = root.querySelector('#sat-platform-nav-user-profile');
    expect(btn).withContext('user profile button must render').toBeTruthy();
    return btn as HTMLButtonElement;
  }

  /** Projected avatar mat-icon (any markup — class is not part of the regression contract). */
  function profileProjectedMatIcon(button: Element): Element {
    const icon = button.querySelector('mat-icon');
    expect(icon).withContext('profile button must project a mat-icon').toBeTruthy();
    return icon as Element;
  }

  /** DOM text of the projected profile icon (aria-hidden ligature text tripped IBM 2972081309). */
  function profileProjectedIconText(button: Element): string {
    return profileProjectedMatIcon(button).textContent?.trim() ?? '';
  }

  it('does not render vendor initials that diverge from the aria-label (IBM 2972081309)', () => {
    const fixture = TestBed.createComponent(AppShellComponent);
    // IBM scan and the ticket repro use the expanded sidebar label, not the collapsed rail.
    TestBed.inject(SatPlatformNavState).toggleCollapsed();
    fixture.detectChanges();

    const button = profileButton(fixture.nativeElement as HTMLElement);
    expect(button.getAttribute('aria-label')).toBe('Administrator');

    // Without a projected icon/img the vendor draws initials as extra visible text that is
    // not part of aria-label — the label_name_visible violation on #sat-platform-nav-user-profile.
    expect(button.querySelector('.sat-platform-nav-user-avatar'))
      .withContext('profile button must not auto-generate initials beside the display name')
      .toBeNull();

    const name = accessibleName(button);
    const visible = visibleLabelJoined(button);
    expect(visible)
      .withContext(
        'profile button must expose a non-empty visible display name (not only aria-label)',
      )
      .toBe('Administrator');
    expect(name.toLowerCase())
      .withContext(
        `accessible name "${name}" must contain the full visible label "${visible}" (IBM label_name_visible)`,
      )
      .toContain(visible.toLowerCase());
    expect(profileProjectedIconText(button))
      .withContext('profile icon must not expose Material ligature name as DOM text')
      .not.toContain('account_circle');
  });

  it('renders the profile avatar glyph via CSS codepoint (NXENG-894)', () => {
    const fixture = TestBed.createComponent(AppShellComponent);
    TestBed.inject(SatPlatformNavState).toggleCollapsed();
    fixture.detectChanges();

    const icon = profileProjectedMatIcon(profileButton(fixture.nativeElement as HTMLElement));
    const glyph = getComputedStyle(icon, '::before');
    const content = glyph.content.replace(/"/g, '');
    expect(content)
      .withContext('profile mat-icon must expose account_circle via ::before content')
      .not.toBe('none');
    expect(content.length).toBeGreaterThan(0);
    expect(content.codePointAt(0))
      .withContext('::before must use Material Icons account_circle codepoint U+E853')
      .toBe(0xe853);
    expect(glyph.fontFamily.toLowerCase()).toContain('material icons');
    expect(Number.parseFloat(glyph.fontSize)).toBeGreaterThanOrEqual(24);
  });

  it('keeps label in name when the sidebar rail is collapsed (IBM 2972081309)', () => {
    const navState = TestBed.inject(SatPlatformNavState);
    const fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();

    if (!navState.collapsed()) {
      navState.toggleCollapsed();
      fixture.detectChanges();
    }

    const button = profileButton(fixture.nativeElement as HTMLElement);
    const name = accessibleName(button);
    const visible = visibleLabelJoined(button);
    expect(profileProjectedIconText(button))
      .withContext('profile icon must not expose Material ligature name as DOM text')
      .not.toContain('account_circle');
    if (visible) {
      expect(name.toLowerCase()).toContain(visible.toLowerCase());
    }
  });

  it('opens the settings drawer when the profile control is activated', () => {
    const fixture = TestBed.createComponent(AppShellComponent);
    const component = fixture.componentInstance;
    TestBed.inject(SatPlatformNavState).toggleCollapsed();
    fixture.detectChanges();

    profileButton(fixture.nativeElement as HTMLElement).click();
    fixture.detectChanges();

    expect(component.drawerOpen()).toBe(true);
    expect(component.activeDrawerItem()?.path).toBe('/settings');
  });
});
