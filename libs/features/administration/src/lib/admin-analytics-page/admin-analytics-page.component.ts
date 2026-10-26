import { DatePipe, UpperCasePipe } from '@angular/common';
import { Component, OnInit, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { forkJoin } from 'rxjs';
import {
  AdministrationService,
  type NuxeoDocument,
  DocTypeLabelPipe,
} from '@nuxeo/satori-platform/nuxeo-client';
import {
  AiGatewayService,
  AiFeatureFlagService,
  type AuditAnomaly,
} from '@agentic-ui/shared/ai-client';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
function escapeNxqlLiteral(s: string): string {
  return s.replace(/'/g, "''");
}

@Component({
  selector: 'lib-admin-analytics-page',
  standalone: true,
  imports: [
    DocTypeLabelPipe,
    TranslatePipe,
    DatePipe,
    UpperCasePipe,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatTabsModule,
    MatTableModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './admin-analytics-page.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './admin-analytics-page.component.scss',
})
export class AdminAnalyticsPageComponent implements OnInit {
  private readonly adminApi = inject(AdministrationService);
  private readonly translate = inject(TranslateService);
  private readonly aiGateway = inject(AiGatewayService);
  readonly featureFlags = inject(AiFeatureFlagService);

  readonly distPath = signal('/default-domain/');
  readonly repoPath = signal('/default-domain/');
  readonly distLoading = signal(false);
  readonly repoLoading = signal(false);
  readonly wfLoading = signal(false);

  readonly distributionWarning = signal(false);
  readonly totalUnderPath = signal<number | null>(null);
  readonly typeRows = signal<{ type: string; count: number }[]>([]);

  readonly repoDocs = signal<NuxeoDocument[]>([]);
  readonly repoTotal = signal(0);
  readonly searchMetricTotal = signal<number | null>(null);
  readonly wfTotal = signal<number | null>(null);

  readonly repoColumns = ['path', 'type', 'modified'] as const;

  readonly aiAnomalies = signal<AuditAnomaly[]>([]);
  readonly aiAnomalySummary = signal('');
  readonly aiAnomalyLoading = signal(false);
  readonly aiAnomalyTimeRange = signal<'24h' | '7d' | '30d'>('24h');

  private readonly primaryTypes = ['Folder', 'File', 'Note', 'Picture', 'Workspace', 'Collection'];

  ngOnInit(): void {
    this.adminApi.getDefaultDomainPath().subscribe({
      next: (p) => {
        const prefix = p.endsWith('/') ? p : `${p}/`;
        this.distPath.set(prefix);
        this.repoPath.set(prefix);
        this.refreshDistribution();
        this.refreshRepositorySample();
        this.refreshSearchMetric();
        this.refreshWorkflow();
      },
      error: () => {
        this.refreshDistribution();
        this.refreshRepositorySample();
        this.refreshSearchMetric();
        this.refreshWorkflow();
      },
    });
  }

  refreshDistribution(): void {
    const raw = this.distPath().trim() || '/default-domain/';
    const path = raw.endsWith('/') ? raw : `${raw}/`;
    this.distPath.set(path);
    const p = escapeNxqlLiteral(path);
    const base = `ecm:path STARTSWITH '${p}' AND ecm:isVersion = 0 AND ecm:isTrashed = 0 AND ecm:mixinType != 'HiddenInNavigation'`;

    const warn = path === '/default-domain/' || path === '/default-domain';
    this.distributionWarning.set(warn);
    if (warn) {
      this.totalUnderPath.set(null);
      this.typeRows.set([]);
      return;
    }

    this.distLoading.set(true);
    const totalQ = `SELECT * FROM Document WHERE ${base}`;
    const countObs = [
      this.adminApi.getNxqlTotalSize(totalQ),
      ...this.primaryTypes.map((t) =>
        this.adminApi.getNxqlTotalSize(
          `SELECT * FROM Document WHERE ${base} AND ecm:primaryType = '${t}'`,
        ),
      ),
    ];

    forkJoin(countObs).subscribe({
      next: (nums) => {
        const [total, ...counts] = nums;
        this.totalUnderPath.set(total);
        this.typeRows.set(this.primaryTypes.map((type, i) => ({ type, count: counts[i] ?? 0 })));
        this.distLoading.set(false);
      },
      error: () => {
        this.distLoading.set(false);
        this.totalUnderPath.set(null);
        this.typeRows.set([]);
      },
    });
  }

  refreshRepositorySample(): void {
    const raw = this.repoPath().trim() || '/default-domain/';
    const path = raw.endsWith('/') ? raw : `${raw}/`;
    this.repoPath.set(path);
    const p = escapeNxqlLiteral(path);
    const q =
      `SELECT * FROM Document WHERE ecm:path STARTSWITH '${p}' AND ecm:isVersion = 0 ` +
      `AND ecm:isTrashed = 0 ORDER BY dc:modified DESC`;
    this.repoLoading.set(true);
    this.adminApi.nxqlSearch(q, 25, 0).subscribe({
      next: (list) => {
        this.repoDocs.set(list.entries ?? []);
        this.repoTotal.set(list.totalSize ?? list.entries?.length ?? 0);
        this.repoLoading.set(false);
      },
      error: () => {
        this.repoDocs.set([]);
        this.repoTotal.set(0);
        this.repoLoading.set(false);
      },
    });
  }

  refreshSearchMetric(): void {
    const q =
      `SELECT * FROM Document WHERE ecm:mixinType != 'HiddenInNavigation' AND ecm:isProxy = 0 ` +
      `AND ecm:isVersion = 0 AND ecm:isTrashed = 0`;
    this.adminApi.getNxqlTotalSize(q).subscribe({
      next: (n) => this.searchMetricTotal.set(n),
      error: () => this.searchMetricTotal.set(null),
    });
  }

  runAnomalyDetection(): void {
    this.aiAnomalyLoading.set(true);
    this.aiGateway.detectAnomalies(this.aiAnomalyTimeRange()).subscribe({
      next: (res) => {
        this.aiAnomalies.set(res.anomalies);
        this.aiAnomalySummary.set(res.summary);
        this.aiAnomalyLoading.set(false);
      },
      error: () => {
        this.aiAnomalies.set([]);
        this.aiAnomalySummary.set(
          this.translate.instant('admin.message.failed-to-detect-anomalies'),
        );
        this.aiAnomalyLoading.set(false);
      },
    });
  }

  severityColor(severity: string): string {
    return severity === 'high' ? '#d32f2f' : severity === 'medium' ? '#ed6c02' : '#2e7d32';
  }

  refreshWorkflow(): void {
    const q = `SELECT * FROM Document WHERE ecm:primaryType IN ('DocumentRoute', 'Route', 'RoutingTask')`;
    this.wfLoading.set(true);
    this.adminApi.getNxqlTotalSize(q).subscribe({
      next: (n) => {
        this.wfTotal.set(n);
        this.wfLoading.set(false);
      },
      error: () => {
        this.wfTotal.set(null);
        this.wfLoading.set(false);
      },
    });
  }
}
