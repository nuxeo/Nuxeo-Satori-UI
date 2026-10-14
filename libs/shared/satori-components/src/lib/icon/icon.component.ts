import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

import { nxsVisibleText } from '../visible-text';

/**
 * One icon, by its Material Icons ligature (`folder`, `description`, `collections_bookmark`).
 *
 * Decorative unless given a `label`: an icon beside text that already says the same thing is
 * hidden from assistive technology, and an icon that stands alone is an image with that name.
 *
 * Sized by `--nxs-icon-size` (24px by default) and coloured by `color`, both inherited, so a host
 * sets them on the element or on any ancestor — including through `nxs-doc-type-icon`.
 */
@Component({
  selector: 'nxs-icon',
  standalone: true,
  templateUrl: './icon.component.html',
  styleUrl: './icon.component.scss',
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-icon' },
})
export class NxsIconComponent {
  /** The Material Icons ligature. */
  readonly name = input.required<string>();
  /** What the icon means, already translated. Blank makes it decorative. */
  readonly label = input('');

  /** The accessible name as a reader gets it: whitespace or zero-width characters alone are no name. */
  protected readonly accessibleName = computed(() => nxsVisibleText(this.label()));
}
