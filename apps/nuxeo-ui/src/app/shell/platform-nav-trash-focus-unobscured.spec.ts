import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { SatPlatformNavModule } from '@hylandsoftware/satori-ui/platform-nav';

const TRASH_NAV_ID = 'app.navbar.trash';
const TRASH_LINK_SELECTOR = `sat-platform-nav-list-item[data-nav-id="${TRASH_NAV_ID}"] .sat-platform-nav-item`;
const NAV_LIST_SELECTOR = 'sat-platform-nav nav.sat-platform-nav-list';

/**
 * NXENG-868 — keyboard-focused Trash (and other bottom sidebar links) must stay visible
 * (IBM element_tabbable_unobscured / WCAG 2.4.11).
 *
 * Satori's component stylesheet sets `overflow-y: hidden` on `.sat-platform-nav-list` and
 * loads after `styles.scss`, which used to lose the cascade and clip focused items.
 */
@Component({
  standalone: true,
  imports: [SatPlatformNavModule, TranslateModule],
  templateUrl: './platform-nav-trash-focus-unobscured.host.html',
})
class NavTrashHostComponent {}

describe('platform nav Trash focus unobscured (NXENG-868)', () => {
  let fixture: ComponentFixture<NavTrashHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NavTrashHostComponent, TranslateModule.forRoot()],
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
