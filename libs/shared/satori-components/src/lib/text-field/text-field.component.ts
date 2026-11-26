import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  input,
  model,
  numberAttribute,
  output,
  type InputSignal,
} from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

import type { NxsFieldAppearance } from '../field-appearance';

let nextId = 0;

/**
 * A labelled text field: Angular Material's form field round a native `<input>`, or a `<textarea>`
 * when `multiline`, in the theme's colours.
 *
 * The label is required, already translated: it is the field's accessible name, linked to the
 * control by Material's `<label for>`. `value` is the text, two-way, and changes as each key is
 * typed; `valueCommit` fires when an edit is committed — the field is left, or Enter is pressed in a
 * one-line field — the native `change` event, for a host that acts on a finished edit rather than on
 * every key. `suggestions` offers values to complete from, as a native `<datalist>`.
 *
 * The control's font is the form field's, unless `--nxs-text-field-font-family` is set on the
 * element or an ancestor: `monospace` for a field holding code, say.
 */
@Component({
  selector: 'nxs-text-field',
  standalone: true,
  templateUrl: './text-field.component.html',
  styleUrl: './text-field.component.scss',
  imports: [MatFormFieldModule, MatInputModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-text-field' },
})
export class NxsTextFieldComponent {
  /** The field's label, already translated: its accessible name. Required. */
  readonly label = input.required<string>();
  /** The text. Two-way: it changes as each key is typed. */
  readonly value = model('');
  /** Shown in the empty field, already translated. Not a substitute for the label. */
  readonly placeholder = input('');
  /** A `<textarea>` of `rows` lines rather than a one-line `<input>`. */
  readonly multiline = input(false, { transform: booleanAttribute });
  /** How many lines a multiline field shows. */
  readonly rows = input(2, { transform: numberAttribute });
  /**
   * Values the browser offers to complete from as the user types, in a one-line field: a textarea
   * takes no `list`. None by default.
   */
  readonly suggestions = input<readonly string[]>([]);
  /**
   * The native `autocomplete` attribute of a one-line field: `off` stops the browser offering what
   * it remembers. Blank leaves the browser's own behaviour.
   */
  readonly autocomplete = input('');
  /** `outline`, the default, or `fill`. */
  // Annotated rather than inferred, so that the published API names the union, not its members.
  readonly appearance: InputSignal<NxsFieldAppearance> = input<NxsFieldAppearance>('outline');
  /** Shown but not editable, and skipped by Tab. */
  readonly disabled = input(false, { transform: booleanAttribute });
  /** An edit was committed: the field was left, or Enter pressed in a one-line field. Carries the text. */
  readonly valueCommit = output<string>();

  /** The `<datalist>`'s id, unique on the page, which the input's `list` names. */
  protected readonly listId = `nxs-text-field-suggestions-${nextId++}`;

  protected typed(event: Event): void {
    this.value.set(textOf(event));
  }

  protected committed(event: Event): void {
    this.valueCommit.emit(textOf(event));
  }
}

function textOf(event: Event): string {
  const target = event.target;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
    ? target.value
    : '';
}
