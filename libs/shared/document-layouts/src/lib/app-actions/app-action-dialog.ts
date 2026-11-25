import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { TranslatePipe } from '@ngx-translate/core';
import { NxsBannerComponent } from '@nuxeo/satori-platform/components';
import type { NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';
import type { Observable } from 'rxjs';

import { DocumentLayoutFormComponent } from '../document-layout-form/document-layout-form';
import type { ResolvedFormLayout } from '../form-layout/resolve-form-layout';

let nextQuestionId = 0;

/** How a run ended, as the dialog tells the person. */
export type AppActionOutcome =
  | { readonly kind: 'done' }
  /** It did not run, or the server refused it: the message says why, in the person's words. */
  | { readonly kind: 'failed'; readonly message: string }
  /**
   * No answer came, in time or at all: it may have run on the server. The message says so, and the
   * dialog runs nothing more, so that an operation that is not safe to repeat is not sent twice.
   */
  | { readonly kind: 'unknown'; readonly message: string };

export interface AppActionDialogData {
  /** The action's name: the dialog's title, and its run button. */
  readonly title: string;
  /** The confirmation: the action's own question, or the platform's naming the record. */
  readonly question: string;
  /** The record it runs on: what the form shows and its rules read. */
  readonly document: NuxeoDocument;
  /** The action's form, or `null` when it asks for nothing. */
  readonly form: ResolvedFormLayout | null;
  /** Runs it with what was entered: each form field's value by its name, `var:` left off. */
  readonly run: (values: Readonly<Record<string, unknown>>) => Observable<AppActionOutcome>;
}

/**
 * One operation button's confirmation step: the action's question, its form when it has one, and
 * the button that runs it. It runs only once the form's own checks pass, says while it runs, and
 * closes with `'done'` when the run has; a failure stays on screen, with the form as it was, so
 * that the person may correct a value or cancel. When no answer comes, the run may have happened:
 * the dialog says so and offers Cancel alone. Cancel closes with nothing, and runs nothing.
 *
 * Nothing here is a security control: the server checks the allow-list and the person's
 * permissions again, whatever the dialog let through.
 */
@Component({
  selector: 'lib-app-action-dialog',
  standalone: true,
  imports: [
    DocumentLayoutFormComponent,
    MatButtonModule,
    MatDialogModule,
    NxsBannerComponent,
    TranslatePipe,
  ],
  templateUrl: './app-action-dialog.html',
  styleUrl: './app-action-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppActionDialogComponent {
  protected readonly data = inject<AppActionDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<AppActionDialogComponent, 'done'>>(MatDialogRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly form = viewChild(DocumentLayoutFormComponent);

  /** The question's id, which the run button is described by. */
  protected readonly questionId = `lib-app-action-question-${nextQuestionId++}`;

  /** What Cancel closes with: nothing. A bare `mat-dialog-close` would close with `''`. */
  protected readonly cancelResult = undefined;

  protected readonly running = signal(false);
  protected readonly failure = signal<string | null>(null);
  /** No answer came: it may have run, so it is not offered again. */
  protected readonly unanswered = signal(false);

  protected confirm(): void {
    if (this.running() || this.unanswered()) return;
    const form = this.form();
    if (this.data.form && (!form || !form.validate())) return;
    const values = form?.taskVariables() ?? {};
    this.failure.set(null);
    this.running.set(true);
    this.dialogRef.disableClose = true;
    this.data
      .run(values)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((outcome) => {
        this.running.set(false);
        this.dialogRef.disableClose = false;
        if (outcome.kind === 'done') this.dialogRef.close('done');
        else {
          if (outcome.kind === 'unknown') this.unanswered.set(true);
          this.failure.set(outcome.message);
        }
      });
  }
}
