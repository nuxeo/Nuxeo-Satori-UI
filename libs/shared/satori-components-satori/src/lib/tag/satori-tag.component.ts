import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { SatCategoryTag } from '@hylandsoftware/satori-ui/tag';
import type { NxsTagColor, NxsTagInputs } from '@nuxeo-satori/platform/components';

/** `nxs.primitives.tag` on Satori's `sat-category-tag`. */
@Component({
  selector: 'nxs-satori-tag',
  standalone: true,
  templateUrl: './satori-tag.component.html',
  imports: [SatCategoryTag],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-satori-tag', style: 'display: inline-flex' },
})
export class NxsSatoriTagComponent implements NxsTagInputs {
  readonly label = input.required<string>();
  readonly color = input<NxsTagColor>('gray');
}
