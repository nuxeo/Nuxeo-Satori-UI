import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { By } from '@angular/platform-browser';
import { MatTooltip } from '@angular/material/tooltip';

import { SatPlatformNavState } from '@hylandsoftware/satori-ui/platform-nav';
import { TranslateService } from '@ngx-translate/core';

import { appConfig } from '../app.config';
import { AuthService } from '../auth/auth.service';
import { AppShellComponent } from './app-shell.component';

const RAIL_TOGGLE_SELECTOR = '#sat-platform-nav-title-icon';
const HOST_VISIBLE_LABEL_CLASS = 'sat-platform-nav-rail-toggle-visible-label';

function isAriaHiddenFromAssistiveTech(node: Node): boolean {
  for (let el: Element | null = node instanceof Element ? node : node.parentElement; el;) {
    if (el.getAttribute('aria-hidden') === 'true') return true;
    el = el.parentElement;
  }
  return false;
}

/** Visible text nodes IBM treats as on-screen labelling (not aria-hidden, not hidden CSS). */
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

function visibleLabelJoined(root: Element): string {
  return visibleLabelTexts(root).join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * NXENG-927 — production AppShell must keep the Satori rail toggle icon-only (no host
 * visible-label span). Minimal sat-platform-nav hosts cannot catch a reintroduced workaround.
 */
describe('App shell — platform nav rail toggle icon-only (NXENG-927)', () => {
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
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', {
      'sat.platform-nav.expand': '⟦Expand navigation⟧',
      'sat.platform-nav.collapse': '⟦Collapse navigation⟧',
      'app.nav.toggle': 'Toggle navigation',
    });
    translate.use('en');
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

  function railToggle(root: HTMLElement): HTMLButtonElement {
    const button = root.querySelector(RAIL_TOGGLE_SELECTOR) as HTMLButtonElement | null;
    expect(button).withContext('production rail expand/collapse toggle renders').toBeTruthy();
    return button as HTMLButtonElement;
  }

  it('renders icon-only expand control in production AppShell when the rail is collapsed', () => {
    const fixture = TestBed.createComponent(AppShellComponent);
    const navState = TestBed.inject(SatPlatformNavState);
    if (!navState.collapsed()) {
      navState.toggleCollapsed();
    }
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const button = railToggle(root);
    expect(button.querySelector(`.${HOST_VISIBLE_LABEL_CLASS}`)).toBeNull();
    const visible = visibleLabelJoined(button);
    expect(visible).not.toContain('⟦Expand navigation⟧');
    expect(visible).not.toContain('⟦Collapse navigation⟧');
    expect(button.getAttribute('aria-label')?.trim()).toBe('⟦Expand navigation⟧');
    expect(button.getAttribute('data-automation-id')).toBe('platform-nav-expand-button');

    const tooltip = fixture.debugElement
      .query(By.css(RAIL_TOGGLE_SELECTOR))
      .injector.get(MatTooltip, null);
    expect(tooltip?.message).toBe('⟦Expand navigation⟧');
  });

  it('renders icon-only collapse control in production AppShell when the rail is expanded', () => {
    const fixture = TestBed.createComponent(AppShellComponent);
    const navState = TestBed.inject(SatPlatformNavState);
    if (navState.collapsed()) {
      navState.toggleCollapsed();
    }
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const button = railToggle(root);
    expect(button.querySelector(`.${HOST_VISIBLE_LABEL_CLASS}`)).toBeNull();
    const visible = visibleLabelJoined(button);
    expect(visible).not.toContain('⟦Expand navigation⟧');
    expect(visible).not.toContain('⟦Collapse navigation⟧');
    expect(button.getAttribute('aria-label')?.trim()).toBe('⟦Collapse navigation⟧');
    expect(button.getAttribute('data-automation-id')).toBe('platform-nav-collapse-button');
  });
});
