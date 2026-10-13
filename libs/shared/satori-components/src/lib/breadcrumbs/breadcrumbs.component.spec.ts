import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import type { NxsBreadcrumbItem } from '../primitives';
import { breadcrumbsToFold } from './breadcrumb-fit';
import { NxsBreadcrumbsComponent } from './breadcrumbs.component';

const TRAIL: readonly NxsBreadcrumbItem[] = [
  { label: 'Domain', routerLink: ['/browse'], queryParams: { path: '/default-domain' } },
  { label: 'Help', href: 'https://doc.nuxeo.com/' },
  { label: 'Contracts' },
];

describe('NxsBreadcrumbsComponent', () => {
  let fixture: ComponentFixture<NxsBreadcrumbsComponent>;

  async function render(inputs: Record<string, unknown>): Promise<HTMLElement> {
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NxsBreadcrumbsComponent],
      providers: [provideZonelessChangeDetection(), provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(NxsBreadcrumbsComponent);
  });

  it('renders one list item per breadcrumb, in order', async () => {
    const host = await render({ items: TRAIL });
    const labels = [...host.querySelectorAll('nav li')].map((li) =>
      li.querySelector('a, span')?.textContent?.trim(),
    );
    expect(labels).toEqual(['Domain', 'Help', 'Contracts']);
  });

  it('routes a routerLink item, query parameters included', async () => {
    const host = await render({ items: TRAIL });
    const link = host.querySelectorAll('a')[0];
    expect(link.getAttribute('href')).toBe('/browse?path=%2Fdefault-domain');
  });

  it('links an href item as a plain link', async () => {
    const host = await render({ items: TRAIL });
    expect(host.querySelectorAll('a')[1].getAttribute('href')).toBe('https://doc.nuxeo.com/');
  });

  it('marks a last item with no link as the current page', async () => {
    const host = await render({ items: TRAIL });
    const current = host.querySelector('nav li:last-child span');
    expect(current?.getAttribute('aria-current')).toBe('page');
    expect(host.querySelectorAll('[aria-current]').length).toBe(1);
  });

  it('does not mark a text item that is not last as current', async () => {
    const host = await render({ items: [{ label: 'Unlinked' }, { label: 'Leaf' }] });
    expect(host.querySelector('nav li:first-child span')?.hasAttribute('aria-current')).toBe(false);
  });

  it('puts a decorative separator between items and none after the last', async () => {
    const host = await render({ items: TRAIL });
    const separators = host.querySelectorAll('nav .nxs-breadcrumbs__separator');
    expect(separators.length).toBe(TRAIL.length - 1);
    expect(separators[0].getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelector('nav li:last-child .nxs-breadcrumbs__separator')).toBeNull();
  });

  it('names the navigation landmark from its label', async () => {
    const host = await render({ items: TRAIL, label: 'Breadcrumbs' });
    expect(host.querySelector('nav')?.getAttribute('aria-label')).toBe('Breadcrumbs');
  });

  it('leaves the landmark unnamed rather than empty-named when the label is blank', async () => {
    const host = await render({ items: TRAIL });
    expect(host.querySelector('nav')?.hasAttribute('aria-label')).toBe(false);
  });

  it('renders an empty list for an empty trail', async () => {
    const host = await render({ items: [] });
    expect(host.querySelector('nav ol')?.children.length).toBe(0);
  });

  it('neutralises a javascript: href rather than linking it', async () => {
    const host = await render({ items: [{ label: 'Bad', href: 'javascript:alert(1)' }] });
    expect(host.querySelector('a')?.getAttribute('href')).toMatch(/^unsafe:/);
  });
});

describe('breadcrumbsToFold', () => {
  // Five items of 100 px, a "…" of 30 px.
  const FIVE = [100, 100, 100, 100, 100];

  it.each([
    ['everything fits', FIVE, 500, 0],
    ['one pixel short folds the second', FIVE, 499, 1],
    ['the "…" costs room of its own', FIVE, 430, 1],
    ['one more pixel short folds the third too', FIVE, 429, 2],
    ['folds up to, never past, the last but one', FIVE, 230, 3],
    ['first, "…" and last do not fit: still keeps both', FIVE, 50, 3],
  ])('%s', (_name, widths, available, folded) => {
    expect(breadcrumbsToFold(widths, 30, available)).toBe(folded);
  });

  it('never folds a trail of two items or fewer', () => {
    expect(breadcrumbsToFold([400, 400], 30, 100)).toBe(0);
    expect(breadcrumbsToFold([400], 30, 100)).toBe(0);
    expect(breadcrumbsToFold([], 30, 100)).toBe(0);
  });

  it('folds nothing while the box has no width yet, rather than everything', () => {
    expect(breadcrumbsToFold(FIVE, 30, 0)).toBe(0);
    expect(breadcrumbsToFold(FIVE, 30, Number.NaN)).toBe(0);
  });

  it('folds the narrow items it needs, not a fixed count', () => {
    // The second is wide: folding it alone is enough.
    expect(breadcrumbsToFold([100, 300, 50, 50, 100], 30, 340)).toBe(1);
  });
});

describe('NxsBreadcrumbsComponent folding', () => {
  let fixture: ComponentFixture<NxsBreadcrumbsComponent>;
  let resize: (() => void) | null;
  const OriginalResizeObserver = globalThis.ResizeObserver;

  const DEEP: readonly NxsBreadcrumbItem[] = [
    { label: 'Root', routerLink: '/browse' },
    { label: 'Domain', routerLink: '/browse/default-domain' },
    { label: 'Workspaces', routerLink: '/browse/default-domain/workspaces' },
    { label: 'Claims', routerLink: '/browse/default-domain/workspaces/claims' },
    { label: 'Claim 42 with a rather long name' },
  ];

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const shown = (): string[] =>
    [...el().querySelectorAll('nav li')].map((li) =>
      li.querySelector('button') ? '…' : (li.querySelector('a, span')?.textContent?.trim() ?? ''),
    );

  /** Lays the measuring copy out at 100 px an item and the "…" at 30, in a box `width` wide. */
  function layout(width: number): void {
    Object.defineProperty(el(), 'clientWidth', { configurable: true, value: width });
    for (const li of el().querySelectorAll<HTMLElement>('.nxs-breadcrumbs__measure > li')) {
      const size = li.classList.contains('nxs-breadcrumbs__overflow-item') ? 30 : 100;
      li.getBoundingClientRect = () => ({ width: size }) as DOMRect;
    }
  }

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    resize = null;
    globalThis.ResizeObserver = class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe(): void {
        /* the test calls `resize` itself */
      }
      unobserve(): void {
        /* nothing to stop */
      }
      disconnect(): void {
        resize = null;
      }
    } as unknown as typeof ResizeObserver;
    await TestBed.configureTestingModule({
      imports: [NxsBreadcrumbsComponent],
      providers: [provideZonelessChangeDetection(), provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(NxsBreadcrumbsComponent);
    fixture.componentRef.setInput('items', DEEP);
    fixture.componentRef.setInput('label', 'Breadcrumbs');
    await render();
  });

  afterEach(() => {
    globalThis.ResizeObserver = OriginalResizeObserver;
  });

  it('shows the whole trail while it fits', async () => {
    layout(500);
    resize?.();
    await render();
    expect(shown()).toEqual([
      'Root',
      'Domain',
      'Workspaces',
      'Claims',
      'Claim 42 with a rather long name',
    ]);
    expect(el().querySelector('.nxs-breadcrumbs__overflow')).toBeNull();
  });

  it('folds the items after the first into "…" when space runs out, keeping first and last', async () => {
    layout(330);
    resize?.();
    await render();
    expect(shown()).toEqual(['Root', '…', 'Claims', 'Claim 42 with a rather long name']);
    const more = el().querySelector('.nxs-breadcrumbs__overflow') as HTMLButtonElement;
    expect(more.getAttribute('aria-label')).toBe('Show more breadcrumbs');
    expect(el().querySelector('[aria-current="page"]')?.textContent?.trim()).toBe(
      'Claim 42 with a rather long name',
    );

    more.click();
    await render();
    const menu = [...document.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]')];
    expect(menu.map((item) => item.textContent?.trim())).toEqual(['Domain', 'Workspaces']);
    expect(menu.map((item) => item.getAttribute('href'))).toEqual([
      '/browse/default-domain',
      '/browse/default-domain/workspaces',
    ]);
  });

  it('keeps the current page on screen however narrow the box', async () => {
    layout(60);
    resize?.();
    await render();
    expect(shown()).toEqual(['Root', '…', 'Claim 42 with a rather long name']);
    // The first and the last can be cut short by the stylesheet, so both stay readable in full on
    // hover; the ones in between are either whole or in the menu, and carry no title.
    const visible = [...el().querySelectorAll('nav .nxs-breadcrumbs__item')];
    expect(visible.map((item) => item.querySelector('a, span')?.getAttribute('title'))).toEqual([
      'Root',
      null,
      'Claim 42 with a rather long name',
    ]);
  });

  it('unfolds again when the box grows back', async () => {
    layout(330);
    resize?.();
    await render();
    layout(600);
    resize?.();
    await render();
    expect(el().querySelector('.nxs-breadcrumbs__overflow')).toBeNull();
    expect(shown()).toHaveLength(5);
  });

  it('measures a copy that assistive technology and the Tab key never reach', () => {
    const measure = el().querySelector('.nxs-breadcrumbs__measure');
    expect(measure?.getAttribute('aria-hidden')).toBe('true');
    expect(measure?.querySelector('a, button, [tabindex]')).toBeNull();
  });

  it('stops observing when destroyed', () => {
    expect(resize).not.toBeNull();
    fixture.destroy();
    expect(resize).toBeNull();
  });
});
