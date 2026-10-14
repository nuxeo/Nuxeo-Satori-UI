import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { nxsNamedColorStyle } from '../named-colors';
import type { NxsTagColor, NxsTagInputs } from '../primitives';

/**
 * A short static label in a colour — the Material implementation of `nxs.primitives.tag`.
 *
 * Each colour is a hue of its own, tinted as the avatar's are, and `gray` the theme's neutral
 * container; set `--nxs-tag-<colour>-background` and `-foreground` to give a colour another hue. A
 * label longer than the space wraps inside the tag, as Web UI's does, rather than being cut short or
 * spilling out.
 */
@Component({
  selector: 'nxs-tag',
  standalone: true,
  templateUrl: './tag.component.html',
  styleUrl: './tag.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': "'nxs-tag nxs-tag--' + color()", '[style]': 'namedColor()' },
})
export class NxsTagComponent implements NxsTagInputs {
  /** The text, already translated. A long label wraps; it is never cut short. */
  readonly label = input.required<string>();
  /** The colour: `gray` or one of the avatar colours. */
  readonly color = input<NxsTagColor>('gray');

  protected readonly namedColor = computed(() => nxsNamedColorStyle(this.color()));
}
