import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import type { NxsBreadcrumbItem } from '../primitives';
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
    const labels = [...host.querySelectorAll('li')].map((li) =>
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
    const current = host.querySelector('li:last-child span');
    expect(current?.getAttribute('aria-current')).toBe('page');
    expect(host.querySelectorAll('[aria-current]').length).toBe(1);
  });

  it('does not mark a text item that is not last as current', async () => {
    const host = await render({ items: [{ label: 'Unlinked' }, { label: 'Leaf' }] });
    expect(host.querySelector('li:first-child span')?.hasAttribute('aria-current')).toBe(false);
  });

  it('puts a decorative separator between items and none after the last', async () => {
    const host = await render({ items: TRAIL });
    const separators = host.querySelectorAll('.nxs-breadcrumbs__separator');
    expect(separators.length).toBe(TRAIL.length - 1);
    expect(separators[0].getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelector('li:last-child .nxs-breadcrumbs__separator')).toBeNull();
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
    expect(host.querySelector('ol')?.children.length).toBe(0);
  });

  it('neutralises a javascript: href rather than linking it', async () => {
    const host = await render({ items: [{ label: 'Bad', href: 'javascript:alert(1)' }] });
    expect(host.querySelector('a')?.getAttribute('href')).toMatch(/^unsafe:/);
  });
});
