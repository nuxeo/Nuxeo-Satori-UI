import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';

import type { NxsChipItem, NxsChipSetInputs } from '../primitives';

/**
 * A row of removable chips: the values a vocabulary field holds, or the filters a search applied.
 *
 * Each chip shows its label and a remove button labelled by its `removeLabel`. Pressing the button
 * emits `removed` with that chip and calls `removeHandler`, if the host gave one. The set removes
 * nothing itself: the host drops the item from its own list, and the chip leaves when `items` does.
 *
 * Registered as `nxs.primitives.chipSet`, so a customer can replace it by ID; a host rendering it that
 * way passes `removeHandler`, because the outlet binds no outputs.
 */
@Component({
  selector: 'nxs-chip-set',
  standalone: true,
  templateUrl: './chip-set.component.html',
  styleUrl: './chip-set.component.scss',
  imports: [MatChipsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-chip-set' },
})
export class NxsChipSetComponent implements NxsChipSetInputs {
  /** The chips, in order. */
  readonly items = input<readonly NxsChipItem[]>([]);
  /** The set's accessible name, or blank for none. */
  readonly label = input('');
  /** Called when a chip's remove button is pressed, before `removed` is emitted. */
  readonly removeHandler = input<((item: NxsChipItem) => void) | null>(null);

  /** A chip's remove button was pressed. */
  readonly removed = output<NxsChipItem>();

  protected pressRemove(item: NxsChipItem): void {
    this.removeHandler()?.(item);
    this.removed.emit(item);
  }
}
