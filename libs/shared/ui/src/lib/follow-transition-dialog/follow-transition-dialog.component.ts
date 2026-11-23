import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  Injector,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import type { NuxeoAllowedTransition } from '@nuxeo/satori-platform/nuxeo-client';

import { lifecycleLabel } from './lifecycle-labels';

let nextQuestionId = 0;

/** What the dialog offers. */
export interface FollowTransitionDialogData {
  /** The document's title, which the confirmation names. */
  readonly documentTitle: string;
  /** The document's lifecycle state now, or `null` when it has none. */
  readonly state: string | null;
  /** The transitions to offer, in order, as `allowedTransitions` reads them. At least one. */
  readonly transitions: readonly NuxeoAllowedTransition[];
}

/**
 * Change a document's lifecycle state: a button for each transition offered, then a confirmation
 * naming the state the document leaves and the one it enters.
 *
 * With one transition it opens on the confirmation. It closes with the transition the user
 * confirmed, or with nothing; the caller follows it, so the server, not this dialog, decides
 * whether it may be followed.
 */
@Component({
  selector: 'lib-follow-transition-dialog',
  standalone: true,
  imports: [MatButtonModule, MatDialogModule, TranslatePipe],
  templateUrl: './follow-transition-dialog.component.html',
  styleUrl: './follow-transition-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FollowTransitionDialogComponent {
  protected readonly data = inject<FollowTransitionDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef =
    inject<MatDialogRef<FollowTransitionDialogComponent, NuxeoAllowedTransition>>(MatDialogRef);
  private readonly translate = inject(TranslateService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /**
   * What Cancel closes with: nothing. A bare `mat-dialog-close` closes with `''`, which a caller
   * testing for a transition would have to know to refuse.
   */
  protected readonly cancelResult = undefined;

  /** More than one to choose from, so the confirmation can go back to the choice. */
  protected readonly canGoBack = this.data.transitions.length > 1;

  /** The transition waiting for confirmation, or `null` while the user chooses one. */
  protected readonly chosen = signal<NuxeoAllowedTransition | null>(
    this.data.transitions.length === 1 ? this.data.transitions[0] : null,
  );

  protected transitionLabel(name: string): string {
    return lifecycleLabel('transition', name, (key) => this.translate.instant(key));
  }

  protected stateLabel(name: string): string {
    return lifecycleLabel('state', name, (key) => this.translate.instant(key));
  }

  /** The question's id, which the confirm button is described by. */
  protected readonly questionId = `lib-follow-transition-question-${nextQuestionId++}`;

  /** "“Claim 7” moves from Submitted to Approved.", or "moves to" when the document has no state. */
  protected confirmation(transition: NuxeoAllowedTransition): string {
    const title = this.data.documentTitle;
    const to = this.stateLabel(transition.destinationState);
    return this.data.state
      ? this.translate.instant('shared-ui.follow-transition-dialog.confirm-message', {
          title,
          from: this.stateLabel(this.data.state),
          to,
        })
      : this.translate.instant('shared-ui.follow-transition-dialog.confirm-message-to', {
          title,
          to,
        });
  }

  /**
   * The button that was clicked leaves the page with the step, so focus goes to the confirmation's
   * own button rather than to the document body.
   */
  protected choose(transition: NuxeoAllowedTransition): void {
    this.chosen.set(transition);
    this.focusAfterRender((host) =>
      host.querySelector<HTMLElement>('[data-follow-transition-confirm]'),
    );
  }

  /** Back to the choice, with focus on the transition the user had picked. */
  protected back(): void {
    const left = this.chosen();
    this.chosen.set(null);
    if (!left) return;
    this.focusAfterRender((host) =>
      [...host.querySelectorAll<HTMLElement>('[data-transition]')].find(
        (button) => button.dataset['transition'] === left.name,
      ),
    );
  }

  protected confirm(): void {
    const transition = this.chosen();
    if (transition) this.dialogRef.close(transition);
  }

  private focusAfterRender(target: (host: HTMLElement) => HTMLElement | null | undefined): void {
    afterNextRender(() => target(this.host.nativeElement)?.focus(), { injector: this.injector });
  }
}
