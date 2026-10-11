import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import type { NxsAvatarColor, NxsAvatarInputs, NxsAvatarSize } from '../primitives';

/**
 * A person's initials in a coloured circle — the Material implementation of
 * `nxs.primitives.avatar`.
 *
 * Material has no eight-hue palette, so each colour maps to one of the theme's container roles and
 * follows the theme, dark included. Set `--nxs-avatar-<colour>-background` and `-foreground` to
 * give each colour its own hue.
 */
@Component({
  selector: 'nxs-avatar',
  standalone: true,
  templateUrl: './avatar.component.html',
  styleUrl: './avatar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': "'nxs-avatar nxs-avatar--' + color() + ' nxs-avatar--size-' + size()",
    '[attr.role]': "label() ? 'img' : null",
    '[attr.aria-label]': 'label() || null',
    '[attr.aria-hidden]': "label() ? null : 'true'",
  },
})
export class NxsAvatarComponent implements NxsAvatarInputs {
  readonly initials = input.required<string>();
  readonly color = input<NxsAvatarColor>('blue');
  readonly size = input<NxsAvatarSize>('36');
  readonly label = input('');

  protected readonly shownInitials = computed(() =>
    this.initials().trim().slice(0, 2).toUpperCase(),
  );
}
