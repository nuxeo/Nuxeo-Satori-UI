import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import type { NxsTagColor, NxsTagInputs } from '../primitives';

/**
 * A short static label in a colour — the Material implementation of `nxs.primitives.tag`.
 *
 * Colours map to the theme's container roles, as the avatar's do; set
 * `--nxs-tag-<colour>-background` and `-foreground` to give each its own hue.
 */
@Component({
  selector: 'nxs-tag',
  standalone: true,
  templateUrl: './tag.component.html',
  styleUrl: './tag.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': "'nxs-tag nxs-tag--' + color()" },
})
export class NxsTagComponent implements NxsTagInputs {
  /** The text, already translated. A long label is cut short with an ellipsis. */
  readonly label = input.required<string>();
  /** The colour: `gray` or one of the avatar colours. */
  readonly color = input<NxsTagColor>('gray');
}
