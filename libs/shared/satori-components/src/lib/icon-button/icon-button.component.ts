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

import type { NxsButtonType } from '../button/button.component';
import { NxsIconComponent } from '../icon/icon.component';
import { nxsVisibleText } from '../visible-text';

/**
 * A button that is only an icon: Angular Material's icon button, as a native `<button>`.
 *
 * An icon does not say what it does, so `label`, the accessible name, is required, already
 * translated; the icon itself is decorative. Name the thing it acts on when several sit side by
 * side — "Move member:phone up", not "Up" — so that a list of them read out is a list of different
 * buttons.
 *
 * `press` fires when the button is pressed: clicked, or Enter or Space while it has the focus,
 * never while it is disabled. It is a `type="button"` unless `type` says otherwise.
 */
@Component({
  selector: 'nxs-icon-button',
  standalone: true,
  templateUrl: './icon-button.component.html',
  styleUrl: './icon-button.component.scss',
  imports: [MatButtonModule, NxsIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-icon-button' },
})
export class NxsIconButtonComponent {
  /** The icon, by its ligature. */
  readonly icon = input.required<string>();
  /** What the button does, already translated: its accessible name. Required. */
  readonly label = input.required<string>();
  /** `button`, the default, `submit` or `reset`. */
  readonly type: InputSignal<NxsButtonType> = input<NxsButtonType>('button');
  /** Shown but not pressable, and skipped by Tab, as a disabled native button is. */
  readonly disabled = input(false, { transform: booleanAttribute });
  /** The button was pressed. Never emitted while it is disabled. */
  readonly press = output<void>();

  /** The accessible name as a reader gets it: whitespace or zero-width characters alone are no name. */
  protected readonly name = computed(() => nxsVisibleText(this.label()));

  protected pressed(): void {
    if (!this.disabled()) this.press.emit();
  }
}
