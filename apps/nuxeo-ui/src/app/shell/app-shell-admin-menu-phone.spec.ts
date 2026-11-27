/**
 * The administration drawer at a phone's width: at 320 CSS pixels it collapses into a menu button
 * above the page, so that each administration page has the window's width; the button opens it
 * over the page, modal, and closing it gives the focus back. On a desktop it sits beside the page
 * as before. PR #771 found it squeezing every administration page at 320.
 *
 * Real Chrome, real layout: Karma runs each spec in an iframe, and the iframe's width is the test
 * window's, so resizing it is what a phone's screen does to the media queries, `BreakpointObserver`
 * and the layout. The whole application is routed, the shell and the administration area with it,
 * and axe runs at WCAG 2.2 AA, colour contrast and target size included, on what the change draws:
 * the drawer, the button and the page beside them.
 */
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import axe from 'axe-core';
import { of } from 'rxjs';

import { appConfig } from '../app.config';
import { AuthService } from '../auth/auth.service';
import { PHONE_WIDTH_QUERY } from './app-shell.component';

const WCAG22 = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** The test window resized: the iframe Karma runs the spec in, so the media queries follow it. */
async function resizeTo(width: number): Promise<void> {
  const frame = window.frameElement as HTMLIFrameElement | null;
  if (frame === null)
    throw new Error('Karma must run the specs in its iframe to resize the window');
  frame.style.width = `${width}px`;
  frame.style.height = '800px';
  for (let tries = 0; tries < 100 && window.innerWidth !== width; tries++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  expect(window.innerWidth).withContext('the test window is resized').toBe(width);
}

async function axeViolations(root: Element): Promise<string[]> {
  const results = await axe.run(root, { runOnly: { type: 'tag', values: WCAG22 } });
  return results.violations.map(
    (violation) =>
      `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(' | ')}`,
  );
}

describe('AppShellComponent: the administration menu at a phone width and on a desktop', () => {
  const authMock = {
    isAuthenticated: signal(true),
    username: signal('Administrator'),
    hasAdministrationAccess: signal(true),
    isAdministrator: signal(true),
    isPowerUser: signal(false),
    groups: signal(['administrators']),
    ensureHydrated: () => of(undefined),
    basicCredentials: () => null,
    shareAuthToken: () => null,
    logout: () => undefined,
  } as unknown as AuthService;

  let http: HttpTestingController;
  let harness: RouterTestingHarness;
  /** The app's English catalogue, as Karma serves the app's assets, for the texts axe reads. */
  let english: object = {};

  beforeAll(async () => {
    const response = await fetch('/i18n/en.json');
    expect(response.ok).withContext('Karma serves the English catalogue').toBe(true);
    english = (await response.json()) as object;
  });

  /**
   * Every request answered: the English catalogue for it, an empty list for a vocabulary, and an
   * empty page of documents otherwise, as a server with nothing in it would, so the pages settle.
   */
  function answerAll(): void {
    for (const request of http.match(() => true)) {
      if (request.cancelled) continue;
      const url = request.request.urlWithParams;
      request.flush(
        /\/i18n\/en\.json$/.test(request.request.url) && !url.includes('satori')
          ? english
          : /\/i18n\//.test(url)
            ? {}
            : /Directory\.|\/directory\b/.test(url)
              ? []
              : {
                  entries: [],
                  resultsCount: 0,
                  totalSize: 0,
                  currentPageSize: 0,
                  numberOfPages: 0,
                },
      );
    }
  }

  /**
   * Change detection as the application runs it, its after-render hooks included, where the drawer
   * moves the focus; the requests answered; and time for the drawer's transition, 400 ms, to end,
   * since the drawer takes or gives back the focus when it has. Detected last, after the wait.
   */
  async function step(ms = 800): Promise<void> {
    for (let round = 0; round < 4; round++) {
      answerAll();
      harness.detectChanges();
      TestBed.tick();
      await new Promise((resolve) => setTimeout(resolve, ms / 4));
    }
    answerAll();
    harness.detectChanges();
    TestBed.tick();
  }

  async function open(width: number, url = '/administration/vocabularies'): Promise<HTMLElement> {
    await resizeTo(width);
    await TestBed.configureTestingModule({
      providers: [...appConfig.providers, provideHttpClientTesting()],
    })
      .overrideProvider(AuthService, { useValue: authMock })
      .compileComponents();
    http = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create();
    answerAll();
    await harness.navigateByUrl(url);
    await step();
    const root = document.querySelector('app-shell');
    if (!(root instanceof HTMLElement)) throw new Error('the shell did not render');
    expect(root.querySelector('lib-administration-shell'))
      .withContext('the administration area is routed')
      .toBeTruthy();
    return root;
  }

  const content = (root: HTMLElement) => root.querySelector('mat-sidenav-content') as HTMLElement;
  const drawer = (root: HTMLElement) => root.querySelector('.nav-drawer-sidenav') as HTMLElement;
  const trigger = (root: HTMLElement) =>
    root.querySelector<HTMLButtonElement>('button.admin-menu-trigger');
  const adminPage = (root: HTMLElement) =>
    (root.querySelector('lib-administration-shell') as HTMLElement).getBoundingClientRect();

  const closeButton = (root: HTMLElement) =>
    root.querySelector<HTMLButtonElement>('button.admin-menu-close');
  const header = (root: HTMLElement) => root.querySelector('sat-app-header') as HTMLElement;

  /**
   * Open the menu with its button. `focused` false is a click that does not focus the button, as
   * Safari's does not: the drawer then has nothing to give the focus back to, and the shell does.
   */
  async function openMenu(root: HTMLElement, focused = true): Promise<HTMLButtonElement> {
    const button = trigger(root) as HTMLButtonElement;
    if (focused) button.focus();
    else (document.activeElement as HTMLElement | null)?.blur();
    button.click();
    await step();
    return button;
  }

  /**
   * The page has the window's width, nothing beside it, and the bar's height comes out of it: the
   * page and the bar fit the scroll box together, so the bar adds no scroll, and no scrollbar's
   * width, on a system that draws classic scrollbars.
   */
  function expectPageAtWindowWidth(root: HTMLElement): void {
    // The drawer takes none of the container it shares with the page. Compared with the
    // container, not the window: on Linux and Windows the shell's own scroll boxes draw classic
    // scrollbars, so the container is narrower than the window there (290 pixels at 320 in CI).
    const box = content(root);
    const shared = (root.querySelector('.shell-content') as HTMLElement).getBoundingClientRect();
    expect(Math.round(box.getBoundingClientRect().left)).toBe(Math.round(shared.left));
    expect(Math.round(box.getBoundingClientRect().width)).toBe(Math.round(shared.width));
    expect(Math.round(shared.left)).toBe(0);
    const page = adminPage(root);
    expect([Math.round(page.left), Math.round(page.width)]).toEqual([0, box.clientWidth]);
    const bar = (root.querySelector('.admin-menu-bar') as HTMLElement).getBoundingClientRect();
    expect(Math.round(bar.height + page.height))
      .withContext('the bar and the page fit the scroll box')
      .toBeLessThanOrEqual(box.clientHeight);
    // And asked directly: the box has nothing to scroll, an empty page in it.
    expect(box.scrollHeight).withContext('nothing to scroll').toBeLessThanOrEqual(box.clientHeight);
  }

  async function pressEscape(root: HTMLElement): Promise<void> {
    (document.activeElement ?? drawer(root)).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }),
    );
    await step();
  }

  /** Closed, with the button saying so and holding the focus, and the header usable again. */
  function expectClosedWithFocusOnButton(root: HTMLElement, button: HTMLButtonElement): void {
    expect(drawer(root).classList.contains('mat-drawer-opened')).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).withContext('the focus is back on the button').toBe(button);
    expect(header(root).hasAttribute('inert')).toBe(false);
    // The section stays: the button is still there to open the menu again.
    expect(trigger(root)).toBe(button);
  }

  afterEach(() => {
    if (http) {
      answerAll();
      http.verify();
    }
    const frame = window.frameElement as HTMLIFrameElement | null;
    if (frame) {
      frame.style.width = '';
      frame.style.height = '';
    }
  });

  describe('at 320 CSS pixels', () => {
    it('collapses the drawer into a menu button, and gives the page the window width, which axe passes', async () => {
      const root = await open(320);
      expect(window.matchMedia(PHONE_WIDTH_QUERY).matches).toBe(true);
      expect(drawer(root).classList.contains('mat-drawer-opened'))
        .withContext('the drawer is collapsed, not beside the page')
        .toBe(false);
      const button = trigger(root);
      expect(button).withContext('the menu button shows above the page').toBeTruthy();
      expect(button?.textContent?.trim()).toBe('Administration menu');
      expect(button?.getAttribute('aria-expanded')).toBe('false');
      expect(document.getElementById(button?.getAttribute('aria-controls') ?? '')).toBe(
        drawer(root),
      );
      expectPageAtWindowWidth(root);
      expect(await axeViolations(root.querySelector('.shell-content') as Element)).toEqual([]);
    });

    it('opens the menu over the page, modal, with the focus in it, which axe passes', async () => {
      const root = await open(320);
      const button = await openMenu(root);
      const opened = drawer(root);
      expect(opened.classList.contains('mat-drawer-opened')).toBe(true);
      expect(opened.classList.contains('mat-drawer-over'))
        .withContext('over the page, not beside it')
        .toBe(true);
      expect([opened.getAttribute('role'), opened.getAttribute('aria-modal')]).toEqual([
        'dialog',
        'true',
      ]);
      expect(opened.getAttribute('aria-label')).toBe('Administration menu');
      expect(button.getAttribute('aria-expanded')).toBe('true');
      // The focus moves into the menu, to its first control: its own close button.
      expect(document.activeElement).toBe(closeButton(root));
      expect(closeButton(root)?.getAttribute('aria-label')).toBe('Close the administration menu');
      // The focus is held in it: the trap's anchors are live on both sides of the drawer.
      const anchors = [opened.previousElementSibling, opened.nextElementSibling].filter((element) =>
        element?.classList.contains('cdk-focus-trap-anchor'),
      );
      expect(anchors.map((anchor) => anchor?.getAttribute('tabindex'))).toEqual(['0', '0']);
      // Modal to the pointer too: the header and the platform's menu, outside the backdrop, are
      // inert while it is open.
      expect(header(root).hasAttribute('inert')).toBe(true);
      expect(root.querySelector('sat-platform-nav')?.hasAttribute('inert')).toBe(true);
      // The page beneath is not moved: the menu covers it.
      expect(content(root).getBoundingClientRect().left).toBe(0);
      expect(await axeViolations(root.querySelector('.shell-content') as Element)).toEqual([]);
    });

    it('closes on Escape, giving the focus back to the button', async () => {
      const root = await open(320);
      const button = await openMenu(root);
      (document.activeElement ?? drawer(root)).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }),
      );
      // The header is usable again as soon as the menu begins to close, not once it has.
      await new Promise((resolve) => setTimeout(resolve, 60));
      harness.detectChanges();
      TestBed.tick();
      expect(header(root).hasAttribute('inert'))
        .withContext('the header, while the menu is still closing')
        .toBe(false);
      await step();
      expectClosedWithFocusOnButton(root, button);
    });

    it('gives the focus back to the button itself when the click that opened it did not focus it, as in Safari', async () => {
      const root = await open(320);
      const button = await openMenu(root, false);
      expect(drawer(root).contains(document.activeElement)).toBe(true);
      await pressEscape(root);
      expectClosedWithFocusOnButton(root, button);
    });

    it('closes from its own close button, and from the backdrop', async () => {
      const root = await open(320);
      const button = await openMenu(root);
      closeButton(root)?.click();
      await step();
      expectClosedWithFocusOnButton(root, button);
      await openMenu(root);
      (root.querySelector('.mat-drawer-backdrop') as HTMLElement).click();
      await step();
      expectClosedWithFocusOnButton(root, button);
    });

    it('closes when a page is chosen in it, opens that page at the window width, and gives the focus back', async () => {
      const root = await open(320);
      const button = await openMenu(root);
      const audit = [
        ...drawer(root).querySelectorAll<HTMLButtonElement>('button.settings-item'),
      ].find((item) => item.textContent?.trim() === 'Audit');
      expect(audit).withContext('the menu lists the audit page').toBeTruthy();
      audit?.focus();
      audit?.click();
      await step();
      await step();
      expect(TestBed.inject(Router).url).toBe('/administration/audit');
      expectClosedWithFocusOnButton(root, button);
      expectPageAtWindowWidth(root);
    });

    it("opens the menu when Administration is chosen again in the platform's menu, keeping the section", async () => {
      const root = await open(320);
      const entry = root.querySelector<HTMLElement>('[data-nav-id="app.navbar.administration"]');
      expect(entry).withContext("the platform's menu has the Administration entry").toBeTruthy();
      entry?.click();
      await step();
      expect(drawer(root).classList.contains('mat-drawer-opened')).toBe(true);
      expect(trigger(root)?.getAttribute('aria-expanded')).toBe('true');
      expect(TestBed.inject(Router).url).toBe('/administration/vocabularies');
    });

    it('forgets that it was open when the window widens, so it is collapsed when it narrows again', async () => {
      const root = await open(320);
      await openMenu(root);
      await resizeTo(1280);
      await step();
      expect(drawer(root).classList.contains('mat-drawer-side')).toBe(true);
      expect(trigger(root)).toBeNull();
      await resizeTo(320);
      await step();
      expect(drawer(root).classList.contains('mat-drawer-opened'))
        .withContext('collapsed, not open over the page without the focus')
        .toBe(false);
      expect(trigger(root)?.getAttribute('aria-expanded')).toBe('false');
      expect(header(root).hasAttribute('inert')).toBe(false);
    });
  });

  describe('on a desktop, 1280 CSS pixels', () => {
    it('keeps the drawer beside the page, with no menu button, which axe passes', async () => {
      const root = await open(1280);
      expect(window.matchMedia(PHONE_WIDTH_QUERY).matches).toBe(false);
      const side = drawer(root);
      expect(side.classList.contains('mat-drawer-opened')).toBe(true);
      expect(side.classList.contains('mat-drawer-side')).toBe(true);
      expect(side.getAttribute('role')).toBeNull();
      expect(trigger(root)).toBeNull();
      // Beside it, not over it: the page starts where the drawer ends.
      expect(Math.round(content(root).getBoundingClientRect().left)).toBe(
        Math.round(side.getBoundingClientRect().right),
      );
      expect(await axeViolations(root.querySelector('.shell-content') as Element)).toEqual([]);
    });

    it('collapses the drawer when the window narrows to a phone, and puts it back when it widens', async () => {
      const root = await open(1280);
      await resizeTo(320);
      await step();
      expect(drawer(root).classList.contains('mat-drawer-opened')).toBe(false);
      expect(trigger(root)).toBeTruthy();
      // The focus is not moved for a resize: the menu was never opened by the button.
      expect(document.activeElement).not.toBe(trigger(root));
      await resizeTo(1280);
      await step();
      expect(drawer(root).classList.contains('mat-drawer-opened')).toBe(true);
      expect(trigger(root)).toBeNull();
    });
  });
});
