import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';

import {
  AdministrationService,
  AuditEntry,
  DirectoryEntry,
  DirectoryService,
} from '@nuxeo-satori/platform/nuxeo-client';
import {
  AiGatewayService,
  AiFeatureFlagService,
  AuditAnomaly,
  AuditSummaryResponse,
  AuditFilterResponse,
} from '@agentic-ui/shared/ai-client';
import { TranslatePipe } from '@ngx-translate/core';
import { provideSatoriDateAdapter, provideTranslatedDatepickerIntl } from '@nuxeo-satori/platform/ui';

@Component({
  selector: 'lib-admin-audit-page',
  standalone: true,
  providers: [provideSatoriDateAdapter(), provideTranslatedDatepickerIntl()],
  imports: [
    TranslatePipe,
    DatePipe,
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatTableModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
  ],
  templateUrl: './admin-audit-page.component.html',
  styleUrl: './admin-audit-page.component.scss',
})
export class AdminAuditPageComponent implements OnInit {
  private readonly adminService = inject(AdministrationService);
  private readonly directoryService = inject(DirectoryService);
  private readonly aiGateway = inject(AiGatewayService);
  readonly featureFlags = inject(AiFeatureFlagService);

  readonly columns = ['action', 'date', 'username', 'category', 'document', 'comment'] as const;

  entries = signal<AuditEntry[]>([]);
  totalSize = signal(0);
  loading = signal(false);
  pageIndex = signal(0);
  readonly pageSize = 50;

  principalName = '';
  fromDate: Date | null = null;
  toDate: Date | null = null;
  eventAction = '';
  eventCategory = '';

  eventTypes = signal<DirectoryEntry[]>([]);
  eventCategories = signal<DirectoryEntry[]>([]);

  /* --- AI Anomaly Detection --- */
  anomalies = signal<AuditAnomaly[]>([]);
  anomalySummary = signal('');
  anomalyLoading = signal(false);
  anomalyDismissed = signal(false);
  highSeverityCount = computed(() => this.anomalies().filter((a) => a.severity === 'high').length);

  /* --- AI Natural-Language Search --- */
  nlQuery = '';
  nlLoading = signal(false);
  nlExplanation = signal('');

  /* --- AI Summarization --- */
  auditSummary = signal<AuditSummaryResponse | null>(null);
  summaryLoading = signal(false);
  summaryOpen = signal(false);

  ngOnInit(): void {
    this.directoryService.getEventTypes().subscribe((e) => this.eventTypes.set(e));
    this.directoryService.getEventCategories().subscribe((e) => this.eventCategories.set(e));
    this.load();
    this.loadAnomalies();
  }

  load(): void {
    this.loading.set(true);
    const from = this.fromDate ? this.fromDate.toISOString() : null;
    const to = this.toDate ? this.toDate.toISOString() : null;
    const eventIds = this.eventAction ? [this.eventAction] : undefined;
    this.adminService
      .searchAuditLogs({
        pageSize: this.pageSize,
        currentPageIndex: this.pageIndex(),
        principalName: this.principalName.trim() || undefined,
        from,
        to,
        eventIds,
        category: this.eventCategory || undefined,
      })
      .subscribe({
        next: (list) => {
          this.entries.set((list.entries ?? []) as AuditEntry[]);
          this.totalSize.set(list.totalSize ?? list.entries?.length ?? 0);
          this.loading.set(false);
        },
        error: () => {
          this.entries.set([]);
          this.totalSize.set(0);
          this.loading.set(false);
        },
      });
  }

  applyFilters(): void {
    this.pageIndex.set(0);
    this.load();
  }

  nextPage(): void {
    this.pageIndex.update((i) => i + 1);
    this.load();
  }

  prevPage(): void {
    this.pageIndex.update((i) => Math.max(0, i - 1));
    this.load();
  }

  actionLabel(e: AuditEntry): string {
    return e.eventId?.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()) ?? '—';
  }

  /* --- AI: Anomaly Detection --- */
  loadAnomalies(): void {
    this.anomalyLoading.set(true);
    this.aiGateway.detectAnomalies('24h').subscribe({
      next: (res) => {
        this.anomalies.set(res.anomalies ?? []);
        this.anomalySummary.set(res.summary ?? '');
        this.anomalyLoading.set(false);
      },
      error: () => this.anomalyLoading.set(false),
    });
  }

  dismissAnomalies(): void {
    this.anomalyDismissed.set(true);
  }

  severityIcon(sev: string): string {
    return sev === 'high' ? 'error' : sev === 'medium' ? 'warning' : 'info';
  }

  /* --- AI: Natural-Language Search --- */
  onNlSearch(): void {
    if (!this.nlQuery.trim()) return;
    this.nlLoading.set(true);
    this.nlExplanation.set('');
    this.aiGateway.auditNlFilter(this.nlQuery.trim()).subscribe({
      next: (res: AuditFilterResponse) => {
        this.applyAiFilter(res);
        this.nlExplanation.set(res.explanation || '');
        this.nlLoading.set(false);
      },
      error: () => this.nlLoading.set(false),
    });
  }

  private applyAiFilter(f: AuditFilterResponse): void {
    if (f.principalName) this.principalName = f.principalName;
    if (f.eventId) this.eventAction = f.eventId;
    if (f.category) this.eventCategory = f.category;
    if (f.from) this.fromDate = new Date(f.from);
    if (f.to) this.toDate = new Date(f.to);
    this.applyFilters();
  }

  clearNlSearch(): void {
    this.nlQuery = '';
    this.nlExplanation.set('');
    this.principalName = '';
    this.eventAction = '';
    this.eventCategory = '';
    this.fromDate = null;
    this.toDate = null;
    this.applyFilters();
  }

  /* --- AI: Summarize --- */
  summarizeEntries(): void {
    const raw = this.entries();
    if (!raw.length) return;
    this.summaryLoading.set(true);
    this.summaryOpen.set(true);
    this.aiGateway.auditSummarize(raw as unknown[]).subscribe({
      next: (res) => {
        this.auditSummary.set(res);
        this.summaryLoading.set(false);
      },
      error: () => {
        this.auditSummary.set(null);
        this.summaryLoading.set(false);
      },
    });
  }

  closeSummary(): void {
    this.summaryOpen.set(false);
  }

  summaryStatIcon(icon: string): string {
    const map: Record<string, string> = {
      edit: 'edit',
      delete: 'delete',
      security: 'shield',
      login: 'login',
      download: 'download',
      workflow: 'account_tree',
      info: 'info',
    };
    return map[icon] || 'info';
  }
}
