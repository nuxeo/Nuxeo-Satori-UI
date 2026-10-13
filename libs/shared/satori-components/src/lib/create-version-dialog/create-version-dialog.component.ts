import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatRadioModule } from '@angular/material/radio';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  DocumentDetailService,
  isPermissionDeniedError,
  type NuxeoDocument,
} from '@nuxeo-satori/platform/nuxeo-client';

import { NxsSpinnerComponent } from '../spinner/spinner.component';
import { NxsToastService, provideNxsToast } from '../toast/toast.service';

/** What `nxs-create-version-dialog` versions. */
export interface NxsCreateVersionDialogData {
  readonly documentUid: string;
  readonly documentTitle: string;
  /** The document's version now — `uid:major_version` and `uid:minor_version`. */
  readonly major: number;
  readonly minor: number;
}

/** Closes with the version created, or with nothing when cancelled. */
export type NxsCreateVersionDialogResult = NuxeoDocument | undefined;

/**
 * Create a version of a document — Web UI's `nuxeo-document-create-version` dialog.
 *
 * As in Web UI: Minor and Major are offered with the number each would give, Major chosen first,
 * and Create runs `Document.CreateVersion`, which checks the document in at the new version. A toast
 * names the version created; a refusal reads as one. It does not decide who may version — open it
 * only where `canCreateDocumentVersion(doc)` holds, as `nxs-manage-versions` does.
 */
@Component({
  selector: 'nxs-create-version-dialog',
  standalone: true,
  templateUrl: './create-version-dialog.component.html',
  styleUrl: './create-version-dialog.component.scss',
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatRadioModule,
    TranslatePipe,
    NxsSpinnerComponent,
  ],
  providers: [provideNxsToast()],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NxsCreateVersionDialogComponent {
  protected readonly data = inject<NxsCreateVersionDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef =
    inject<MatDialogRef<NxsCreateVersionDialogComponent, NxsCreateVersionDialogResult>>(
      MatDialogRef,
    );
  private readonly documents = inject(DocumentDetailService);
  private readonly translate = inject(TranslateService);
  private readonly toast = inject(NxsToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected increment: 'Major' | 'Minor' = 'Major';
  protected readonly saving = signal(false);

  protected readonly current = `${this.data.major}.${this.data.minor}`;
  protected readonly nextMinor = `${this.data.major}.${this.data.minor + 1}`;
  protected readonly nextMajor = `${this.data.major + 1}.0`;

  protected create(): void {
    if (this.saving()) return;
    this.saving.set(true);
    const label = this.increment === 'Major' ? this.nextMajor : this.nextMinor;
    this.documents
      .createVersion(this.data.documentUid, this.increment)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (version) => {
          this.saving.set(false);
          this.toast.show(
            this.translate.instant('satori-components.create-version-dialog.created', {
              version: label,
            }),
          );
          this.dialogRef.close(version);
        },
        error: (err: unknown) => {
          this.saving.set(false);
          this.toast.error(
            this.translate.instant(
              isPermissionDeniedError(err)
                ? 'satori-components.create-version-dialog.forbidden'
                : 'satori-components.create-version-dialog.failed',
            ),
          );
        },
      });
  }
}
