import { COMMA, ENTER } from '@angular/cdk/keycodes';
import { Component, DestroyRef, OnDestroy, OnInit, ViewChild, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import {
  MatAutocompleteModule,
  MatAutocompleteSelectedEvent,
} from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatChipInput, MatChipsModule, MatChipInputEvent } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { debounceTime, distinctUntilChanged, finalize, Subject, switchMap } from 'rxjs';

import { NuxeoUser, UserService } from '@nuxeo/satori-platform/nuxeo-client';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

export interface UserFormDialogData {
  mode: 'create' | 'edit';
  user?: NuxeoUser;
}

export interface UserFormDialogResult {
  mode: 'create' | 'edit';
  username: string;
  firstName: string;
  lastName: string;
  company: string;
  email: string;
  password?: string;
  groups: string[];
  /** Set after successful create when User.Invite was used (no admin-set password). */
  invited?: boolean;
  /** When creating, submit again with a fresh dialog (Nuxeo Web UI parity for bulk entry). */
  createAnother?: boolean;
}

@Component({
  selector: 'lib-user-form-dialog',
  standalone: true,
  imports: [
    TranslatePipe,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatChipsModule,
    MatAutocompleteModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSlideToggleModule,
    MatSnackBarModule,
  ],
  templateUrl: './user-form-dialog.component.html',
  styles: [
    `
      :host {
        display: block;
      }
      .dialog-title {
        padding: 0 1.5rem 0.75rem;
        margin: 0;
        font-size: 1.25rem;
        font-weight: 500;
        line-height: 1.4;
      }
      .form {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        min-width: 420px;
        min-height: 420px;
        max-height: 70vh;
        padding-top: 2.75rem;
        padding-bottom: 0.5rem;
        overflow-x: hidden;
      }
      .first-field {
        margin-top: 0.25rem;
      }
      .password-toggle {
        margin: 0.5rem 0 0.15rem;
      }
      .full {
        width: 100%;
      }
      .dialog-actions {
        gap: 0.5rem;
        padding: 0.75rem 1.5rem 1.25rem;
      }
      .spinner-wrap {
        display: flex;
        justify-content: center;
        padding: 0.75rem 0 1rem;
      }
      .dialog-shell {
        position: relative;
        min-height: 100%;
      }
      .dialog-busy {
        position: absolute;
        inset: 0;
        z-index: 2;
        display: flex;
        align-items: center;
        justify-content: center;
        background: color-mix(in srgb, var(--mat-sys-surface, #fff) 75%, transparent);
      }
      @media (max-width: 640px) {
        .form {
          min-width: 0;
        }
      }
    `,
  ],
})
export class UserFormDialogComponent implements OnInit, OnDestroy {
  private readonly dialogRef = inject(
    MatDialogRef<UserFormDialogComponent, UserFormDialogResult | undefined>,
  );
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);
  readonly data = inject<UserFormDialogData>(MAT_DIALOG_DATA);
  private readonly userService = inject(UserService);
  private readonly snackBar = inject(MatSnackBar);

  username = '';
  firstName = '';
  lastName = '';
  company = '';
  email = '';
  setUserPassword = false;
  password = '';
  confirmPassword = '';
  readonly separatorKeysCodes: number[] = [ENTER, COMMA];
  groups: string[] = [];
  groupOptions: { groupname: string; grouplabel: string }[] = [];
  groupSearchQuery = '';
  loadingGroupOptions = false;
  loadingGroups = true;
  readonly saving = signal(false);
  private readonly groupSearchTerms = new Subject<string>();
  /** Suppresses matChipInputTokenEnd after autocomplete selection (NXSAT-151). */
  private skipNextChipInput = false;

  @ViewChild(MatChipInput) private groupChipInput?: MatChipInput;

  ngOnInit(): void {
    const u = this.data.user;
    if (this.data.mode === 'edit' && u) {
      this.username = u.id;
      this.firstName = u.properties.firstName ?? '';
      this.lastName = u.properties.lastName ?? '';
      this.company = u.properties.company ?? '';
      this.email = u.properties.email ?? '';
      this.groups = [...(u.properties.groups ?? [])];
    }
    this.userService
      .searchGroupsPaged('*', 200, 0)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.groupOptions = (res.entries ?? []).map((g) => ({
            groupname: g.groupname,
            grouplabel: g.grouplabel || g.groupname,
          }));
          this.loadingGroups = false;
        },
        error: () => {
          this.loadingGroups = false;
        },
      });

    this.groupSearchTerms
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((q) => {
          this.loadingGroupOptions = true;
          return this.userService.searchGroupsPaged(q || '*', 30, 0);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (res) => {
          const selected = new Set(this.groups);
          this.groupOptions = (res.entries ?? [])
            .filter((g) => g.groupname && !selected.has(g.groupname))
            .map((g) => ({
              groupname: g.groupname,
              grouplabel: g.grouplabel || g.groupname,
            }));
          this.loadingGroupOptions = false;
        },
        error: () => {
          this.groupOptions = [];
          this.loadingGroupOptions = false;
        },
      });
  }

  ngOnDestroy(): void {
    this.groupSearchTerms.complete();
  }

  onGroupSearch(q: string): void {
    this.groupSearchQuery = q;
    this.groupSearchTerms.next(q?.trim() ?? '');
  }

  onGroupInputFocus(): void {
    this.groupSearchTerms.next(this.groupSearchQuery?.trim() || '*');
  }

  onGroupInputKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') {
      return;
    }
    const typed = this.groupSearchQuery.trim();
    if (!typed) {
      return;
    }

    if (this.groupOptions.length > 0) {
      // Enter should select from autocomplete search results, not commit typed text as a chip.
      this.skipNextChipInput = true;
    }
  }

  onGroupSelected(event: MatAutocompleteSelectedEvent): void {
    this.skipNextChipInput = true;
    const groupname = (event.option.value as string)?.trim();
    if (groupname) {
      // Autocomplete can emit matChipInputTokenEnd first with a partial prefix chip.
      this.groups = this.groups.filter((g) => g === groupname || !groupname.startsWith(g));
      if (!this.groups.includes(groupname)) {
        this.groups = [...this.groups, groupname];
      }
    }
    this.clearGroupSearch();
    event.option.deselect();
  }

  addGroupFromInput(event: MatChipInputEvent): void {
    if (this.skipNextChipInput) {
      this.skipNextChipInput = false;
      event.chipInput.clear();
      this.clearGroupSearch();
      return;
    }
    const raw = (event.value ?? '').trim();
    if (!raw) {
      event.chipInput.clear();
      return;
    }

    const resolved = this.resolveGroupFromChipInput(raw);
    if (resolved === null) {
      event.chipInput.clear();
      this.clearGroupSearch();
      return;
    }
    if (resolved && !this.groups.includes(resolved)) {
      this.groups = [...this.groups, resolved];
    }
    event.chipInput.clear();
    this.clearGroupSearch();
  }

  private resolveGroupFromChipInput(raw: string): string | null {
    const typed = this.groupSearchQuery.trim();

    if (typed && raw === typed && this.isIncompleteGroupPrefix(raw)) {
      return null;
    }

    if (typed && raw.startsWith(typed) && raw.length > typed.length) {
      const suffix = raw.slice(typed.length);
      const optionMatch = this.groupOptions.find((g) => g.groupname === suffix);
      if (optionMatch) {
        return optionMatch.groupname;
      }
    }

    if (this.isIncompleteGroupPrefix(raw)) {
      return null;
    }

    const exactOption = this.groupOptions.find((g) => g.groupname === raw);
    if (exactOption) {
      return exactOption.groupname;
    }

    return raw;
  }

  /** True when `value` is only a typed prefix of a known group (not a full name). */
  private isIncompleteGroupPrefix(value: string): boolean {
    if (this.groupOptions.some((g) => g.groupname === value)) {
      return false;
    }
    return this.groupOptions.some((g) => g.groupname.startsWith(value) && g.groupname !== value);
  }

  removeGroup(groupname: string): void {
    this.groups = this.groups.filter((g) => g !== groupname);
    this.groupSearchTerms.next(this.groupSearchQuery?.trim() || '*');
  }

  private clearGroupSearch(): void {
    this.groupSearchQuery = '';
    this.groupOptions = [];
    this.groupSearchTerms.next('');
    this.groupChipInput?.clear();
  }

  get canSave(): boolean {
    if (this.loadingGroups || this.saving()) {
      return false;
    }
    if (this.data.mode === 'edit' && !this.data.user) {
      return false;
    }
    if (!this.username.trim() || !this.email.trim()) {
      return false;
    }
    if (this.setUserPassword) {
      const trimmedPassword = this.password.trim();
      return trimmedPassword.length > 0 && trimmedPassword === this.confirmPassword.trim();
    }
    return true;
  }

  onSetUserPasswordChange(enabled: boolean): void {
    this.setUserPassword = enabled;
    if (!enabled) {
      this.password = '';
      this.confirmPassword = '';
    }
  }

  submit(createAnother = false): void {
    if (!this.canSave) {
      return;
    }
    const result: UserFormDialogResult = {
      mode: this.data.mode,
      username: this.username.trim(),
      firstName: this.firstName.trim(),
      lastName: this.lastName.trim(),
      company: this.company.trim(),
      email: this.email.trim(),
      groups: this.groups,
      ...(this.data.mode === 'create' ? { createAnother } : {}),
    };
    const trimmedPassword = this.password.trim();
    if (this.setUserPassword && trimmedPassword.length > 0) {
      result.password = trimmedPassword;
    }

    if (this.data.mode === 'edit') {
      this.dialogRef.close(result);
      return;
    }

    const invited = !result.password?.trim();
    this.saving.set(true);
    this.dialogRef.disableClose = true;

    this.userService
      .createUser({
        username: result.username,
        firstName: result.firstName,
        lastName: result.lastName,
        company: result.company,
        email: result.email,
        password: result.password,
        groups: result.groups,
      })
      .pipe(
        finalize(() => {
          this.saving.set(false);
          this.dialogRef.disableClose = false;
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          const closeResult: UserFormDialogResult = {
            mode: 'create',
            username: result.username,
            firstName: result.firstName,
            lastName: result.lastName,
            company: result.company,
            email: result.email,
            groups: result.groups,
            invited,
            createAnother,
          };
          this.dialogRef.close(closeResult);
        },
        error: (err) => {
          this.snackBar.open(
            this.createUserErrorMessage(err, invited),
            this.translate.instant('common.dismiss'),
            {
              duration: 7000,
            },
          );
        },
      });
  }

  private createUserErrorMessage(err: unknown, invited: boolean): string {
    const raw = this.extractApiErrorMessage(err);
    const lower = raw.toLowerCase();

    if (lower.includes('user already exists')) {
      return this.translate.instant('admin.message.user-already-exists');
    }
    if (lower.includes('must have a password')) {
      return this.translate.instant('admin.message.password-required-for-server');
    }

    const simplified = this.simplifyNuxeoAutomationMessage(raw);
    if (simplified) {
      return simplified;
    }
    return this.translate.instant(
      invited ? 'admin.message.invitation-failed' : 'admin.message.create-failed',
    );
  }

  private extractApiErrorMessage(err: unknown): string {
    return (
      (err as { error?: { message?: string } })?.error?.message?.trim() ??
      (err as { message?: string })?.message?.trim() ??
      ''
    );
  }

  /** Nuxeo automation errors repeat "Failed to invoke operation…"; keep the actionable tail. */
  private simplifyNuxeoAutomationMessage(message: string): string {
    if (!message) {
      return '';
    }
    const parts = message
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    const meaningful = parts.filter((part) => !/^Failed to invoke operation/i.test(part));
    return meaningful.at(-1) ?? parts.at(-1) ?? message;
  }
}
