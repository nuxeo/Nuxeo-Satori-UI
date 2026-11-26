import {
  ChangeDetectionStrategy,
  Component,
  provideZonelessChangeDetection,
  signal,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import type { NxsFieldAppearance } from '../field-appearance';
import { NxsSelectComponent, type NxsSelectGroup, type NxsSelectOption } from './select.component';

const ORDERS: readonly NxsSelectOption[] = [
  { value: 'asc', label: 'Ascending' },
  { value: 'desc', label: 'Descending' },
];

const FILES: readonly NxsSelectGroup[] = [
  {
    label: 'Member',
    options: [
      { value: 'Member/view', label: 'Member: record page' },
      { value: 'Member/edit', label: 'Member: edit form' },
    ],
  },
  { label: 'Claim', options: [{ value: 'Claim/view', label: 'Claim: record page' }] },
];

/** Hosted, so the two-way `value` is observable. */
@Component({
  standalone: true,
  imports: [NxsSelectComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `<nxs-select
    [label]="label()"
    [(value)]="value"
    [options]="options()"
    [placeholder]="placeholder()"
    [appearance]="appearance()"
    [disabled]="disabled()"
  />`,
})
class HostComponent {
  readonly label = signal('Order');
  readonly value = signal('desc');
  readonly options = signal<readonly (NxsSelectOption | NxsSelectGroup)[]>(ORDERS);
  readonly placeholder = signal('');
  readonly appearance = signal<NxsFieldAppearance>('outline');
  readonly disabled = signal(false);
}

describe('NxsSelectComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;

  async function render(): Promise<HTMLSelectElement> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const select = root().querySelector('select');
    if (!select) throw new Error('no select rendered');
    return select;
  }

  const offered = (select: HTMLSelectElement): string[][] =>
    [...select.options].map((option) => [option.value, option.textContent?.trim() ?? '']);

  function choose(select: HTMLSelectElement, value: string): void {
    select.value = value;
    select.dispatchEvent(new Event('change'));
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideZonelessChangeDetection(), provideNoopAnimations()],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  it('is a native select, named by its label, with the value chosen', async () => {
    const select = await render();
    expect([...select.labels].map((label) => label.textContent?.trim())).toEqual(['Order']);
    expect(offered(select)).toEqual([
      ['asc', 'Ascending'],
      ['desc', 'Descending'],
    ]);
    expect(select.value).toBe('desc');
    expect(select.tabIndex).toBe(0);
  });

  it('changes its value when the user chooses', async () => {
    choose(await render(), 'asc');
    expect(host.value()).toBe('asc');
  });

  it('shows a value set from outside', async () => {
    await render();
    host.value.set('asc');
    expect((await render()).value).toBe('asc');
  });

  it('offers the placeholder first, with the value "", chosen while nothing else is', async () => {
    host.placeholder.set('Choose an order');
    host.value.set('');
    const select = await render();
    expect(offered(select)[0]).toEqual(['', 'Choose an order']);
    expect(select.value).toBe('');
    expect(select.selectedIndex).toBe(0);
  });

  it('groups choices under their headings as native optgroups', async () => {
    host.options.set(FILES);
    host.value.set('Member/edit');
    const select = await render();
    expect([...select.querySelectorAll('optgroup')].map((group) => group.label)).toEqual([
      'Member',
      'Claim',
    ]);
    expect(offered(select).map(([value]) => value)).toEqual([
      'Member/view',
      'Member/edit',
      'Claim/view',
    ]);
    expect(select.value).toBe('Member/edit');
  });

  it('keeps the choice when the options are drawn after the value is set', async () => {
    host.options.set([]);
    host.value.set('Claim/view');
    await render();
    host.options.set(FILES);
    expect((await render()).value).toBe('Claim/view');
  });

  it('draws the form field in the appearance asked for', async () => {
    await render();
    const field = (): Element | null => root().querySelector('nxs-select mat-form-field');
    expect(field()?.classList).toContain('mat-form-field-appearance-outline');
    host.appearance.set('fill');
    await render();
    expect(field()?.classList).toContain('mat-form-field-appearance-fill');
  });

  it('is a disabled native select while disabled', async () => {
    host.disabled.set(true);
    expect((await render()).disabled).toBe(true);
  });
});
