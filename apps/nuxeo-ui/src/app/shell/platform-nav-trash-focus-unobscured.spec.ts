import { Component, ChangeDetectionStrategy } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
// testTranslateModule() removed - no longer exported in ngx-translate 18
import { SatPlatformNavModule } from '@hylandsoftware/satori-ui/platform-nav';

import { testTranslateModule } from '../i18n/translate-testing';
const TRASH_NAV_ID = 'app.navbar.trash';
const TRASH_LINK_SELECTOR = `a[sat-platform-nav-menu-item][data-nav-id="${TRASH_NAV_ID}"]`;
const NAV_LIST_SELECTOR = 'sat-platform-nav nav.sat-platform-nav-list';

/** Whether this browser draws scrollbars that take layout width, measured on a probe element. */
function platformHasClassicScrollbars(): boolean {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;top:-9999px;width:100px;height:100px;overflow:scroll';
  document.body.appendChild(probe);
  const classic = probe.offsetWidth > probe.clientWidth;
  probe.remove();
  return classic;
}

/**
 * NXENG-868 — keyboard-focused Trash (and other bottom sidebar links) must stay visible
 * (IBM element_tabbable_unobscured / WCAG 2.4.11).
 *
 * Satori's component stylesheet sets `overflow-y: hidden` on `.sat-platform-nav-list` and
 * loads after `styles.scss`, which used to lose the cascade and clip focused items.
 */
@Component({
  standalone: true,
  imports: [SatPlatformNavModule, testTranslateModule()],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './platform-nav-trash-focus-unobscured.host.html',
})
class NavTrashHostComponent {}

describe('platform nav Trash focus unobscured (NXENG-868)', () => {
  let fixture: ComponentFixture<NavTrashHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NavTrashHostComponent, testTranslateModule()],
      providers: [provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(NavTrashHostComponent);
    fixture.detectChanges();
    document.body.appendChild(fixture.nativeElement);
  });

  afterEach(() => {
    fixture.nativeElement.remove();
    fixture.destroy();
  });

  it('keeps the nav list vertically scrollable after Satori styles load', () => {
    const list = fixture.nativeElement.querySelector(NAV_LIST_SELECTOR) as HTMLElement;
    expect(list).withContext('nav list element').toBeTruthy();
    expect(getComputedStyle(list).overflowY).toBe('auto');
    expect(getComputedStyle(list).minHeight).toBe('0px');
  });

  it('fits every fixture destination below the logo at a 900px desktop height (NXSAT-213)', () => {
    const panel = fixture.nativeElement.querySelector('.sat-platform-nav-panel') as HTMLElement;
    const list = fixture.nativeElement.querySelector(NAV_LIST_SELECTOR) as HTMLElement;
    panel.style.height = '900px';
    expect(getComputedStyle(list).paddingTop).toBe('0px');
    expect(list.scrollHeight).toBeLessThanOrEqual(list.clientHeight);
    const links = list.querySelectorAll('.sat-platform-nav-item');
    expect(links.length).toBe(15);
    for (const link of Array.from(links)) {
      expect(link.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        list.getBoundingClientRect().bottom,
      );
    }
  });

  it('exposes a scrollbar when the rail overflows on shorter screens (NXSAT-213)', () => {
    const panel = fixture.nativeElement.querySelector('.sat-platform-nav-panel') as HTMLElement;
    const list = fixture.nativeElement.querySelector(NAV_LIST_SELECTOR) as HTMLElement;
    panel.style.height = '480px';
    expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
    expect(getComputedStyle(list).scrollbarWidth).toBe('thin');
    // The rendered gutter, not the pseudo-element's style: Chromium ignores
    // `::-webkit-scrollbar` once `scrollbar-width` is set, so that could not fail. Only a
    // classic scrollbar takes layout width — an overlay one (macOS "automatic") takes none —
    // so the gutter is asserted where the platform draws classic scrollbars, as CI's does.
    if (platformHasClassicScrollbars()) {
      expect(list.offsetWidth - list.clientWidth).toBeGreaterThan(0);
    }
  });

  it('scrolls Trash fully into view when it receives keyboard focus', () => {
    const list = fixture.nativeElement.querySelector(NAV_LIST_SELECTOR) as HTMLElement;
    const link = fixture.nativeElement.querySelector(TRASH_LINK_SELECTOR) as HTMLElement;
    expect(link).withContext('Trash nav link').toBeTruthy();

    const panel = fixture.nativeElement.querySelector('.sat-platform-nav-panel') as HTMLElement;
    panel.style.height = '480px';
    expect(list.scrollHeight)
      .withContext('nav list must overflow the constrained panel')
      .toBeGreaterThan(list.clientHeight);

    list.scrollTop = 0;
    const initialListRect = list.getBoundingClientRect();
    const initialLinkRect = link.getBoundingClientRect();
    expect(initialLinkRect.bottom)
      .withContext('Trash should start below the visible nav list so focus has to scroll it in')
      .toBeGreaterThan(initialListRect.bottom + 1);

    link.focus();
    fixture.detectChanges();

    const listRect = list.getBoundingClientRect();
    const linkRect = link.getBoundingClientRect();
    expect(list.scrollTop).withContext('keyboard focus should scroll the list').toBeGreaterThan(0);
    expect(linkRect.top).toBeGreaterThanOrEqual(listRect.top - 1);
    expect(linkRect.bottom).toBeLessThanOrEqual(listRect.bottom + 1);

    const centerX = linkRect.left + linkRect.width / 2;
    const centerY = linkRect.top + linkRect.height / 2;
    const top = document.elementFromPoint(centerX, centerY);
    expect(top === link || link.contains(top))
      .withContext('Trash focus point is not obscured')
      .toBe(true);
  });
});
