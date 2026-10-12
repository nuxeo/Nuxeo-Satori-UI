import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import {
  MAT_SNACK_BAR_DATA,
  MatSnackBarAction,
  MatSnackBarActions,
  MatSnackBarLabel,
  MatSnackBarRef,
} from '@angular/material/snack-bar';
import { TranslatePipe } from '@ngx-translate/core';

import type { NxsToastAction } from './toast.service';

/** What `NxsToastService` hands the toast it opens. */
export interface NxsToastData {
  readonly message: string;
  readonly kind: 'info' | 'error';
  readonly action: NxsToastAction | null;
}

/**
 * The content of one toast: the message, an optional action and a Dismiss button.
 *
 * Opened by `NxsToastService`, never placed in a template. `MatSnackBar` moves this content into
 * its live region after it opens, so the message is announced with the politeness the service chose.
 */
@Component({
  selector: 'nxs-toast',
  standalone: true,
  templateUrl: './toast.component.html',
  styleUrl: './toast.component.scss',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatSnackBarAction,
    MatSnackBarActions,
    MatSnackBarLabel,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'nxs-toast',
    '[class.nxs-toast--error]': "data.kind === 'error'",
    '(keydown.escape)': 'dismiss($event)',
  },
})
export class NxsToastComponent {
  protected readonly data = inject<NxsToastData>(MAT_SNACK_BAR_DATA);
  private readonly ref = inject<MatSnackBarRef<NxsToastComponent>>(MatSnackBarRef);

  protected act(): void {
    this.ref.dismissWithAction();
  }

  /**
   * Escape stops here: a snack-bar overlay subscribes to no keydown, so the CDK would hand the event
   * on to a dialog underneath and close it too — losing a form the toast was reporting on.
   */
  protected dismiss(event?: Event): void {
    event?.stopPropagation();
    this.ref.dismiss();
  }
}
