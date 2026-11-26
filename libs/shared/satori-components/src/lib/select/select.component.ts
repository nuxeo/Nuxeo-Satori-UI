import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  input,
  model,
  type InputSignal,
} from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

import type { NxsFieldAppearance } from '../field-appearance';

/** One choice a select offers. */
export interface NxsSelectOption {
  /** What the select's `value` is while this is chosen. */
  readonly value: string;
  /** What the user reads, already translated. */
  readonly label: string;
}

/** Choices a select offers under a heading of their own, as a native `<optgroup>`. */
export interface NxsSelectGroup {
  /** The heading, already translated. */
  readonly label: string;
  readonly options: readonly NxsSelectOption[];
}

/**
 * A labelled choice of one value from a list: Angular Material's form field round a native
 * `<select>`, in the theme's colours.
 *
 * Native, so the list opens as the platform's own — a sheet on a phone — and its keys are the
 * platform's, as in every select. The label is required, already
 * translated: it is the select's accessible name. `options` are the choices, flat or under group
 * headings, and `placeholder`, when it is set, is a first choice whose value is `''`, such as
 * "Choose a file". `value` is the value chosen, two-way, changed when the user chooses.
 */
@Component({
  selector: 'nxs-select',
  standalone: true,
  templateUrl: './select.component.html',
  styleUrl: './select.component.scss',
  imports: [MatFormFieldModule, MatInputModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-select' },
})
export class NxsSelectComponent {
  /** The select's label, already translated: its accessible name. Required. */
  readonly label = input.required<string>();
  /** The value chosen. Two-way: it changes when the user chooses. */
  readonly value = model('');
  /** The choices, in order: each a choice or a group of them. */
  readonly options = input<readonly (NxsSelectOption | NxsSelectGroup)[]>([]);
  /** A first choice whose value is `''`, already translated, such as "Choose a file". Blank for none. */
  readonly placeholder = input('');
  /** `outline`, the default, or `fill`. */
  // Annotated rather than inferred, so that the published API names the union, not its members.
  readonly appearance: InputSignal<NxsFieldAppearance> = input<NxsFieldAppearance>('outline');
  /** Shown but not changeable, and skipped by Tab. */
  readonly disabled = input(false, { transform: booleanAttribute });

  protected isGroup(entry: NxsSelectOption | NxsSelectGroup): entry is NxsSelectGroup {
    return 'options' in entry;
  }

  /** What tracks an entry: a group by its heading, a choice by its value. */
  protected key(entry: NxsSelectOption | NxsSelectGroup): string {
    return this.isGroup(entry) ? `group:${entry.label}` : `option:${entry.value}`;
  }

  protected chosen(event: Event): void {
    if (event.target instanceof HTMLSelectElement) this.value.set(event.target.value);
  }
}
