import { forwardRef, signal, type Provider, type Type } from '@angular/core';
import {
  NG_VALIDATORS,
  NG_VALUE_ACCESSOR,
  type AbstractControl,
  type ValidationErrors,
} from '@angular/forms';

/**
 * Provides a picker as the value accessor and a validator of the form control on its element —
 * `ngModel`, `formControl` or `formControlName` — so the form gets the picker's value and also
 * its own errors, such as text typed and never chosen.
 */
export function nxsPickerProviders(picker: () => Type<unknown>): Provider[] {
  return [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(picker), multi: true },
    { provide: NG_VALIDATORS, useExisting: forwardRef(picker), multi: true },
  ];
}

/**
 * The part of a picker that talks to a form. Without a form every call here is a no-op and the
 * picker's `value` model carries the value; with one, it keeps the callbacks the form registers
 * and the control the form validates, so the picker can show the form's `required` error too.
 */
export class NxsPickerControl<T> {
  /** The user has left the field at least once. */
  readonly touched = signal(false);
  /** The form disabled the control. */
  readonly formDisabled = signal(false);

  private control: AbstractControl | null = null;
  private onChange: (value: T) => void = () => undefined;
  private onTouched: () => void = () => undefined;
  private onValidatorChange: () => void = () => undefined;

  registerOnChange(fn: (value: T) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  registerOnValidatorChange(fn: () => void): void {
    this.onValidatorChange = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.formDisabled.set(disabled);
  }

  /** The picker's `validate`: remembers the control, and answers with the picker's own errors. */
  validate(control: AbstractControl, own: ValidationErrors | null): ValidationErrors | null {
    this.control = control;
    return own;
  }

  /** The picker's own errors changed: the form validates again. */
  revalidate(): void {
    this.onValidatorChange();
  }

  /** The user changed the value. */
  changed(value: T): void {
    this.onChange(value);
  }

  /** The user left the field. */
  blurred(): void {
    this.touched.set(true);
    this.onTouched();
  }

  /**
   * Focus left an element of the picker, whose `host` holds the input and every chip. Moving
   * between them is not leaving; anywhere else is, even when the input never had focus — a chip
   * removed with the mouse is otherwise never reported to a form that updates on blur.
   *
   * Focus leaving for nowhere is decided a task later. Chromium reports a focused chip's removal
   * that way, then Material focuses its neighbour or the input; counting it would mark the field
   * touched, and show its errors, while the user is still in it. It is leaving if focus has not
   * come back inside by then, or the window lost focus, as a native input counts it.
   */
  focusLeft(host: HTMLElement, event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && host.contains(next)) return;
    if (next) {
      this.blurred();
      return;
    }
    setTimeout(() => {
      const document = host.ownerDocument;
      if (!host.isConnected) return;
      if (!document.hasFocus() || !host.contains(document.activeElement)) this.blurred();
    });
  }

  /**
   * Touched as the form says, when there is one: leaving the field reaches it through `onTouched`,
   * and so do `markAllAsTouched()` on submit and `reset()` or `markAsUntouched()` after one — which
   * a flag kept here as well would outlive, leaving a cleared field showing its `required` error.
   * Without a form, touched here.
   */
  wasTouched(): boolean {
    return this.control ? this.control.touched : this.touched();
  }

  /** The form's validators, or the picker's own, reject the value. */
  formInvalid(): boolean {
    return Boolean(this.control?.invalid);
  }

  /** The form's `required` error, or `required` given to the picker, on an empty value. */
  missing(required: boolean, empty: boolean): boolean {
    return Boolean(this.control?.hasError('required')) || (required && empty);
  }
}
