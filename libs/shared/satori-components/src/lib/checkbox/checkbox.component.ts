import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  computed,
  input,
  output,
} from '@angular/core';
import { MAT_CHECKBOX_DEFAULT_OPTIONS, MatCheckboxModule } from '@angular/material/checkbox';

/**
 * A tick box whose state its owner holds. It shows `checked`, and a click on it or on its words, or
 * Space while it has the focus, asks for the other state through `checkedChange`, without changing
 * what it shows: it changes only when the owner sets `checked`. So a state that is saved first, and
 * may be refused, is never shown before it is, and a refusal leaves the box as it was.
 *
 * Its words are its content, which names it for assistive technology:
 * `<nxs-checkbox [checked]="done()">Medical records received</nxs-checkbox>`.
 *
 * `disabled` keeps it in the tab order, announced as unavailable (`aria-disabled`), and asks for
 * nothing while it lasts: a box disabled while its change is saved keeps the keyboard's focus.
 *
 * Angular Material's checkbox underneath, told to leave its state alone (`clickAction: 'noop'`), in
 * the theme's colours.
 */
@Component({
  selector: 'nxs-checkbox',
  standalone: true,
  templateUrl: './checkbox.component.html',
  styleUrl: './checkbox.component.scss',
  imports: [MatCheckboxModule],
  // Its own view only: a checkbox in the words it is given keeps the app's defaults.
  viewProviders: [{ provide: MAT_CHECKBOX_DEFAULT_OPTIONS, useValue: { clickAction: 'noop' } }],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-checkbox' },
})
export class NxsCheckboxComponent {
  /** Whether it shows ticked. Accepts a static attribute, `checked`. */
  readonly checked = input(false, { transform: booleanAttribute });
  /**
   * Whether it asks for nothing for now, as while a change is being saved. It stays focusable and
   * says it is unavailable, so the keyboard's focus is not lost.
   */
  readonly disabled = input(false, { transform: booleanAttribute });
  /**
   * The id of an element on the page whose text describes the box further, such as who ticked it
   * and when, read after its name. `null` for none.
   */
  readonly describedBy = input<string | null>(null);
  /**
   * The state the person asks for, the opposite of `checked`, on each click or Space. Not emitted
   * while `disabled`. Set `checked` to it once it holds; until then the box shows what it showed.
   */
  readonly checkedChange = output<boolean>();

  /**
   * What Material's `aria-describedby` is given: its input is typed `string`, and it leaves the
   * attribute off for `null`, as for its own default.
   */
  protected readonly description = computed(() => this.describedBy() as string);

  /**
   * One activation: the native box's own click, which a click on the words or Space also gives. A
   * click on the label around it bubbles here as well, and is not a second activation.
   */
  protected request(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    if (target?.tagName !== 'INPUT' || target.type !== 'checkbox') return;
    if (this.disabled()) return;
    this.checkedChange.emit(!this.checked());
  }
}
