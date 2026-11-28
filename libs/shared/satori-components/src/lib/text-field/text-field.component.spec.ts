import {
  ChangeDetectionStrategy,
  Component,
  provideZonelessChangeDetection,
  signal,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import type { NxsFieldAppearance } from '../field-appearance';
import {
  NxsTextFieldComponent,
  type NxsTextFieldHintAlign,
  type NxsTextFieldType,
} from './text-field.component';

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
      [type]="type()"
      [min]="min()"
      [max]="max()"
      [step]="step()"
      [maxLength]="maxLength()"
      [required]="required()"
      [hint]="hint()"
      [hintAlign]="hintAlign()"
      [controlId]="controlId()"
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
  readonly type = signal<NxsTextFieldType>('text');
  readonly min = signal<number | null>(null);
  readonly max = signal<number | null>(null);
  readonly step = signal<number | null>(null);
  readonly maxLength = signal<number | null>(null);
  readonly required = signal(false);
  readonly hint = signal('');
  readonly hintAlign = signal<NxsTextFieldHintAlign>('start');
  readonly controlId = signal('');
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

  it('shows a value written into it again, even one it showed before the page redraws', async () => {
    const control = await render();
    const field = fixture.debugElement.query(By.directive(NxsTextFieldComponent))
      .componentInstance as NxsTextFieldComponent;
    expect(control.value).toBe('member');
    // A key empties the field and, in the same turn, the host writes back the value it showed:
    // its binding has not changed, so only the field itself can put it back.
    type(control, '');
    field.value.set('member');
    await render();
    expect(control.value).toBe('member');
    // What is typed is left as typed.
    type(control, 'members');
    await render();
    expect(control.value).toBe('members');
    expect(host.value()).toBe('members');
  });

  describe('a number field', () => {
    it('is the platform’s number input, held by min, max and step', async () => {
      host.type.set('number');
      host.min.set(0);
      host.max.set(100);
      host.step.set(1);
      host.value.set('50');
      const control = (await render()) as HTMLInputElement;
      expect(control.type).toBe('number');
      expect(control.min).toBe('0');
      expect(control.max).toBe('100');
      expect(control.step).toBe('1');
      expect(control.value).toBe('50');
      type(control, '75');
      expect(host.value()).toBe('75');
    });

    it('takes its bounds as static attributes, and writes none for one that is not a number', async () => {
      @Component({
        standalone: true,
        imports: [NxsTextFieldComponent],
        changeDetection: ChangeDetectionStrategy.Eager,
        template: `<nxs-text-field
          label="Across"
          type="number"
          min="0"
          max="abc"
          step="5"
          maxLength="3"
        />`,
      })
      class StaticHost {}
      const made = TestBed.createComponent(StaticHost);
      made.detectChanges();
      await made.whenStable();
      const control = (made.nativeElement as HTMLElement).querySelector(
        'input',
      ) as HTMLInputElement;
      expect(control.getAttribute('min')).toBe('0');
      expect(control.hasAttribute('max')).toBe(false);
      expect(control.getAttribute('step')).toBe('5');
      expect(control.getAttribute('maxlength')).toBe('3');
    });

    it('sets no bound on a text field, nor on a number field given none', async () => {
      host.min.set(0);
      host.max.set(100);
      let control = (await render()) as HTMLInputElement;
      expect(control.type).toBe('text');
      expect(control.hasAttribute('min')).toBe(false);
      expect(control.hasAttribute('max')).toBe(false);
      host.type.set('number');
      host.min.set(null);
      host.max.set(null);
      control = (await render()) as HTMLInputElement;
      expect(control.hasAttribute('min')).toBe(false);
      expect(control.hasAttribute('max')).toBe(false);
      expect(control.hasAttribute('step')).toBe(false);
    });
  });

  it('caps the characters of either kind of field at maxLength, and none by default', async () => {
    let control = await render();
    expect(control.hasAttribute('maxlength')).toBe(false);
    host.maxLength.set(2000);
    control = await render();
    expect(control.getAttribute('maxlength')).toBe('2000');
    host.multiline.set(true);
    control = await render();
    expect(control).toBeInstanceOf(HTMLTextAreaElement);
    expect(control.getAttribute('maxlength')).toBe('2000');
  });

  it('marks a required field required, and says so in its label', async () => {
    let control = await render();
    expect(control.required).toBe(false);
    host.required.set(true);
    host.multiline.set(true);
    control = await render();
    expect(control.required).toBe(true);
    expect(root().querySelector('.mat-mdc-form-field-required-marker')).not.toBeNull();
  });

  it('describes the control with its hint, at the start or the end, and has none when blank', async () => {
    let control = await render();
    expect(root().querySelector('nxs-text-field:first-of-type mat-hint')).toBeNull();
    host.hint.set('12 / 2000');
    host.hintAlign.set('end');
    control = await render();
    const hint = root().querySelector('nxs-text-field:first-of-type mat-hint');
    expect(hint?.textContent?.trim()).toBe('12 / 2000');
    expect(hint?.classList).toContain('mat-mdc-form-field-hint-end');
    expect(control.getAttribute('aria-describedby')?.split(' ')).toContain(hint?.id);
  });

  it('gives the control the id controlId names, and Material’s own when blank', async () => {
    let control = await render();
    expect(control.id).toMatch(/^mat-input-/);
    host.controlId.set('review-note');
    control = await render();
    expect(control.id).toBe('review-note');
    expect(document.getElementById('review-note')).toBe(control);
    expect([...((control as HTMLInputElement).labels ?? [])]).toHaveLength(1);
  });
});
