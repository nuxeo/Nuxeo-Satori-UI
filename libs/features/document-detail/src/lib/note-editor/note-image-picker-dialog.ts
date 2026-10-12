import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTooltipModule } from '@angular/material/tooltip';
import { catchError, of } from 'rxjs';

import {
  NuxeoDocument,
  SearchService,
  SelectionService,
} from '@nuxeo-satori/platform/nuxeo-client';
import { extractMainBlobFileName } from './note-image-url';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  NxsSpinnerComponent,
  NxsThumbnailComponent,
  provideNxsThumbnailCache,
} from '@nuxeo-satori/platform/components';

@Component({
  selector: 'lib-note-image-picker-dialog',
  standalone: true,
  imports: [
    NxsSpinnerComponent,
    NxsThumbnailComponent,
    TranslatePipe,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatCheckboxModule,
    MatTooltipModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [provideNxsThumbnailCache()],
  templateUrl: './note-image-picker-dialog.html',
  styleUrl: './note-image-picker-dialog.scss',
})
export class NoteImagePickerDialogComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly translate = inject(TranslateService);
  private readonly dialogRef = inject(
    MatDialogRef<NoteImagePickerDialogComponent, NuxeoDocument[]>,
  );
  private readonly searchService = inject(SearchService);
  readonly selectionService = inject(SelectionService);

  private selectionSnapshot: {
    ids: Set<string>;
    labels: Map<string, string>;
    previews: Map<string, string | null>;
    types: Map<string, string>;
  } | null = null;

  readonly searchTerm = signal('');
  readonly loading = signal(false);
  readonly searchError = signal<string | null>(null);
  readonly results = signal<NuxeoDocument[]>([]);
  readonly totalSize = signal(0);
  private readonly selectedDocByUid = signal<Map<string, NuxeoDocument>>(new Map());

  readonly resultsLabel = computed(() => {
    const count = this.totalSize();
    // A key per grammatical number rather than an `(s)` suffix, matching the templates.
    return this.translate.instant(
      count === 1 ? 'common.count.result-one' : 'common.count.result-many',
      { count },
    );
  });

  readonly isAllSelected = computed(() => {
    const uids = this.results().map((doc) => doc.uid);
    return this.selectionService.isAllSelected(uids);
  });

  readonly isIndeterminate = computed(() => {
    const uids = this.results().map((doc) => doc.uid);
    return this.selectionService.isIndeterminate(uids);
  });

  constructor() {
    this.captureSelectionSnapshot();
    this.selectionService.clear();
    this.selectionService.setClearOnlyMode(true);

    this.destroyRef.onDestroy(() => {
      this.selectionService.setClearOnlyMode(false);
      this.restoreSelectionSnapshot();
    });
  }

  ngOnInit(): void {
    this.runSearch('');
  }

  search(): void {
    this.runSearch(this.searchTerm().trim());
  }

  clearSearch(): void {
    this.searchTerm.set('');
    this.runSearch('');
  }

  displayFileName(doc: NuxeoDocument): string {
    return extractMainBlobFileName(doc) ?? doc.title ?? doc.uid;
  }

  isSelected(uid: string): boolean {
    return this.selectionService.isSelected(uid);
  }

  toggleSelection(doc: NuxeoDocument): void {
    this.selectionService.toggle(doc.uid, this.displayFileName(doc), null, doc.type);
    if (this.selectionService.isSelected(doc.uid)) {
      this.rememberSelectedDoc(doc);
    } else {
      this.forgetSelectedDoc(doc.uid);
    }
  }

  toggleSelectAll(): void {
    const visible = this.results();
    if (visible.length === 0) return;

    if (this.isAllSelected()) {
      for (const doc of visible) {
        if (this.selectionService.isSelected(doc.uid)) {
          this.selectionService.toggle(doc.uid);
          this.forgetSelectedDoc(doc.uid);
        }
      }
      return;
    }

    for (const doc of visible) {
      if (!this.selectionService.isSelected(doc.uid)) {
        this.selectionService.toggle(doc.uid, this.displayFileName(doc), null, doc.type);
        this.rememberSelectedDoc(doc);
      }
    }
  }

  confirm(): void {
    const ids = [...this.selectionService.selectedIds()];
    const cached = this.selectedDocByUid();
    const resultsMap = new Map(this.results().map((doc) => [doc.uid, doc]));
    const selected = ids
      .map((uid) => cached.get(uid) ?? resultsMap.get(uid))
      .filter((doc): doc is NuxeoDocument => !!doc);
    this.dialogRef.close(selected);
  }

  private runSearch(fulltext: string): void {
    this.loading.set(true);
    this.searchError.set(null);
    this.searchService
      .searchDocumentPicker({ fulltext, pageSize: 40 })
      .pipe(
        catchError(() => {
          this.searchError.set(
            this.translate.instant('document-detail.message.search-failed-try-again'),
          );
          return of({ entries: [], totalSize: 0, resultsCount: 0 });
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => {
        this.loading.set(false);
        const entries = res.entries ?? [];
        this.results.set(entries);
        this.totalSize.set(res.totalSize ?? res.resultsCount ?? entries.length);
      });
  }

  private rememberSelectedDoc(doc: NuxeoDocument): void {
    this.selectedDocByUid.update((map) => new Map(map).set(doc.uid, doc));
  }

  private forgetSelectedDoc(uid: string): void {
    this.selectedDocByUid.update((map) => {
      const next = new Map(map);
      next.delete(uid);
      return next;
    });
  }

  private captureSelectionSnapshot(): void {
    this.selectionSnapshot = {
      ids: new Set(this.selectionService.selectedIds()),
      labels: new Map(this.selectionService.selectedLabels()),
      previews: new Map(this.selectionService.selectedPreviews()),
      types: new Map(this.selectionService.selectedTypes()),
    };
  }

  private restoreSelectionSnapshot(): void {
    const snapshot = this.selectionSnapshot;
    this.selectionSnapshot = null;
    if (!snapshot) return;

    const ids = [...snapshot.ids];
    if (ids.length === 0) {
      this.selectionService.clear();
      return;
    }

    this.selectionService.selectAll(
      ids,
      Object.fromEntries(snapshot.labels),
      Object.fromEntries(snapshot.previews),
      Object.fromEntries(snapshot.types),
    );
  }
}
