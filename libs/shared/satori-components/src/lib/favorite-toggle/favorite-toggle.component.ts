import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';

import { DocumentDetailService } from '@nuxeo-satori/platform/nuxeo-client';

import { nxsToggleFavorite } from './toggle-favorite';

/**
 * The star that adds a document to the user's favorites or removes it — Web UI's
 * `nuxeo-favorites-toggle-button`.
 *
 * A toggle button: its accessible name stays "Favorite" and `aria-pressed` carries the state, while
 * the tooltip says what a press will do. It runs the operation itself and reports the outcome, so
 * the host decides what to tell the user — Web UI's application, not its button, shows the toast.
 * A click does not reach the row or card it sits in.
 */
@Component({
  selector: 'nxs-favorite-toggle',
  standalone: true,
  templateUrl: './favorite-toggle.component.html',
  styleUrl: './favorite-toggle.component.scss',
  imports: [MatButtonModule, MatIconModule, MatTooltipModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-favorite-toggle' },
})
export class NxsFavoriteToggleComponent {
  /** The document to add or remove. */
  readonly documentId = input.required<string>();
  /** Whether it is a favorite now. Two-way: the toggle updates it once the server confirms. */
  readonly favorite = model(false);
  /** Shown but not pressable — an enabled rule said no. */
  readonly disabled = input(false);
  /** The server confirmed the change; carries the new state. */
  readonly changed = output<boolean>();
  /** The server refused; `favorite` is unchanged. Carries the error. */
  readonly failed = output<unknown>();

  /**
   * A request is in flight for the document shown. The button stays focusable and ignores presses
   * until it answers; bound to another document, it is free again.
   */
  protected readonly busy = computed(() => this.pending() === this.documentId());

  /** The document a request is in flight for. */
  private readonly pending = signal<string | null>(null);

  private readonly documents = inject(DocumentDetailService);
  private readonly destroyRef = inject(DestroyRef);

  /** Adds or removes the document. Ignored while disabled or while a request is in flight. */
  toggle(): void {
    const documentId = this.documentId();
    if (!documentId || this.disabled() || this.busy()) return;
    this.pending.set(documentId);
    nxsToggleFavorite(this.documents, documentId, this.favorite())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (favorite) =>
          this.settle(documentId, () => {
            this.favorite.set(favorite);
            this.changed.emit(favorite);
          }),
        error: (error: unknown) => this.settle(documentId, () => this.failed.emit(error)),
      });
  }

  /** Ends the request for `documentId`, and reports it only if that is still the document bound. */
  private settle(documentId: string, report: () => void): void {
    if (this.pending() === documentId) this.pending.set(null);
    if (documentId === this.documentId()) report();
  }

  protected press(event: Event): void {
    event.stopPropagation();
    this.toggle();
  }
}
