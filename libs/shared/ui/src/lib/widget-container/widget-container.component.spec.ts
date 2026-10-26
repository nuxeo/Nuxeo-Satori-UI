import {
  Component,
  provideZonelessChangeDetection,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { WidgetContainerComponent } from './widget-container.component';

/**
 * Hosted rather than created directly, because half of this component's contract is the two
 * `<ng-content>` slots: a bare `TestBed.createComponent(WidgetContainerComponent)` projects
 * nothing, so "the body renders its children" cannot be asserted at all.
 */
@Component({
  standalone: true,
  imports: [WidgetContainerComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <lib-widget-container [title]="title()" [icon]="icon()" [iconColor]="iconColor()">
      <button widgetActions type="button" class="probe-action">Refresh</button>
      <p class="probe-body">Projected body</p>
    </lib-widget-container>
  `,
})
class HostComponent {
  // Signals, not plain fields. Under `provideZonelessChangeDetection` a plain field mutation does
  // not mark the host view dirty, so `detectChanges()` skips the refresh pass and only the
  // `checkNoChanges` pass sees the new value — which surfaces as NG0100 rather than as the
  // re-render the test is trying to observe.
  readonly title = signal('Recently Viewed');
  readonly icon = signal<string | undefined>(undefined);
  readonly iconColor = signal('');
}

describe('WidgetContainerComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  function query<T extends HTMLElement>(selector: string): T | null {
    return fixture.nativeElement.querySelector(selector) as T | null;
  }

  it('renders the title as a level-2 heading by default', () => {
    const heading = query('.widget-header-title');
    expect(heading?.textContent?.trim()).toBe('Recently Viewed');
    // Default level 2: the shell page title is a native `<h1>` (NXENG-788), so dashboard widgets
    // must be the next level — IBM heading-order / NXENG-941.
    expect(heading?.getAttribute('role')).toBe('heading');
    expect(heading?.getAttribute('aria-level')).toBe('2');
  });

  it('honours headingLevel when widgets sit under a section heading', async () => {
    @Component({
      changeDetection: ChangeDetectionStrategy.Eager,
      standalone: true,
      imports: [WidgetContainerComponent],
      template: `<lib-widget-container [title]="'Nested'" [headingLevel]="3" />`,
    })
    class NestedHostComponent {}

    const nestedFixture = TestBed.createComponent(NestedHostComponent);
    nestedFixture.detectChanges();
    await nestedFixture.whenStable();

    const heading = nestedFixture.nativeElement.querySelector('.widget-header-title');
    expect(heading?.getAttribute('aria-level')).toBe('3');
  });

  /**
   * WCAG 2.1.1, axe rule `scrollable-region-focusable`.
   *
   * `.widget-body` sets `overflow-y: auto`, so a mouse user can scroll content that a keyboard
   * user could otherwise never reach. `tabindex="0"` makes it a tab stop; `role="group"` plus the
   * widget's own title as `aria-label` is what makes that tab stop announce which widget it
   * belongs to instead of being an anonymous focusable div.
   *
   * All three are asserted together and against the *live* title, because dropping any one of
   * them individually still leaves a plausible-looking element behind.
   */
  it('exposes the scrollable body as a labelled, focusable group', () => {
    const body = query('.widget-body');
    expect(body).not.toBeNull();
    expect(body?.getAttribute('tabindex')).toBe('0');
    expect(body?.getAttribute('role')).toBe('group');
    expect(body?.getAttribute('aria-label')).toBe('Recently Viewed');
  });

  it('keeps the body’s accessible name in step with the title', async () => {
    host.title.set('Latest Activity');
    await fixture.whenStable();

    // Bound with `[attr.aria-label]="title()"`, not copied once at init. A stale name here would
    // announce the wrong widget after any dashboard re-label.
    expect(query('.widget-body')?.getAttribute('aria-label')).toBe('Latest Activity');
    expect(query('.widget-header-title')?.textContent?.trim()).toBe('Latest Activity');
  });

  it('projects children into the body and header-action slots', () => {
    const body = query('.widget-body');
    expect(body?.querySelector('.probe-body')?.textContent?.trim()).toBe('Projected body');
    // Selector-matched projection: the action belongs to the header, not the scrollable body.
    expect(query('.widget-header')?.querySelector('.probe-action')).not.toBeNull();
    expect(body?.querySelector('.probe-action')).toBeNull();
  });

  it('omits the icon element entirely when no icon was given', () => {
    expect(host.icon()).toBeUndefined();
    expect(query('.widget-header-icon')).toBeNull();
  });

  it('renders the icon and applies the icon colour when both are given', async () => {
    host.icon.set('clock');
    host.iconColor.set('rgb(255, 0, 0)');
    await fixture.whenStable();

    const icon = query('.widget-header-icon');
    expect(icon?.getAttribute('data-mat-icon-name')).toBe('clock');
    expect(icon?.style.color).toBe('rgb(255, 0, 0)');
  });

  it('renders the icon with no colour override when iconColor is left at its default', async () => {
    host.icon.set('clock');
    await fixture.whenStable();

    // `iconColor` defaults to '' so the Material theme colour wins; a hardcoded default here
    // would break theming for every widget that only supplies an icon.
    expect(query('.widget-header-icon')?.style.color).toBe('');
  });
});
