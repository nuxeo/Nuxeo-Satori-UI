import { DestroyRef, Injectable, inject, type Provider } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';

import { NxsToastComponent, type NxsToastData } from './toast.component';

/** How long a toast stays, in milliseconds, unless the caller asks for longer. Web UI's default. */
export const NXS_TOAST_DURATION = 4000;

/** A button on a toast besides Dismiss — "Undo", "View". */
export interface NxsToastAction {
  /** What the button says, already translated. */
  readonly label: string;
  /** Runs when the button is pressed, just before the toast closes. */
  readonly run: () => void;
}

export interface NxsToastOptions {
  /**
   * How long the toast stays, in milliseconds. Anything shorter than `NXS_TOAST_DURATION` is raised
   * to it, and `0` keeps the toast until it is dismissed. Defaults to `NXS_TOAST_DURATION`, or to `0`
   * when the toast carries an action, so a keyboard user has time to reach the button.
   */
  readonly duration?: number;
  /** One button besides Dismiss. */
  readonly action?: NxsToastAction;
}

export interface NxsToastErrorOptions extends NxsToastOptions {
  /** Offers a translated "Retry" button that runs this. Takes the place of `action`. */
  readonly retry?: () => void;
}

/**
 * The one way the core slice tells a user that something happened.
 *
 * Every toast has a Dismiss button and closes on Escape. `show` is announced politely; `error` is
 * announced assertively, because the user is waiting on the action that failed. Messages arrive
 * already translated; only the toast's own buttons are translated here.
 *
 * Not a singleton: it holds no state, so each component lists `provideNxsToast()` in its own
 * `providers`, and Material's `MatSnackBar` underneath keeps one toast on screen at a time.
 */
@Injectable()
export class NxsToastService {
  private readonly snackBar = inject(MatSnackBar);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);

  /** Something happened: saved, copied, moved to trash. */
  show(message: string, options: NxsToastOptions = {}): void {
    this.open({ message, kind: 'info', action: options.action ?? null }, options.duration);
  }

  /** Something the user asked for did not happen. */
  error(message: string, options: NxsToastErrorOptions = {}): void {
    const retry = options.retry;
    const action: NxsToastAction | null = retry
      ? { label: this.translate.instant('satori-components.toast.retry'), run: retry }
      : (options.action ?? null);
    this.open({ message, kind: 'error', action }, options.duration);
  }

  private open(data: NxsToastData, duration: number | undefined): void {
    // A blank toast is a caller's bug, and an empty live region announces nothing. Web UI's
    // notifier opens nothing for an empty message either.
    if (!data.message.trim()) return;
    const ref = this.snackBar.openFromComponent(NxsToastComponent, {
      data,
      duration: toastDuration(duration, data.action !== null),
      politeness: data.kind === 'error' ? 'assertive' : 'polite',
      panelClass:
        data.kind === 'error' ? ['nxs-toast-panel', 'nxs-toast-panel--error'] : 'nxs-toast-panel',
    });
    const action = data.action;
    if (!action) return;
    // A toast with an action stays until dismissed, so it can outlive the component that opened
    // it. It is dismissed with that component rather than left showing a button that would run
    // against a destroyed one.
    const dismissWithOwner = this.destroyRef.onDestroy(() => ref.dismiss());
    ref
      .afterDismissed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => dismissWithOwner());
    ref
      .onAction()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => action.run());
  }
}

/** Exactly `0` means "until dismissed", which is how `MatSnackBar` reads it too. */
function toastDuration(requested: number | undefined, hasAction: boolean): number {
  if (requested === undefined) return hasAction ? 0 : NXS_TOAST_DURATION;
  if (requested === 0) return 0;
  return Math.max(requested, NXS_TOAST_DURATION);
}

/** Lists `NxsToastService` in a component's `providers`. */
export function provideNxsToast(): Provider {
  return NxsToastService;
}
