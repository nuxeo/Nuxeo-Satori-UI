import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  computed,
  input,
  output,
  type InputSignal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';

import { NxsIconComponent } from '../icon/icon.component';
import { nxsVisibleText } from '../visible-text';

/**
 * How much a button stands out: `filled` for the one action a region recommends, `outlined` for
 * the others beside it, and `text`, the quietest, for an action that sits in a list or a row.
 */
export type NxsButtonAppearance = 'text' | 'outlined' | 'filled';

/** What a button does in a form: `button` nothing but `press`; `submit` and `reset` act on the form. */
export type NxsButtonType = 'button' | 'submit' | 'reset';

/**
 * A button with text: Angular Material's, in the theme's colours, as a native `<button>`.
 *
 * The text is the content, already translated. `label` replaces it as the accessible name where the
 * text alone does not say enough — a "Show" beside each of several fields, say. `icon` puts an icon
 * before the text, decorative because the text names the button. For a button that is only an
 * icon, use `nxs-icon-button`, which requires its name.
 *
 * `press` fires when the button is pressed: clicked, or Enter or Space while it has the focus,
 * never while it is disabled. It is a `type="button"` unless `type` says otherwise, so inside a
 * form it submits nothing by accident. `disabledInteractive` keeps a disabled button focusable,
 * `ariaPressed` makes it a toggle, and `describedBy` and `controlId` reach the native button for a
 * page that describes it or focuses it.
 */
@Component({
  selector: 'nxs-button',
  standalone: true,
  templateUrl: './button.component.html',
  styleUrl: './button.component.scss',
  imports: [MatButtonModule, NxsIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-button' },
})
export class NxsButtonComponent {
  /** How much it stands out: `text`, the default, `outlined` or `filled`. */
  // Annotated rather than inferred, so that the published API names the union, not its members.
  readonly appearance: InputSignal<NxsButtonAppearance> = input<NxsButtonAppearance>('text');
  /** An icon before the text, by its ligature. Blank for none. */
  readonly icon = input('');
  /**
   * The accessible name, already translated, where the text alone does not say enough. Blank, or
   * only whitespace or zero-width characters, leaves the text as the name.
   */
  readonly label = input('');
  /** `button`, the default, `submit` or `reset`. */
  readonly type: InputSignal<NxsButtonType> = input<NxsButtonType>('button');
  /** Shown but not pressable, and skipped by Tab, as a disabled native button is. */
  readonly disabled = input(false, { transform: booleanAttribute });
  /**
   * While `disabled`, keeps the button in the tab order, announced as unavailable
   * (`aria-disabled`) rather than natively disabled, so a button disabled while its action is saved
   * keeps the keyboard's focus. It still does not press. A `submit` button so disabled still
   * submits its form, as a native one with `aria-disabled` does: the form's handler decides.
   */
  readonly disabledInteractive = input(false, { transform: booleanAttribute });
  /**
   * Whether a toggle button is pressed, said as `aria-pressed` and drawn in colour and weight, not
   * colour alone. `null`, the default, for a button that is not a toggle.
   */
  readonly ariaPressed = input<boolean | null>(null);
  /**
   * The id of an element on the page whose text describes the button further, such as the
   * question it answers, read after its name. `null` for none.
   */
  readonly describedBy = input<string | null>(null);
  /**
   * The native button's id, for a page that moves the focus to it by id. Blank for none.
   */
  readonly controlId = input('');
  /** The button was pressed. Never emitted while it is disabled. */
  readonly press = output<void>();

  /** The accessible name as a reader gets it: whitespace or zero-width characters alone are no name. */
  protected readonly name = computed(() => nxsVisibleText(this.label()));

  protected pressed(): void {
    if (!this.disabled()) this.press.emit();
  }
}
