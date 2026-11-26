import {
  ChangeDetectionStrategy,
  Component,
  provideZonelessChangeDetection,
  signal,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import type { NxsFieldAppearance } from '../field-appearance';
import { NxsTextFieldComponent } from './text-field.component';

/** Hosted, so the two-way `value` and the commits are both observable. */
@Component({
  standalone: true,
  imports: [NxsTextFieldComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `<nxs-text-field
      [label]="label()"
      [(value)]="value"
      [placeholder]="placeholder()"
      [multiline]="multiline()"
      [rows]="rows()"
      [suggestions]="suggestions()"
      [autocomplete]="autocomplete()"
      [appearance]="appearance()"
      [disabled]="disabled()"
      (valueCommit)="commits.push($event)"
    />
    <nxs-text-field label="Second" [suggestions]="['b']" />`,
})
class HostComponent {
  readonly label = signal('Card ID');
  readonly value = signal('member');
  readonly placeholder = signal('');
  readonly multiline = signal(false);
  readonly rows = signal(2);
  readonly suggestions = signal<readonly string[]>([]);
  readonly autocomplete = signal('');
  readonly appearance = signal<NxsFieldAppearance>('outline');
  readonly disabled = signal(false);
  readonly commits: string[] = [];
}

describe('NxsTextFieldComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const root = (): HTMLElement => fixture.nativeElement as HTMLElement;

  async function render(): Promise<HTMLInputElement | HTMLTextAreaElement> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const control = root().querySelector<HTMLInputElement | HTMLTextAreaElement>(
      'nxs-text-field:first-of-type input, nxs-text-field:first-of-type textarea',
    );
    if (!control) throw new Error('no control rendered');
    return control;
  }

  function type(control: HTMLInputElement | HTMLTextAreaElement, text: string): void {
    control.value = text;
    control.dispatchEvent(new Event('input'));
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideZonelessChangeDetection(), provideNoopAnimations()],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  it('is a native input, named by its label through the form field’s <label for>', async () => {
    const control = await render();
    expect(control).toBeInstanceOf(HTMLInputElement);
    expect(
      [...((control as HTMLInputElement).labels ?? [])].map((label) => label.textContent?.trim()),
    ).toEqual(['Card ID']);
    expect(control.value).toBe('member');
    expect(control.tabIndex).toBe(0);
  });

  it('changes its value as each key is typed, and commits on change', async () => {
    const control = await render();
    type(control, 'claims');
    expect(host.value()).toBe('claims');
    expect(host.commits).toEqual([]);
    control.dispatchEvent(new Event('change'));
    expect(host.commits).toEqual(['claims']);
  });

  it('shows a value set from outside, and leaves typed text that the host does not change', async () => {
    let control = await render();
    host.value.set('claim');
    control = await render();
    expect(control.value).toBe('claim');
    type(control, 'claim-2');
    control = await render();
    expect(control.value).toBe('claim-2');
  });

  it('is a textarea of the rows asked for when multiline, and commits the same way', async () => {
    host.multiline.set(true);
    host.rows.set(3);
    const control = await render();
    expect(control).toBeInstanceOf(HTMLTextAreaElement);
    expect((control as HTMLTextAreaElement).rows).toBe(3);
    type(control, '{ "type": "app.rules.canWrite" }');
    control.dispatchEvent(new Event('change'));
    expect(host.commits).toEqual(['{ "type": "app.rules.canWrite" }']);
  });

  it('shows the placeholder in the control', async () => {
    host.placeholder.set('app.rules.canWrite');
    expect((await render()).placeholder).toBe('app.rules.canWrite');
  });

  it('suggests from a datalist only when given suggestions, each field from its own', async () => {
    let control = await render();
    expect(control.getAttribute('list')).toBeNull();
    expect(root().querySelector('nxs-text-field:first-of-type datalist')).toBeNull();

    host.suggestions.set(['up-for-renewal', 'terminated']);
    control = await render();
    const list = control.getAttribute('list');
    expect(list).toBeTruthy();
    const datalist = document.getElementById(list ?? '');
    expect([...(datalist?.querySelectorAll('option') ?? [])].map((each) => each.value)).toEqual([
      'up-for-renewal',
      'terminated',
    ]);
    const other = root().querySelector('nxs-text-field:last-of-type input')?.getAttribute('list');
    expect(other).toBeTruthy();
    expect(other).not.toBe(list);
  });

  it('sets the native autocomplete only when asked to', async () => {
    expect((await render()).hasAttribute('autocomplete')).toBe(false);
    host.autocomplete.set('off');
    expect((await render()).getAttribute('autocomplete')).toBe('off');
  });

  it('draws the form field in the appearance asked for', async () => {
    await render();
    const field = (): Element | null => root().querySelector('nxs-text-field mat-form-field');
    expect(field()?.classList).toContain('mat-form-field-appearance-outline');
    host.appearance.set('fill');
    await render();
    expect(field()?.classList).toContain('mat-form-field-appearance-fill');
  });

  it('is a disabled native control while disabled', async () => {
    host.disabled.set(true);
    expect((await render()).disabled).toBe(true);
  });
});
