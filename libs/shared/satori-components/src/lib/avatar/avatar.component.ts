import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { nxsNamedColorStyle } from '../named-colors';
import type { NxsAvatarColor, NxsAvatarInputs, NxsAvatarSize } from '../primitives';
import { nxsInitials, nxsVisibleText } from '../visible-text';

/**
 * A person's initials in a coloured circle — the Material implementation of
 * `nxs.primitives.avatar`.
 *
 * Material has no eight-hue palette, so each colour is a hue of its own (`named-colors.ts`) tinted
 * toward the theme's surface and text, which keeps it that colour in light and dark themes and under
 * any primary palette. Set `--nxs-avatar-<colour>-background` and `-foreground` to give a colour
 * another hue.
 */
@Component({
  selector: 'nxs-avatar',
  standalone: true,
  templateUrl: './avatar.component.html',
  styleUrl: './avatar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': "'nxs-avatar nxs-avatar--' + color() + ' nxs-avatar--size-' + size()",
    '[style]': 'namedColor()',
    '[attr.role]': "name() ? 'img' : null",
    '[attr.aria-label]': 'name() || null',
    '[attr.aria-hidden]': "name() ? null : 'true'",
  },
})
export class NxsAvatarComponent implements NxsAvatarInputs {
  /**
   * The person's initials, upper-cased: up to two, or one at size `24`, where two do not fit and
   * Satori's avatar shows one.
   */
  readonly initials = input.required<string>();
  /** The circle's colour: `purple`, `blue`, `pink`, `teal`, `yellow`, `green`, `red` or `orange`. */
  readonly color = input<NxsAvatarColor>('blue');
  /** The diameter in pixels: `24`, `28`, `36`, `64`, `80` or `128`. */
  readonly size = input<NxsAvatarSize>('36');
  /**
   * The accessible name, usually the person's name, already translated. Blank, or only whitespace
   * or zero-width characters, makes the avatar decorative.
   */
  readonly label = input('');

  protected readonly name = computed(() => nxsVisibleText(this.label()));

  protected readonly namedColor = computed(() => nxsNamedColorStyle(this.color()));

  protected readonly shownInitials = computed(() =>
    nxsInitials(this.initials(), this.size() === '24' ? 1 : 2),
  );
}
