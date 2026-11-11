import { COMMA, ENTER } from '@angular/cdk/keycodes';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  MatAutocompleteModule,
  MatAutocompleteSelectedEvent,
} from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatChipInput, MatChipInputEvent, MatChipsModule } from '@angular/material/chips';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { TranslatePipe } from '@ngx-translate/core';
import { catchError, debounceTime, finalize, of, Subject, switchMap } from 'rxjs';

import { NuxeoUser, UserService } from '@nuxeo/satori-platform/nuxeo-client';

/** What the user form dialog needs from the page that opens it. */
export interface NxsUserFormDialogData {
  /** `create` for a new account, `edit` for an existing one. */
  readonly mode: 'create' | 'edit';
  /** The account being edited. Required in `edit` mode. */
  readonly user?: NuxeoUser;
}

/** What the dialog closes with: the values to save, and whether the account was invited. */
export interface NxsUserFormDialogResult {
  readonly mode: 'create' | 'edit';
  readonly username: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly company: string;
  readonly email: string;
  readonly groups: string[];
  /** The password, when one was set. Absent means the server sends an invitation instead. */
  readonly password?: string;
  /** Set after a successful create that sent an invitation, because no password was set. */
  readonly invited?: boolean;
  /** Set when the user chose Create another, so the caller opens a fresh dialog. */
  readonly createAnother?: boolean;
}

/** A group the picker offers. */
interface GroupOption {
  readonly groupname: string;
  readonly grouplabel: string;
}

/**
 * Creates or edits a user, as a `MatDialog`: `dialog.open(NxsUserFormDialogComponent, { data })`.
 *
 * In `create` mode the dialog writes the new account itself through `UserService.createUser` and
 * closes with the result; with no password it asks the server to send an invitation. In `edit`
 * mode it closes with the values and the caller saves them. Groups are chosen from a search of the
 * directory, or typed and confirmed with Enter. A refusal stays in the dialog with the reason.
 */
@Component({
  selector: 'nxs-user-form-dialog',
  standalone: true,
  templateUrl: './user-form-dialog.component.html',
  styleUrl: './user-form-dialog.component.scss',
  imports: [
    FormsModule,
    MatAutocompleteModule,
    MatButtonModule,
    MatChipsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSlideToggleModule,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-user-form-dialog' },
})
export class NxsUserFormDialogComponent implements OnInit {
  private readonly dialogRef =
    inject<MatDialogRef<NxsUserFormDialogComponent, NxsUserFormDialogResult | undefined>>(
      MatDialogRef,
    );
  private readonly userService = inject(UserService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly data = inject<NxsUserFormDialogData>(MAT_DIALOG_DATA);

  protected readonly separatorKeysCodes: number[] = [ENTER, COMMA];
  protected readonly username = signal('');
  protected readonly firstName = signal('');
  protected readonly lastName = signal('');
  protected readonly company = signal('');
  protected readonly email = signal('');
  protected readonly groups = signal<string[]>([]);
  protected readonly setPassword = signal(false);
  protected readonly password = signal('');
  protected readonly confirmPassword = signal('');
  protected readonly groupQuery = signal('');
  protected readonly groupOptions = signal<GroupOption[]>([]);
  protected readonly loadingGroups = signal(true);
  protected readonly loadingGroupOptions = signal(false);
  protected readonly saving = signal(false);
  /** Translation key of the refusal to show, or null. */
  protected readonly failure = signal<string | null>(null);

  protected readonly passwordsDiffer = computed(
    () =>
      this.confirmPassword().length > 0 && this.password().trim() !== this.confirmPassword().trim(),
  );
  protected readonly canSave = computed(() => {
    if (this.loadingGroups() || this.saving()) return false;
    if (this.data.mode === 'edit' && !this.data.user) return false;
    if (!this.username().trim() || !this.email().trim()) return false;
    if (this.setPassword()) {
      const password = this.password().trim();
      return password.length > 0 && password === this.confirmPassword().trim();
    }
    return true;
  });

  private readonly groupSearchTerms = new Subject<string>();
  /** Set by a choice from the autocomplete, so the same Enter does not also add the typed text. */
  private skipNextChipInput = false;
  /** Groups as they stood before the current search began, so a pick never drops one of them. */
  private groupsBeforeQuery = new Set<string>();
  private readonly groupChipInput = viewChild(MatChipInput);

  ngOnInit(): void {
    const user = this.data.user;
    if (this.data.mode === 'edit' && user) {
      this.username.set(user.id);
      this.firstName.set(user.properties.firstName ?? '');
      this.lastName.set(user.properties.lastName ?? '');
      this.company.set(user.properties.company ?? '');
      this.email.set(user.properties.email ?? '');
      this.groups.set([...(user.properties.groups ?? [])]);
    }
    this.userService
      .searchGroupsPaged('*', 200, 0)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.groupOptions.set(this.optionsFrom(res.entries ?? []));
          this.loadingGroups.set(false);
        },
        error: () => this.loadingGroups.set(false),
      });
    this.groupSearchTerms
      .pipe(
        debounceTime(250),
        switchMap((query) => {
          this.loadingGroupOptions.set(true);
          return this.userService.searchGroupsPaged(query || '*', 30, 0).pipe(
            // A failed request is an empty result, so the next search still runs.
            catchError(() => of({ entries: [] })),
            finalize(() => this.loadingGroupOptions.set(false)),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (res) => {
          const chosen = new Set(this.groups());
          this.groupOptions.set(
            this.optionsFrom(res.entries ?? []).filter((g) => !chosen.has(g.groupname)),
          );
        },
      });
  }

  protected onGroupSearch(query: string): void {
    // Typed text starts a new entry, so an earlier pick's pending Enter-skip no longer applies.
    if (query?.trim()) this.skipNextChipInput = false;
    if (!this.groupQuery()) {
      this.groupsBeforeQuery = new Set(this.groups());
    }
    this.groupQuery.set(query);
    this.groupSearchTerms.next(query?.trim() ?? '');
  }

  protected onGroupInputFocus(): void {
    this.groupSearchTerms.next(this.groupQuery().trim() || '*');
  }

  protected onGroupInputKeydown(event: KeyboardEvent): void {
    // Enter should pick from the search results, not commit the typed text as a group.
    if (event.key === 'Enter' && this.groupQuery().trim() && this.groupOptions().length > 0) {
      this.skipNextChipInput = true;
    }
  }

  protected onGroupSelected(event: MatAutocompleteSelectedEvent): void {
    this.skipNextChipInput = true;
    const groupname = (event.option.value as string)?.trim();
    if (groupname) {
      // The autocomplete can add the typed text as a partial chip first. Drop only that chip, and only when
      // this search added it: a group already on the list, or picked from blank results, is never dropped.
      const typed = this.groupQuery().trim();
      const kept = this.groups().filter(
        (g) =>
          !(
            g === typed &&
            g !== groupname &&
            groupname.startsWith(g) &&
            !this.groupsBeforeQuery.has(g)
          ),
      );
      this.groups.set(kept.includes(groupname) ? kept : [...kept, groupname]);
      this.groupsBeforeQuery = new Set(this.groups());
    }
    this.clearGroupSearch();
    event.option.deselect();
  }

  protected addGroupFromInput(event: MatChipInputEvent): void {
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
    const resolved = this.resolveGroup(raw);
    if (resolved && !this.groups().includes(resolved)) {
      this.groups.update((groups) => [...groups, resolved]);
    }
    event.chipInput.clear();
    this.clearGroupSearch();
  }

  protected removeGroup(groupname: string): void {
    this.groups.update((groups) => groups.filter((g) => g !== groupname));
    this.groupSearchTerms.next(this.groupQuery().trim() || '*');
  }

  protected setPasswordEnabled(enabled: boolean): void {
    this.setPassword.set(enabled);
    if (!enabled) {
      this.password.set('');
      this.confirmPassword.set('');
    }
  }

  /** Cancel closes with nothing: undefined, so a caller checking for a result sees no submission. */
  protected cancel(): void {
    this.dialogRef.close(undefined);
  }

  protected submit(createAnother = false): void {
    if (!this.canSave()) return;
    const password = this.password().trim();
    const values = {
      mode: this.data.mode,
      username: this.username().trim(),
      firstName: this.firstName().trim(),
      lastName: this.lastName().trim(),
      company: this.company().trim(),
      email: this.email().trim(),
      groups: this.groups(),
      ...(this.setPassword() && password.length > 0 ? { password } : {}),
    };
    if (this.data.mode === 'edit') {
      this.dialogRef.close(values);
      return;
    }
    const invited = !values.password;
    this.saving.set(true);
    this.failure.set(null);
    this.dialogRef.disableClose = true;
    this.userService
      .createUser({
        username: values.username,
        firstName: values.firstName,
        lastName: values.lastName,
        company: values.company,
        email: values.email,
        password: values.password,
        groups: values.groups,
      })
      .pipe(
        finalize(() => {
          this.saving.set(false);
          this.dialogRef.disableClose = false;
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => this.dialogRef.close({ ...values, mode: 'create', invited, createAnother }),
        error: (error: unknown) => this.failure.set(this.createFailureKey(error, invited)),
      });
  }

  private optionsFrom(entries: { groupname?: string; grouplabel?: string }[]): GroupOption[] {
    return entries
      .filter((g): g is { groupname: string; grouplabel?: string } => !!g.groupname)
      .map((g) => ({ groupname: g.groupname, grouplabel: g.grouplabel || g.groupname }));
  }

  /** A typed group becomes a chip unless it is only a prefix of a known group still being typed. */
  private resolveGroup(raw: string): string | null {
    const typed = this.groupQuery().trim();
    const options = this.groupOptions();
    if (typed && raw === typed && this.isIncompletePrefix(raw)) return null;
    if (typed && raw.startsWith(typed) && raw.length > typed.length) {
      const suffix = raw.slice(typed.length);
      const match = options.find((g) => g.groupname === suffix);
      if (match) return match.groupname;
    }
    if (this.isIncompletePrefix(raw)) return null;
    return options.find((g) => g.groupname === raw)?.groupname ?? raw;
  }

  private isIncompletePrefix(value: string): boolean {
    const options = this.groupOptions();
    if (options.some((g) => g.groupname === value)) return false;
    return options.some((g) => g.groupname.startsWith(value) && g.groupname !== value);
  }

  private clearGroupSearch(): void {
    this.groupQuery.set('');
    this.groupOptions.set([]);
    this.groupSearchTerms.next('');
    this.groupChipInput()?.clear();
  }

  /** Nuxeo's messages for the two refusals a user can fix; anything else gets a generic line. */
  private createFailureKey(error: unknown, invited: boolean): string {
    const raw = this.serverMessage(error).toLowerCase();
    if (raw.includes('user already exists')) return 'admin.message.user-already-exists';
    if (raw.includes('must have a password')) return 'admin.message.password-required-for-server';
    return invited
      ? 'satori-components.user-form-dialog.invitation-failed'
      : 'satori-components.user-form-dialog.create-failed';
  }

  private serverMessage(error: unknown): string {
    const err = error as { error?: { message?: string }; message?: string } | null;
    return (err?.error?.message ?? err?.message ?? '').trim();
  }
}
