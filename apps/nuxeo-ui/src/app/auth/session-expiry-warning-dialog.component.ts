import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';

export interface SessionExpiryWarningDialogData {
  warningMinutes: number;
}

@Component({
  selector: 'app-session-expiry-warning-dialog',
  standalone: true,
  imports: [TranslatePipe, MatDialogModule, MatButtonModule],
  templateUrl: './session-expiry-warning-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './session-expiry-warning-dialog.component.scss',
})
export class SessionExpiryWarningDialogComponent {
  readonly data = inject<SessionExpiryWarningDialogData>(MAT_DIALOG_DATA);
}
