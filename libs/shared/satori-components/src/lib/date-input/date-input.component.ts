import { NxsDateMaskPipe } from './date-mask.pipe';
import { nxsDateFromAdapter, nxsDateToAdapter } from './adapter-date';
import {
  ChangeDetectionStrategy,
  Component,
  type DoCheck,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
  model,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type {
  AbstractControl,
  ControlValueAccessor,
  ValidationErrors,
  Validator,
} from '@angular/forms';
import { DateAdapter, MAT_DATE_FORMATS } from '@angular/material/core';
import {
  MatDatepickerInput,
  MatDatepickerIntl,
  MatDatepickerModule,
  type MatDatepickerInputEvent,
} from '@angular/material/datepicker';
import { MatInput, MatInputModule } from '@angular/material/input';
import { TranslatePipe } from '@ngx-translate/core';

import { NxsPickerControl, nxsPickerProviders } from '../pickers/picker-control';
import { provideNxsDateAdapter } from './locale-date';
import { TranslatedDatepickerIntl } from './translated-datepicker-intl';

/**
 * A date field: typed, or chosen from Material's calendar — the thin wrapper over the Material
 * datepicker the application's date fields share.
 *
 * A typed date is read in the order the user's locale writes dates — `03/04/2026` is 3 April in
 * French and 4 March in American English — where Material's native adapter reads every one as
 * American. A host that provides its own date adapter, other than Material's native one, keeps it.
 * The calendar's labels are translated. Text that is not a date, or a date outside `min` and `max`,
 * shows an error with an example in the locale's format and is an error on the form
 * (`nxsDateParse`, `nxsDateMin`, `nxsDateMax`); the value is then `null`.
 */
@Component({
  selector: 'nxs-date-input',
  standalone: true,
  templateUrl: './date-input.component.html',
  styleUrl: './date-input.component.scss',
  imports: [NxsDateMaskPipe, MatDatepickerModule, MatInputModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    nxsPickerProviders(() => NxsDateInputComponent),
    provideNxsDateAdapter(),
    { provide: MatDatepickerIntl, useClass: TranslatedDatepickerIntl },
  ],
  host: { class: 'nxs-date-input' },
})
export class NxsDateInputComponent implements ControlValueAccessor, Validator, DoCheck {
  /** The field's label, already translated. Required: the input has no other name. */
  readonly label = input.required<string>();
  /** The earliest date allowed, or `null`. */
  readonly min = input<Date | null>(null);
  /** The latest date allowed, or `null`. */
  readonly max = input<Date | null>(null);
  /** Help under the field, already translated. */
  readonly hint = input('');
  /** Marks the field required. With a form, its `Validators.required` does the same. */
  readonly required = input(false, { transform: booleanAttribute });
  /** Shown but not editable. A form's `disable()` does the same. */
  readonly disabled = input(false, { transform: booleanAttribute });
  /** The date, at local midnight, or `null`. Two-way; a form control carries the same value. */
  readonly value = model<Date | null>(null);

  private readonly adapter = inject<DateAdapter<unknown>>(DateAdapter);
  private readonly formats = inject(MAT_DATE_FORMATS);
  private readonly input = viewChild.required(MatInput);
  private readonly dateInput = viewChild<MatDatepickerInput<unknown>>(MatDatepickerInput);
  /** The date the field last set itself, so its own changes are not mistaken for a host's. */
  private committed: Date | null = null;
  private readonly control = new NxsPickerControl<Date | null>();

  /** What the user typed, while it is not a date the field holds. */
  private readonly typed = signal('');
  protected readonly adapterMin = computed(() => nxsDateToAdapter(this.adapter, this.min()));
  protected readonly adapterMax = computed(() => nxsDateToAdapter(this.adapter, this.max()));
  protected readonly isDisabled = computed(() => this.disabled() || this.control.formDisabled());
  /** Why the typed text or the date is refused, if it is. */
  protected readonly problem = computed<'parse' | 'min' | 'max' | null>(() => {
    if (this.typed().trim() && !this.value()) return 'parse';
    const value = this.value();
    if (!value) return null;
    const min = this.min();
    const max = this.max();
    if (
      min &&
      this.adapter.compareDate(
        nxsDateToAdapter(this.adapter, value),
        nxsDateToAdapter(this.adapter, min),
      ) < 0
    )
      return 'min';
    if (
      max &&
      this.adapter.compareDate(
        nxsDateToAdapter(this.adapter, value),
        nxsDateToAdapter(this.adapter, max),
      ) > 0
    )
      return 'max';
    return null;
  });
  /** A date written the way the locale writes dates, with a day above 12 so the order shows. */
  protected readonly example = computed(() =>
    this.formatted(this.adapter.createDate(new Date().getFullYear(), 11, 31)),
  );
  protected readonly errorState = {
    isErrorState: () =>
      this.control.wasTouched() &&
      (this.problem() !== null || this.missing() || this.control.formInvalid()),
  };

  constructor() {
    effect(() => {
      this.problem();
      untracked(() => this.control.revalidate());
    });
    // A date set from outside is written into the input. The field's own changes are not: writing
    // `null` while the user types text that is not a date yet would erase what they typed.
    effect(() => {
      const value = this.value();
      const field = this.dateInput();
      if (!field) return;
      untracked(() => {
        if (value === this.committed) return;
        this.committed = value;
        this.typed.set('');
        field.value = nxsDateToAdapter(this.adapter, value);
      });
    });
  }

  /** `MatInput` recomputes its error state only with a form control of its own. */
  ngDoCheck(): void {
    this.input().updateErrorState();
  }

  writeValue(value: unknown): void {
    const date = nxsDateFromAdapter(this.adapter, value);
    this.typed.set('');
    this.value.set(date);
    // A form reset is explicit even when the value is already null. Write it now: deferring an
    // initial ngModel write until a later render can erase the user's first partial keystroke.
    const field = this.dateInput();
    if (field) {
      this.committed = date;
      field.value = nxsDateToAdapter(this.adapter, date);
    }
  }

  registerOnChange(fn: (value: Date | null) => void): void {
    this.control.registerOnChange(fn);
  }

  registerOnTouched(fn: () => void): void {
    this.control.registerOnTouched(fn);
  }

  setDisabledState(disabled: boolean): void {
    this.control.setDisabledState(disabled);
  }

  validate(control: AbstractControl): ValidationErrors | null {
    const problem = this.problem();
    const errors: ValidationErrors | null =
      problem === 'parse'
        ? { nxsDateParse: { text: this.typed() } }
        : problem === 'min'
          ? { nxsDateMin: { min: this.min() } }
          : problem === 'max'
            ? { nxsDateMax: { max: this.max() } }
            : null;
    return this.control.validate(control, errors);
  }

  registerOnValidatorChange(fn: () => void): void {
    this.control.registerOnValidatorChange(fn);
  }

  protected missing(): boolean {
    return this.control.missing(this.required(), this.value() === null && !this.typed().trim());
  }

  protected formatted(date: unknown): string {
    if (date instanceof Date) date = nxsDateToAdapter(this.adapter, date);
    return date && this.adapter.isValid(date)
      ? this.adapter.format(date, this.formats.display.dateInput)
      : '';
  }

  /**
   * The raw text, on each key. The datepicker emits `dateInput` only when its date changes, so text
   * that is not a date, typed into an empty field, reaches the picker only here.
   */
  protected typing(event: Event): void {
    const before = this.problem();
    this.typed.set((event.target as HTMLInputElement).value);
    if (before !== this.problem()) this.control.revalidate();
  }

  /** Each key typed, and a date chosen from the calendar: the datepicker has parsed the text. */
  protected changed(event: MatDatepickerInputEvent<unknown>): void {
    const text = event.targetElement instanceof HTMLInputElement ? event.targetElement.value : '';
    const date = nxsDateFromAdapter(this.adapter, event.value);
    this.typed.set(date ? '' : text);
    this.committed = date;
    this.value.set(date);
    this.control.changed(date);
  }

  protected blurred(): void {
    this.control.blurred();
  }
}
