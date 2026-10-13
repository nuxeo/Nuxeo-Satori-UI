import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { SatAvatar } from '@hylandsoftware/satori-ui/avatar';
import type {
  NxsAvatarColor,
  NxsAvatarInputs,
  NxsAvatarSize,
} from '@nuxeo-satori/platform/components';

/**
 * `nxs.primitives.avatar` on Satori's `sat-avatar`, with the same accessible name as Material's.
 *
 * `sat-avatar` is itself `role="img"` and takes no name, so this host is the one image and
 * `sat-avatar` is presentational inside it.
 */
@Component({
  selector: 'nxs-satori-avatar',
  standalone: true,
  templateUrl: './satori-avatar.component.html',
  imports: [SatAvatar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'nxs-satori-avatar',
    style: 'display: inline-flex',
    '[attr.role]': "name() ? 'img' : null",
    '[attr.aria-label]': 'name() || null',
    '[attr.aria-hidden]': "name() ? null : 'true'",
  },
})
export class NxsSatoriAvatarComponent implements NxsAvatarInputs {
  readonly initials = input.required<string>();
  readonly color = input<NxsAvatarColor>('blue');
  readonly size = input<NxsAvatarSize>('36');
  readonly label = input('');

  /** Material's rule: the label without the whitespace around it, and blank means decorative. */
  protected readonly name = computed(() => this.label().trim());

  /**
   * Material's display value, never empty: at size 24 `sat-avatar` reads `initials()[0]`, which
   * throws on an empty string inside change detection. A space renders the blank circle Material
   * renders for blank initials.
   */
  protected readonly shownInitials = computed(
    () => this.initials().trim().slice(0, 2).toUpperCase() || ' ',
  );
}
