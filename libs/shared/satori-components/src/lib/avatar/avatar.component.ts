import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import type { NxsAvatarColor, NxsAvatarInputs, NxsAvatarSize } from '../primitives';

/**
 * A person's initials in a coloured circle — the Material implementation of
 * `nxs.primitives.avatar`.
 *
 * Material has no eight-hue palette, so each colour maps to one of the theme's container roles and
 * follows the theme, dark included. Teal, which no role is, tints a teal hue toward the theme's
 * surface and text instead. Set `--nxs-avatar-<colour>-background` and `-foreground` to give each
 * colour its own hue.
 */
@Component({
  selector: 'nxs-avatar',
  standalone: true,
  templateUrl: './avatar.component.html',
  styleUrl: './avatar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': "'nxs-avatar nxs-avatar--' + color() + ' nxs-avatar--size-' + size()",
    '[attr.role]': "name() ? 'img' : null",
    '[attr.aria-label]': 'name() || null',
    '[attr.aria-hidden]': "name() ? null : 'true'",
  },
})
export class NxsAvatarComponent implements NxsAvatarInputs {
  /** The person's initials. Up to two characters are shown, upper-cased. */
  readonly initials = input.required<string>();
  /** The circle's colour: `purple`, `blue`, `pink`, `teal`, `yellow`, `green`, `red` or `orange`. */
  readonly color = input<NxsAvatarColor>('blue');
  /** The diameter in pixels: `24`, `28`, `36`, `64`, `80` or `128`. */
  readonly size = input<NxsAvatarSize>('36');
  /**
   * The accessible name, usually the person's name, already translated. Blank, or only whitespace,
   * makes the avatar decorative.
   */
  readonly label = input('');

  protected readonly name = computed(() => this.label().trim());

  protected readonly shownInitials = computed(() =>
    this.initials().trim().slice(0, 2).toUpperCase(),
  );
}
