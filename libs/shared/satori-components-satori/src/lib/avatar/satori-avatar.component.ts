import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { SatAvatar } from '@hylandsoftware/satori-ui/avatar';
import {
  nxsInitials,
  nxsVisibleText,
  type NxsAvatarColor,
  type NxsAvatarInputs,
  type NxsAvatarSize,
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

  /** Material's rule: the label as a reader gets it, and blank means decorative. */
  protected readonly name = computed(() => nxsVisibleText(this.label()));

  /**
   * Material's display value, never empty: at size 24 `sat-avatar` reads `initials()[0]`, which
   * throws on an empty string inside change detection, and would split an emoji there. So size 24
   * gets one whole initial, as Material's does, and a space renders the blank circle Material
   * renders for blank initials.
   */
  protected readonly shownInitials = computed(
    () => nxsInitials(this.initials(), this.size() === '24' ? 1 : 2) || ' ',
  );
}
