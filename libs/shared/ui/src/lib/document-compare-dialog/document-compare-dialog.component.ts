import {
  Component,
  LOCALE_ID,
  computed,
  effect,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import {
  DocumentDetailService,
  NuxeoDocument,
  buildDocumentCompareSections,
  isCompareIconField,
  type CompareRow,
} from '@nuxeo/satori-platform/nuxeo-client';
import { CompareIconImageComponent } from './compare-icon-image.component';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { NxsSpinnerComponent } from '@nuxeo/satori-platform/components';

export interface DocumentCompareDialogData {
  items: Array<{ id: string; name: string }>;
}

@Component({
  selector: 'lib-document-compare-dialog',
  standalone: true,
  imports: [
    NxsSpinnerComponent,
    TranslatePipe,
    MatDialogModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatSelectModule,
    MatIconModule,
    MatSlideToggleModule,
    CompareIconImageComponent,
  ],
  templateUrl: './document-compare-dialog.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './document-compare-dialog.scss',
})
export class DocumentCompareDialogComponent {
  private readonly detailService = inject(DocumentDetailService);
  private readonly translate = inject(TranslateService);
  private readonly locale = inject(LOCALE_ID);
  readonly data = inject<DocumentCompareDialogData>(MAT_DIALOG_DATA);

  readonly leftId = signal(this.data.items[0]?.id ?? '');
  readonly rightId = signal(this.data.items[1]?.id ?? this.data.items[0]?.id ?? '');
  readonly viewAllData = signal(false);
  readonly unifiedView = signal(false);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly leftDoc = signal<NuxeoDocument | null>(null);
  readonly rightDoc = signal<NuxeoDocument | null>(null);

  readonly sections = computed(() => {
    const left = this.leftDoc();
    const right = this.rightDoc();
    if (!left || !right) return [];
    return buildDocumentCompareSections(left, right, this.viewAllData(), this.locale);
  });

  isIconRow(row: CompareRow): boolean {
    return isCompareIconField(row.key);
  }

  constructor() {
    effect((onCleanup) => {
      const leftId = this.leftId();
      const rightId = this.rightId();
      if (!leftId || !rightId || leftId === rightId) {
        this.leftDoc.set(null);
        this.rightDoc.set(null);
        this.error.set(
          this.translate.instant('shared-ui.message.select-two-different-documents-to-compare'),
        );
        this.loading.set(false);
        return;
      }

      this.loading.set(true);
      this.error.set(null);
      let cancelled = false;

      const subscription = forkJoin({
        left: this.detailService.getFullDocument(leftId),
        right: this.detailService.getFullDocument(rightId),
      })
        .pipe(
          catchError(() => {
            if (!cancelled) {
              this.error.set(
                this.translate.instant('shared-ui.message.failed-to-load-documents-for-comparison'),
              );
            }
            return of(null);
          }),
        )
        .subscribe((result) => {
          if (cancelled) return;
          this.loading.set(false);
          if (!result) return;
          this.leftDoc.set(result.left);
          this.rightDoc.set(result.right);
        });

      onCleanup(() => {
        cancelled = true;
        subscription.unsubscribe();
      });
    });
  }
}
