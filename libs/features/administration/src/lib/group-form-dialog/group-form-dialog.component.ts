import { COMMA, ENTER } from '@angular/cdk/keycodes';
import {
  Component,
  DestroyRef,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import {
  MatAutocompleteModule,
  MatAutocompleteSelectedEvent,
} from '@angular/material/autocomplete';
import { MatChipInput, MatChipsModule, MatChipInputEvent } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { Subject, debounceTime, distinctUntilChanged, switchMap } from 'rxjs';

import { NuxeoGroup, NuxeoUser, UserService } from '@nuxeo/satori-platform/nuxeo-client';
import { TranslatePipe } from '@ngx-translate/core';

export interface GroupFormDialogData {
  mode: 'create' | 'edit';
  group?: NuxeoGroup;
}

export interface GroupFormDialogResult {
  mode: 'create' | 'edit';
  groupname: string;
  grouplabel: string;
  memberUsers: string[];
  /** When creating, submit again with a fresh dialog (Nuxeo Web UI parity for bulk entry). */
  createAnother?: boolean;
}

@Component({
  selector: 'lib-group-form-dialog',
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
  ],
  templateUrl: './group-form-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
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
        padding-top: 2.75rem;
        padding-bottom: 0.5rem;
        overflow-x: hidden;
      }
      .first-field {
        margin-top: 0.25rem;
      }
      .full {
        width: 100%;
      }
      .dialog-actions {
        gap: 0.5rem;
        padding: 0.75rem 1.5rem 1.25rem;
      }
      .member-opt {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        line-height: 1.25;
      }
      .member-opt__id {
        font-weight: 500;
      }
      .member-opt__meta {
        font-size: 0.8125rem;
        opacity: 0.75;
      }
      @media (max-width: 640px) {
        .form {
          min-width: 0;
        }
      }
    `,
  ],
})
export class GroupFormDialogComponent implements OnInit, OnDestroy {
  private readonly dialogRef = inject(
    MatDialogRef<GroupFormDialogComponent, GroupFormDialogResult | undefined>,
  );
  private readonly userService = inject(UserService);
  private readonly destroyRef = inject(DestroyRef);

  readonly data = inject<GroupFormDialogData>(MAT_DIALOG_DATA);

  readonly separatorKeysCodes: number[] = [ENTER, COMMA];

  groupname = '';
  grouplabel = '';
  /** Selected member usernames (ids). */
  memberUsernames: string[] = [];
  userSearchQuery = '';
  filteredUsers: NuxeoUser[] = [];

  private readonly searchTerms = new Subject<string>();
  /** Suppresses matChipInputTokenEnd after autocomplete selection (NXSAT-151). */
  private skipNextChipInput = false;

  @ViewChild(MatChipInput) private memberChipInput?: MatChipInput;

  ngOnInit(): void {
    const g = this.data.group;
    if (this.data.mode === 'edit' && g) {
      this.groupname = g.groupname;
      this.grouplabel = g.grouplabel ?? '';
      this.memberUsernames = [...(g.memberUsers ?? [])];
    }

    this.searchTerms
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((q) => {
          const query = (q ?? '').trim() || '*';
          return this.userService.searchUsersPaged(query, 30, 0);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (res) => {
          const ids = new Set(this.memberUsernames);
          this.filteredUsers = (res.entries ?? []).filter((u) => u.id && !ids.has(u.id));
        },
        error: () => {
          this.filteredUsers = [];
        },
      });
  }

  ngOnDestroy(): void {
    this.searchTerms.complete();
  }

  onUserSearch(q: string): void {
    this.userSearchQuery = q;
    this.searchTerms.next(q);
  }

  onMemberInputFocus(): void {
    // Ensure autocomplete calls API even when user reopens with the same query.
    this.searchTerms.next(this.userSearchQuery);
  }

  userDisplayLine(u: NuxeoUser): string {
    const fn = u.properties?.firstName?.trim() ?? '';
    const ln = u.properties?.lastName?.trim() ?? '';
    const name = `${fn} ${ln}`.trim();
    const email = u.properties?.email ?? '';
    if (name && email) return `${name} · ${email}`;
    return name || email || '';
  }

  onMemberInputKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') {
      return;
    }
    const typed = this.userSearchQuery.trim();
    if (!typed) {
      return;
    }

    if (this.filteredUsers.length > 0) {
      // Enter should select from autocomplete search results, not commit typed text as a chip.
      this.skipNextChipInput = true;
    }
  }

  onUserSelected(event: MatAutocompleteSelectedEvent): void {
    this.skipNextChipInput = true;
    const u = event.option.value as NuxeoUser;
    const userId = u?.id?.trim();
    if (userId) {
      // Autocomplete can emit matChipInputTokenEnd first with a partial prefix chip.
      this.memberUsernames = this.memberUsernames.filter(
        (id) => id === userId || !userId.startsWith(id),
      );
      if (!this.memberUsernames.includes(userId)) {
        this.memberUsernames = [...this.memberUsernames, userId];
      }
    }
    this.clearMemberSearch();
    event.option.deselect();
  }

  addMemberFromInput(event: MatChipInputEvent): void {
    if (this.skipNextChipInput) {
      this.skipNextChipInput = false;
      event.chipInput.clear();
      this.clearMemberSearch();
      return;
    }
    const raw = (event.value ?? '').trim();
    if (!raw) {
      event.chipInput.clear();
      return;
    }

    const resolved = this.resolveMemberFromChipInput(raw);
    if (resolved === null) {
      event.chipInput.clear();
      this.clearMemberSearch();
      return;
    }
    if (resolved && !this.memberUsernames.includes(resolved)) {
      this.memberUsernames = [...this.memberUsernames, resolved];
    }
    event.chipInput.clear();
    this.clearMemberSearch();
  }

  private resolveMemberFromChipInput(raw: string): string | null {
    const typed = this.userSearchQuery.trim();

    if (typed && raw === typed && this.isIncompleteUserPrefix(raw)) {
      return null;
    }

    if (typed && raw.startsWith(typed) && raw.length > typed.length) {
      const suffix = raw.slice(typed.length);
      const optionMatch = this.filteredUsers.find((u) => u.id === suffix);
      if (optionMatch?.id) {
        return optionMatch.id;
      }
    }

    if (this.isIncompleteUserPrefix(raw)) {
      return null;
    }

    const exactOption = this.filteredUsers.find((u) => u.id === raw);
    if (exactOption?.id) {
      return exactOption.id;
    }

    return raw;
  }

  /** True when `value` is only a typed prefix of a known user id (not a full id). */
  private isIncompleteUserPrefix(value: string): boolean {
    if (this.filteredUsers.some((u) => u.id === value)) {
      return false;
    }
    return this.filteredUsers.some((u) => u.id.startsWith(value) && u.id !== value);
  }

  removeMember(id: string): void {
    this.memberUsernames = this.memberUsernames.filter((x) => x !== id);
    this.searchTerms.next(this.userSearchQuery);
  }

  private clearMemberSearch(): void {
    this.userSearchQuery = '';
    this.filteredUsers = [];
    this.searchTerms.next('');
    this.memberChipInput?.clear();
  }

  submit(createAnother = false): void {
    if (this.data.mode === 'create' && !this.groupname.trim()) {
      return;
    }
    this.dialogRef.close({
      mode: this.data.mode,
      groupname: this.groupname.trim(),
      grouplabel: this.grouplabel.trim(),
      memberUsers: [...this.memberUsernames],
      ...(this.data.mode === 'create' ? { createAnother } : {}),
    });
  }
}
