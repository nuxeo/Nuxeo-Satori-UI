import { Component, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { SettingsService } from '@nuxeo/satori-platform/nuxeo-client';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

function passwordsMatch(control: AbstractControl): ValidationErrors | null {
  const newPwd = control.get('newPassword')?.value;
  const confirm = control.get('confirmPassword')?.value;
  return newPwd && confirm && newPwd !== confirm ? { passwordsMismatch: true } : null;
}

@Component({
  selector: 'app-change-password-dialog',
  standalone: true,
  imports: [
    TranslatePipe,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
  ],
  templateUrl: './change-password-dialog.component.html',
  styleUrl: './change-password-dialog.component.scss',
})
export class ChangePasswordDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<ChangePasswordDialogComponent>);
  private readonly translate = inject(TranslateService);
  private readonly settingsService = inject(SettingsService);
  private readonly fb = inject(FormBuilder);

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly showOld = signal(false);
  readonly showNew = signal(false);
  readonly showConfirm = signal(false);

  readonly form = this.fb.group(
    {
      oldPassword: ['', Validators.required],
      newPassword: ['', [Validators.required, Validators.minLength(4)]],
      confirmPassword: ['', Validators.required],
    },
    { validators: passwordsMatch },
  );

  save(): void {
    if (this.form.invalid || this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    const oldPassword = this.form.value.oldPassword ?? '';
    const newPassword = this.form.value.newPassword ?? '';
    this.settingsService.changePassword(oldPassword, newPassword).subscribe({
      next: () => this.dialogRef.close(true),
      error: () => {
        this.error.set(
          this.translate.instant('app.message.failed-to-change-password-please-check-your'),
        );
        this.saving.set(false);
      },
    });
  }

  cancel(): void {
    this.dialogRef.close(false);
  }
}
