import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

import type { NxsStatusTagInputs, NxsTagStatus } from '../primitives';

/** The icon each status shows, unless `hideIcon` is set. `null` shows none. */
const STATUS_ICONS: Readonly<Record<NxsTagStatus, string | null>> = {
  'important-loud': 'error',
  important: 'priority_high',
  success: 'check_circle',
  warning: 'warning',
  info: 'info',
  neutral: null,
  'neutral-quiet': null,
};

/**
 * A short status label — the Material implementation of `nxs.primitives.statusTag`.
 *
 * Each status is a container role of its own, and `--nxs-status-tag-<status>-background` and
 * `-foreground` give a status another colour. Without Satori the colours are Material's, so the
 * Satori variant's palette is not reproduced here. A label longer than the space wraps inside the
 * tag rather than being cut short.
 */
@Component({
  selector: 'nxs-status-tag',
  standalone: true,
  templateUrl: './status-tag.component.html',
  styleUrl: './status-tag.component.scss',
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': "'nxs-status-tag nxs-status-tag--' + status()" },
})
export class NxsStatusTagComponent implements NxsStatusTagInputs {
  /** The text, already translated. A long label wraps; it is never cut short. */
  readonly label = input.required<string>();
  /** The status, which sets the colours and, unless hidden, the icon. */
  readonly status = input<NxsTagStatus>('neutral');
  /** Hide the status's icon. */
  readonly hideIcon = input<boolean>(false);

  protected readonly icon = computed(() => (this.hideIcon() ? null : STATUS_ICONS[this.status()]));
}
