import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  booleanAttribute,
  input,
  model,
  numberAttribute,
  output,
  viewChild,
  type InputSignal,
} from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

import type { NxsFieldAppearance } from '../field-appearance';

let nextId = 0;

/** A number a template may give as a static attribute (`min="0"`), or `null` for none. */
function numberOrNull(value: unknown): number | null {
  return value === null || value === undefined || value === '' ? null : numberAttribute(value);
}

/** What a one-line field holds: `text`, or a `number`, which the platform's number input takes. */
export type NxsTextFieldType = 'text' | 'number';

/** Where the hint sits under the field: at its `start`, or its `end`, as a count of characters does. */
export type NxsTextFieldHintAlign = 'start' | 'end';

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
 * A value written into `value` is what the control shows, even one it showed before the user's last
 * key: a host that settles a field once it is left writes the settled value there.
 *
 * A one-line field of `type="number"` is the platform's number input, held by `min`, `max` and
 * `step`; `maxLength` caps either kind, `required` marks it required, and `hint` is help under it,
 * which describes the control. `controlId` gives the control an id a page can focus it by.
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
  /** `text`, the default, or `number`, for a one-line field. A textarea holds text. */
  // Annotated rather than inferred, so that the published API names the union, not its members.
  readonly type: InputSignal<NxsTextFieldType> = input<NxsTextFieldType>('text');
  /** The least value a `number` field takes, or `null` for none. */
  readonly min = input<number | null, unknown>(null, { transform: numberOrNull });
  /** The greatest value a `number` field takes, or `null` for none. */
  readonly max = input<number | null, unknown>(null, { transform: numberOrNull });
  /** The step a `number` field's arrows move by, or `null` for the platform's. */
  readonly step = input<number | null, unknown>(null, { transform: numberOrNull });
  /** The most characters the field takes, or `null` for no limit. */
  readonly maxLength = input<number | null, unknown>(null, { transform: numberOrNull });
  /** Marks the field required: its label says so, and the control is `required`. */
  readonly required = input(false, { transform: booleanAttribute });
  /** Help under the field, already translated, which describes the control. Blank for none. */
  readonly hint = input('');
  /** Where the hint sits: at the field's `start`, the default, or its `end`. */
  readonly hintAlign: InputSignal<NxsTextFieldHintAlign> = input<NxsTextFieldHintAlign>('start');
  /** The control's id, for a page that moves the focus to it by id. Blank leaves Material's own. */
  readonly controlId = input('');
  /** An edit was committed: the field was left, or Enter pressed in a one-line field. Carries the text. */
  readonly valueCommit = output<string>();

  /** The `<datalist>`'s id, unique on the page, which the input's `list` names. */
  protected readonly listId = `nxs-text-field-suggestions-${nextId++}`;

  private readonly control =
    viewChild<ElementRef<HTMLInputElement | HTMLTextAreaElement>>('control');

  constructor() {
    // A value the host sets back to what the field last showed, before the page redraws — the
    // place a field settles on once it is left, say, after a key emptied it — changes no binding,
    // so the binding writes nothing and the field would go on showing what was typed.
    afterRenderEffect({
      write: () => {
        const value = this.value();
        const control = this.control()?.nativeElement;
        if (control && control.value !== value) control.value = value;
      },
    });
  }

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
