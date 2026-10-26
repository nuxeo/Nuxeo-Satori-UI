import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { SettingsService, type ConnectedAccount } from '@nuxeo/satori-platform/nuxeo-client';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

@Component({
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './cloud-services-page.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './cloud-services-page.component.scss',
})
export class CloudServicesPageComponent {
  private readonly translate = inject(TranslateService);
  private readonly settingsService = inject(SettingsService);

  readonly titleKey = 'settings.cloud-services.title';
  readonly serviceAccounts = signal<ConnectedAccount[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  constructor() {
    this.settingsService
      .getConnectedAccounts()
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (accounts) => {
          this.serviceAccounts.set(accounts);
          this.loading.set(false);
        },
        error: () => {
          this.error.set(this.translate.instant('settings.cloud-services.load-failed'));
          this.loading.set(false);
        },
      });
  }

  sharedLabel(shared: boolean): string {
    return shared ? 'Yes' : 'No';
  }
}
