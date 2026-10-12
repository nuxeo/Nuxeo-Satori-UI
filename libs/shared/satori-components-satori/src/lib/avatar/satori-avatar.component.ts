import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { SatAvatar } from '@hylandsoftware/satori-ui/avatar';
import type {
  NxsAvatarColor,
  NxsAvatarInputs,
  NxsAvatarSize,
} from '@nuxeo-satori/platform/components';

/** `nxs.primitives.avatar` on Satori's `sat-avatar`, with the same accessible name as Material's. */
@Component({
  selector: 'nxs-satori-avatar',
  standalone: true,
  templateUrl: './satori-avatar.component.html',
  imports: [SatAvatar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'nxs-satori-avatar',
    style: 'display: inline-flex',
    '[attr.role]': "label() ? 'img' : null",
    '[attr.aria-label]': 'label() || null',
    '[attr.aria-hidden]': "label() ? null : 'true'",
  },
})
export class NxsSatoriAvatarComponent implements NxsAvatarInputs {
  readonly initials = input.required<string>();
  readonly color = input<NxsAvatarColor>('blue');
  readonly size = input<NxsAvatarSize>('36');
  readonly label = input('');

  /**
   * Material's display value, never empty: at size 24 `sat-avatar` reads `initials()[0]`, which
   * throws on an empty string inside change detection. A space renders the blank circle Material
   * renders for blank initials.
   */
  protected readonly shownInitials = computed(
    () => this.initials().trim().slice(0, 2).toUpperCase() || ' ',
  );
}
