import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { By } from '@angular/platform-browser';
import { MatTooltip } from '@angular/material/tooltip';

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
 * Whether `el` is visible to the eye: rendered, not `visibility: hidden`, and neither it nor an
 * ancestor fully transparent. `aria-hidden` plays no part. It hides content from assistive
 * technology, not from sight, and WCAG 2.5.3 is about what is presented visually.
 */
function isPainted(el: Element): boolean {
  return el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
}

/**
 * Whether a text node inside `root` shows more than a pixel once it is cut to the box of every
 * element from its parent up to `root` that clips: `overflow` other than `visible`, or a `clip`
 * or `clip-path`. Visually hidden text, clipped inside a one-pixel box, does not. Clipping by
 * elements outside `root` is not measured.
 */
function hasVisibleArea(text: Text, root: Element): boolean {
  const range = document.createRange();
  range.selectNodeContents(text);
  let { left, top, right, bottom } = range.getBoundingClientRect();
  for (let el = text.parentElement; el; el = el === root ? null : el.parentElement) {
    const style = getComputedStyle(el);
    const clips =
      style.overflowX !== 'visible' ||
      style.overflowY !== 'visible' ||
      style.clip !== 'auto' ||
      style.clipPath !== 'none';
    if (!clips) continue;
    const box = el.getBoundingClientRect();
    left = Math.max(left, box.left);
    top = Math.max(top, box.top);
    right = Math.min(right, box.right);
    bottom = Math.min(bottom, box.bottom);
  }
  return right - left > 1 && bottom - top > 1;
}

/** The text `root` shows on screen, in document order, `aria-hidden` text included. */
function paintedText(root: Element): string {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    const parent = text.parentElement;
    if (parent && isPainted(parent) && hasVisibleArea(text, root)) parts.push(text.data);
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * The words of `text`: NFKD-normalised and case-folded, with parenthesised text dropped and
 * anything that is not a letter or a digit read as a space. That is how axe-core 4.14's
 * `label-content-name-mismatch` prepares text, although it splits words with `Intl.Segmenter`
 * where this splits on spaces, which differs only for scripts written without them. 4.13
 * compared characters, which let initials pass whenever they are a substring of the name.
 */
function words(text: string): string[] {
  let folded = text.normalize('NFKD').toLowerCase();
  for (let previous = ''; previous !== folded;) {
    previous = folded;
    folded = folded.replace(/\([^()]*\)/g, '');
  }
  return folded
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter(Boolean);
}

/** Whether every word of `label` appears in `name`, consecutively and in the same order. */
function containsWords(name: string, label: string): boolean {
  const haystack = words(name);
  const needle = words(label);
  for (let start = 0; start + needle.length <= haystack.length; start++) {
    if (needle.every((word, offset) => haystack[start + offset] === word)) return true;
  }
  return false;
}

/**
 * WCAG 2.5.3 / IBM `label_name_visible` (Issue 2972081309 on `#sat-platform-nav-user-profile`).
 *
 * The upstream profile button sets `aria-label` to the display name, and the avatar beside it
 * draws initials as visible text. Unless the accessible name contains those initials, the
 * visible label and the name diverge. The shell names the control with `aria-labelledby`, the
 * initials and then the display name, and the cases below hold it to what is painted.
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
  /** The mock's username, writable, and the display name every case starts from. */
  const username = authMock.username as WritableSignal<string>;
  const displayName = username();

  let http: HttpTestingController;

  beforeEach(async () => {
    username.set(displayName);
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

  /** Projected avatar element (sat-avatar after NXSAT-673 migration, mat-icon before). */
  function profileProjectedAvatar(button: Element): Element {
    const avatar = button.querySelector('sat-avatar') ?? button.querySelector('mat-icon');
    expect(avatar).withContext('profile button must project a sat-avatar or mat-icon').toBeTruthy();
    return avatar as Element;
  }

  /** DOM text of the projected profile avatar (ligature text tripped IBM 2972081309). */
  function profileProjectedIconText(button: Element): string {
    return profileProjectedAvatar(button).textContent?.trim() ?? '';
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

  it('renders the profile avatar via sat-avatar, aria-hidden (NXSAT-673)', () => {
    const fixture = TestBed.createComponent(AppShellComponent);
    TestBed.inject(SatPlatformNavState).toggleCollapsed();
    fixture.detectChanges();

    const avatar = profileProjectedAvatar(profileButton(fixture.nativeElement as HTMLElement));
    expect(avatar.tagName.toLowerCase()).toBe('sat-avatar');
    expect(avatar.getAttribute('aria-hidden'))
      .withContext('profile avatar must be aria-hidden')
      .toBe('true');
  });

  /** The shell with the rail in `state`, every running CSS transition jumped to its end. */
  function renderRail(state: 'collapsed' | 'expanded'): ComponentFixture<AppShellComponent> {
    const navState = TestBed.inject(SatPlatformNavState);
    const fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();
    if (navState.collapsed() !== (state === 'collapsed')) {
      navState.toggleCollapsed();
      fixture.detectChanges();
    }
    // The nav label fades in and out over 0.4s, and a half-faded label is painted.
    for (const animation of document.getAnimations()) {
      if (animation instanceof CSSTransition) animation.finish();
    }
    return fixture;
  }

  /*
   * WCAG 2.5.3 Label in Name, measured as it renders. phase-6-a11y found this control failing
   * axe's label-content-name-mismatch on every screen on 2026-11-23, while the test these replace
   * passed: it collected only text exposed to assistive technology, so it skipped the
   * `aria-hidden` avatar initials, the one text a sighted user sees on the collapsed rail. These
   * collect what is painted instead, and require the accessible name to contain it word for word,
   * in both rail states. The capture scans only the collapsed rail.
   */
  it('names the profile control with the initials it shows on the collapsed rail (WCAG 2.5.3)', () => {
    const button = profileButton(renderRail('collapsed').nativeElement as HTMLElement);
    const shown = paintedText(button);
    const initials = profileProjectedIconText(button);

    expect(initials).withContext('the profile avatar must draw initials').not.toBe('');
    // Proves the measurement: the label is transparent here, and aria-hidden hides nothing.
    expect(shown)
      .withContext('collapsed, the control must show the avatar initials and nothing else')
      .toBe(initials);
    const name = accessibleName(button);
    expect(containsWords(name, shown))
      .withContext(`accessible name "${name}" must contain the shown text "${shown}" as words`)
      .toBeTrue();
  });

  it('names the profile control with everything it shows on the expanded rail (WCAG 2.5.3)', () => {
    const button = profileButton(renderRail('expanded').nativeElement as HTMLElement);
    const shown = paintedText(button);

    expect(shown)
      .withContext('expanded, the control must show the avatar initials, then the display name')
      .toBe(`${profileProjectedIconText(button)} ${displayName}`);
    const name = accessibleName(button);
    expect(containsWords(name, shown))
      .withContext(`accessible name "${name}" must contain the shown text "${shown}" as words`)
      .toBeTrue();
  });

  it('keeps the upstream tooltip and menu-button semantics on the profile control', () => {
    const fixture = renderRail('collapsed');
    const host = fixture.debugElement.query(By.css('#sat-platform-nav-user-profile'));
    const tooltip = host.injector.get(MatTooltip);
    const button = host.nativeElement as HTMLButtonElement;

    expect(tooltip.message)
      .withContext('collapsed, the tooltip must give the display name alone')
      .toBe(displayName);
    expect(button.getAttribute('aria-haspopup')).toBe('menu');

    TestBed.inject(SatPlatformNavState).toggleCollapsed();
    fixture.detectChanges();
    expect(tooltip.message)
      .withContext('expanded, the label is on screen and the tooltip must be off')
      .toBe('');
  });

  /*
   * After a change, the upstream directive takes its label from the first changed node's text
   * alone, and from then on that is the tooltip and the `aria-label`. Were the hidden name source
   * first, it would put the initials into both.
   */
  it('keeps both the name and the tooltip right when the signed-in user changes', async () => {
    const fixture = renderRail('collapsed');
    const host = fixture.debugElement.query(By.css('#sat-platform-nav-user-profile'));
    const tooltip = host.injector.get(MatTooltip);
    const button = host.nativeElement as HTMLButtonElement;

    username.set('test.user');
    fixture.detectChanges();
    // The directive hears of the change from a MutationObserver, which reports asynchronously.
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();

    const shown = paintedText(button);
    expect(shown).withContext('the avatar must redraw for the new user').toBe('TE');
    const name = accessibleName(button);
    expect(containsWords(name, shown))
      .withContext(`accessible name "${name}" must contain the shown text "${shown}" as words`)
      .toBeTrue();
    expect(tooltip.message)
      .withContext('the tooltip must give the new display name alone')
      .toBe('test.user');
  });

  /*
   * Upper-casing can lengthen a string: the ligature "ﬁ" becomes "FI", so the first two
   * characters "ﬁl" become "FIL", of which the avatar draws "FI". Initials taken before
   * upper-casing would name the control "FIL", which does not contain the "FI" on screen.
   */
  it('names the control with what the avatar draws when upper-casing lengthens the name', () => {
    username.set('ﬁle.clerk');
    const button = profileButton(renderRail('collapsed').nativeElement as HTMLElement);
    const shown = paintedText(button);

    expect(shown).withContext('the avatar draws the first two upper-cased characters').toBe('FI');
    const name = accessibleName(button);
    expect(containsWords(name, shown))
      .withContext(`accessible name "${name}" must contain the shown text "${shown}" as words`)
      .toBeTrue();
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
