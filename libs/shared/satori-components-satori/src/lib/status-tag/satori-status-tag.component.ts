import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import type { NxsStatusTagInputs, NxsTagStatus } from '@nuxeo/satori-platform/components';

/** `nxs.primitives.statusTag` on Satori's `sat-status-tag`. */
@Component({
  selector: 'nxs-satori-status-tag',
  standalone: true,
  templateUrl: './satori-status-tag.component.html',
  imports: [SatStatusTag],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-satori-status-tag', style: 'display: inline-flex' },
})
export class NxsSatoriStatusTagComponent implements NxsStatusTagInputs {
  readonly label = input.required<string>();
  readonly status = input<NxsTagStatus>('neutral');
  readonly hideIcon = input<boolean>(false);
}
