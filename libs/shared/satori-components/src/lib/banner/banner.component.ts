import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import type {
  NxsBannerAction,
  NxsBannerAnnounce,
  NxsBannerInputs,
  NxsBannerTone,
} from '../primitives';

const ICONS: Readonly<Record<NxsBannerTone, string>> = {
  info: 'info',
  warning: 'warning',
  error: 'error_outline',
};

const ROLES: Readonly<Record<NxsBannerAnnounce, string | null>> = {
  none: null,
  status: 'status',
  alert: 'alert',
};

/**
 * A notice within content: a message the reader should see, and the actions that answer it.
 *
 * `tone` picks the icon and colours. `announce` sets how a screen reader hears the notice as it
 * appears: `alert` for one that appears because something went wrong, `status` for one that reports
 * progress, and `none`, the default, for one the reader will meet in place. Each action is a button
 * that calls its `press` when pressed; `emphasis` and `danger` pick its look.
 *
 * Everything the banner shows is an input, so it renders the same whether a screen places it or the
 * ID `nxs.primitives.banner` does: an outlet passes no content, only inputs.
 */
@Component({
  selector: 'nxs-banner',
  standalone: true,
  templateUrl: './banner.component.html',
  styleUrl: './banner.component.scss',
  imports: [MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'nxs-banner',
    '[attr.data-tone]': 'tone()',
    '[attr.role]': 'role()',
  },
})
export class NxsBannerComponent implements NxsBannerInputs {
  /** The message, already translated. */
  readonly message = input('');
  /** What kind of notice it is: the icon and colours follow from it. */
  readonly tone = input<NxsBannerTone>('info');
  /** How a screen reader announces it as it appears. */
  readonly announce = input<NxsBannerAnnounce>('none');
  /** The actions offered after the message, in order. */
  readonly actions = input<readonly NxsBannerAction[]>([]);

  protected readonly icon = computed(() => ICONS[this.tone()]);
  protected readonly role = computed(() => ROLES[this.announce()]);

  protected press(action: NxsBannerAction): void {
    action.press();
  }
}
