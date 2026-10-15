import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatExpansionModule } from '@angular/material/expansion';

import {
  AdministrationService,
  NuxeoDocument,
  DocTypeLabelPipe,
} from '@nuxeo/satori-platform/nuxeo-client';
import {
  AiGatewayService,
  AiFeatureFlagService,
  aiErrorMessage,
} from '@agentic-ui/shared/ai-client';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

const DEFAULT_NXQL =
  "SELECT * FROM Document WHERE ecm:mixinType != 'HiddenInNavigation' AND ecm:isProxy = 0 " +
  'AND ecm:isVersion = 0 AND ecm:isTrashed = 0';

@Component({
  selector: 'lib-admin-nxql-search-page',
  standalone: true,
  imports: [
    DocTypeLabelPipe,
    TranslatePipe,
    DatePipe,
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatTableModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatExpansionModule,
  ],
  templateUrl: './admin-nxql-search-page.component.html',
  styleUrl: './admin-nxql-search-page.component.scss',
})
export class AdminNxqlSearchPageComponent {
  private readonly adminService = inject(AdministrationService);
  private readonly translate = inject(TranslateService);
  private readonly aiGateway = inject(AiGatewayService);
  readonly featureFlags = inject(AiFeatureFlagService);

  queryText = DEFAULT_NXQL;
  aiNlQuery = '';
  aiGenerating = signal(false);
  aiGenError = signal<string | null>(null);
  results = signal<NuxeoDocument[]>([]);
  totalSize = signal(0);
  loading = signal(false);
  error = signal<string | null>(null);

  readonly columns = ['path', 'type', 'size', 'modified', 'contributor'] as const;

  runSearch(): void {
    this.loading.set(true);
    this.error.set(null);
    this.adminService.nxqlSearch(this.queryText.trim(), 100, 0).subscribe({
      next: (list) => {
        this.results.set(list.entries ?? []);
        this.totalSize.set(list.totalSize ?? list.entries?.length ?? 0);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.message ?? this.translate.instant('admin.message.query-failed'));
        this.results.set([]);
        this.totalSize.set(0);
        this.loading.set(false);
      },
    });
  }

  clear(): void {
    this.queryText = DEFAULT_NXQL;
  }

  formatSize(doc: NuxeoDocument): string {
    const fc = doc.properties?.['file:content'] as { length?: string } | undefined;
    if (!fc?.length) return '—';
    const n = Number(fc.length);
    if (Number.isNaN(n)) return String(fc.length);
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(2)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  }

  lastContributor(doc: NuxeoDocument): string {
    const p = doc.properties ?? {};
    return String(p['dc:lastContributor'] ?? p['dc:creator'] ?? '—');
  }

  onKeydown(ev: KeyboardEvent): void {
    if (ev.ctrlKey && ev.key === 'Enter') {
      ev.preventDefault();
      this.runSearch();
    }
  }

  generateFromNl(): void {
    const q = this.aiNlQuery.trim();
    if (!q) return;
    this.aiGenerating.set(true);
    this.aiGenError.set(null);
    this.aiGateway.nlToNxql(q).subscribe({
      next: (res) => {
        this.queryText = res.nxql;
        this.aiGenerating.set(false);
      },
      error: (err) => {
        this.aiGenError.set(
          aiErrorMessage(err, this.translate.instant('admin.message.ai-generation-failed')),
        );
        this.aiGenerating.set(false);
      },
    });
  }
}
