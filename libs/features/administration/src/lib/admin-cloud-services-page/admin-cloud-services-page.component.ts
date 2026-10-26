import { Component, OnInit, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { AdministrationService, NuxeoOAuth2Provider } from '@nuxeo/satori-platform/nuxeo-client';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'lib-admin-cloud-services-page',
  standalone: true,
  imports: [
    TranslatePipe,
    MatTabsModule,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './admin-cloud-services-page.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './admin-cloud-services-page.component.scss',
})
export class AdminCloudServicesPageComponent implements OnInit {
  private readonly adminService = inject(AdministrationService);

  providers = signal<NuxeoOAuth2Provider[]>([]);
  loading = signal(true);

  readonly providerColumns = ['serviceName', 'description', 'enabled'] as const;

  ngOnInit(): void {
    this.refreshProviders();
  }

  refreshProviders(): void {
    this.loading.set(true);
    this.adminService.listOAuth2Providers().subscribe({
      next: (list) => {
        this.providers.set(list);
        this.loading.set(false);
      },
      error: () => {
        this.providers.set([]);
        this.loading.set(false);
      },
    });
  }

  providerName(p: NuxeoOAuth2Provider): string {
    return String(p.serviceName ?? p['serviceName'] ?? p['name'] ?? '—');
  }

  providerDescription(p: NuxeoOAuth2Provider): string {
    return String(p.description ?? p['description'] ?? '—');
  }

  providerEnabled(p: NuxeoOAuth2Provider): boolean {
    const raw = p as Record<string, unknown>;
    return raw['enabled'] === true || raw['isEnabled'] === true;
  }
}
