import { NgStyle } from '@angular/common';
import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { DescriptorLabelPipe } from '@nuxeo/satori-platform/extensions';

import { AppThemeDefinition } from '../../theme/app-theme';
import { AppThemeService } from '../../theme/app-theme.service';

@Component({
  standalone: true,
  selector: 'app-themes-page',
  imports: [NgStyle, MatButtonModule, MatIconModule, TranslatePipe, DescriptorLabelPipe],
  templateUrl: './themes-page.component.html',
  styleUrl: './themes-page.component.scss',
})
export class ThemesPageComponent {
  protected readonly theme = inject(AppThemeService);
  /** Configured, not compiled in: a theme added to `bootstrap.json` appears here without a rebuild. */
  protected readonly themes = this.theme.themes;

  previewVars(t: AppThemeDefinition): Record<string, string> {
    const p = t.preview;
    return {
      '--tp-sidebar': p.sidebar,
      '--tp-surface': p.surface,
      '--tp-header': p.header,
      '--tp-accent': p.accent,
      '--tp-tile': p.tile,
    };
  }
}
