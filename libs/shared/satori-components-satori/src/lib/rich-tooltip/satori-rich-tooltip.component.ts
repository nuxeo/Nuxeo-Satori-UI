import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import {
  SatRichTooltip,
  SatRichTooltipContent,
  SatRichTooltipTitle,
  SatRichTooltipTrigger,
} from '@hylandsoftware/satori-ui/rich-tooltip';
import type { NxsRichTooltipInputs } from '@nuxeo-satori/platform/components';

/** `nxs.primitives.richTooltip` on Satori's rich tooltip, which opens on hover and focus. */
@Component({
  selector: 'nxs-satori-rich-tooltip',
  standalone: true,
  templateUrl: './satori-rich-tooltip.component.html',
  imports: [
    MatButtonModule,
    MatIconModule,
    SatRichTooltip,
    SatRichTooltipContent,
    SatRichTooltipTitle,
    SatRichTooltipTrigger,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-satori-rich-tooltip', style: 'display: inline-block' },
})
export class NxsSatoriRichTooltipComponent implements NxsRichTooltipInputs {
  readonly heading = input.required<string>();
  readonly content = input.required<string>();
  readonly triggerLabel = input.required<string>();
  readonly icon = input('info');
}
