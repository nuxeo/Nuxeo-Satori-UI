import {
  Component,
  provideZonelessChangeDetection,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatSelect } from '@angular/material/select';

import { NxsPagerComponent } from './pager.component';

@Component({
  standalone: true,
  imports: [NxsPagerComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <nxs-pager
      [pageIndex]="pageIndex()"
      [pageSize]="pageSize()"
      [itemCount]="itemCount()"
      [totalSize]="totalSize()"
      [hasNextPage]="hasNextPage()"
      [disabled]="disabled()"
      [label]="label()"
      [pageSizeOptions]="sizes()"
      [showEdges]="edges()"
      (pageSizeChange)="sizeChanges.push($event)"
      (pageChange)="asked.push($event)"
    />
  `,
})
class HostComponent {
  readonly pageIndex = signal(0);
  readonly pageSize = signal(50);
  readonly itemCount = signal(50);
  readonly totalSize = signal(-2);
  readonly hasNextPage = signal(true);
  readonly disabled = signal(false);
  readonly label = signal('');
  readonly asked: number[] = [];
  readonly sizes = signal<number[]>([]);
  readonly edges = signal(false);
  readonly sizeChanges: number[] = [];
}

describe('NxsPagerComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const range = (): string => el().querySelector('.nxs-pager__range')?.textContent?.trim() ?? '';
  const previous = (): HTMLButtonElement | null => el().querySelector('.nxs-pager__previous');
  const next = (): HTMLButtonElement | null => el().querySelector('.nxs-pager__next');

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await render();
  });

  it('renders nothing while everything fits on one page', async () => {
    host.hasNextPage.set(false);
    await render();
    expect(el().querySelector('nav')).toBeNull();
  });

  it('offers page sizes on a single page and emits the selected size', async () => {
    host.hasNextPage.set(false);
    host.sizes.set([25, 50, 100]);
    await render();
    const select: MatSelect = fixture.debugElement.query(By.directive(MatSelect)).componentInstance;
    select.open();
    await render();
    const option = [...document.querySelectorAll<HTMLElement>('mat-option')].find(
      (node) => node.textContent?.trim() === '25',
    );
    expect(option).toBeDefined();
    option?.click();
    await render();
    expect(host.sizeChanges).toEqual([25]);
  });

  it('navigates to first and last pages and disables edges while loading', async () => {
    host.edges.set(true);
    host.totalSize.set(121);
    host.pageIndex.set(1);
    await render();
    const first = el().querySelector<HTMLButtonElement>('[aria-label="First page"]');
    const last = el().querySelector<HTMLButtonElement>('[aria-label="Last page"]');
    first?.click();
    last?.click();
    expect(host.asked).toEqual([0, 2]);
    host.disabled.set(true);
    await render();
    expect(first?.disabled).toBe(true);
    expect(last?.disabled).toBe(true);
  });

  it('shows the range without a total when the server did not count', () => {
    expect(range()).toBe('1–50');
    expect(el().querySelector('nav')?.getAttribute('aria-label')).toBe('Pages');
  });

  it('shows "of N" only for a real total', async () => {
    host.pageIndex.set(1);
    host.itemCount.set(10);
    host.totalSize.set(60);
    host.hasNextPage.set(false);
    await render();
    expect(range()).toBe('51–60 of 60');
  });

  it('enables Previous from the page index and Next from hasNextPage, independently', async () => {
    expect(previous()?.disabled).toBe(true);
    expect(next()?.disabled).toBe(false);

    host.pageIndex.set(2);
    host.hasNextPage.set(false);
    await render();
    expect(previous()?.disabled).toBe(false);
    expect(next()?.disabled).toBe(true);
  });

  it('asks for the neighbouring page', async () => {
    host.pageIndex.set(1);
    await render();
    next()?.click();
    previous()?.click();
    expect(host.asked).toEqual([2, 0]);
  });

  it('asks for nothing while disabled', async () => {
    host.pageIndex.set(1);
    host.disabled.set(true);
    await render();
    expect(previous()?.disabled).toBe(true);
    expect(next()?.disabled).toBe(true);
    (fixture.debugElement.children[0].componentInstance as NxsPagerComponent).next();
    expect(host.asked).toEqual([]);
  });

  it('names both buttons, which show only an icon', () => {
    expect(previous()?.getAttribute('aria-label')).toBe('Previous page');
    expect(next()?.getAttribute('aria-label')).toBe('Next page');
  });

  it('takes the landmark name it is given, and ignores one that shows nothing', async () => {
    host.label.set('Pages of Invoices');
    await render();
    expect(el().querySelector('nav')?.getAttribute('aria-label')).toBe('Pages of Invoices');

    for (const blank of ['   ', '\u200b', ' \u2060 ']) {
      host.label.set(blank);
      await render();
      expect(el().querySelector('nav')?.getAttribute('aria-label')).toBe('Pages');
    }
  });

  it('announces the range politely when it changes', () => {
    const status = el().querySelector('.nxs-pager__range');
    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(status?.getAttribute('aria-atomic')).toBe('true');
  });

  it('says there is nothing more on an empty page past the end, and still offers Previous', async () => {
    host.pageIndex.set(1);
    host.itemCount.set(0);
    host.hasNextPage.set(false);
    await render();
    expect(range()).toBe('No more items');
    expect(previous()?.disabled).toBe(false);
  });
});
