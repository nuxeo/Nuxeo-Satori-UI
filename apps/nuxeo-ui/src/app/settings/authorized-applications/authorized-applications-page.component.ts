import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { SettingsService, type AuthorizedApplication } from '@nuxeo/satori-platform/nuxeo-client';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

@Component({
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './authorized-applications-page.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './authorized-applications-page.component.scss',
})
export class AuthorizedApplicationsPageComponent {
  private readonly translate = inject(TranslateService);
  private readonly settingsService = inject(SettingsService);

  readonly applications = signal<AuthorizedApplication[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  constructor() {
    this.settingsService
      .getAuthorizedApplications()
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (applications) => {
          this.applications.set(applications);
          this.loading.set(false);
        },
        error: () => {
          this.error.set(this.translate.instant('settings.authorized-applications.load-failed'));
          this.loading.set(false);
        },
      });
  }
}
