import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { AppConfigService } from '@nuxeo/satori-platform/app-config';

/**
 * Names the presales preset in force, so nobody mistakes a demo configuration for the product's.
 *
 * Renders nothing unless a package enables preset switching and a preset is chosen — which is
 * never the case on a customer's server.
 */
@Component({
  selector: 'app-preset-badge',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './preset-badge.component.html',
  styleUrl: './preset-badge.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PresetBadgeComponent {
  protected readonly preset = inject(AppConfigService).activePreset;
}
