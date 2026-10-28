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
import { TranslatePipe } from '@ngx-translate/core';
import { catchError, debounceTime, distinctUntilChanged, of, Subject, switchMap } from 'rxjs';

import { NuxeoGroup, NuxeoUser, UserService } from '@nuxeo/satori-platform/nuxeo-client';

/** What the group form dialog needs from the page that opens it. */
export interface NxsGroupFormDialogData {
  /** `create` for a new group, `edit` for an existing one. */
  readonly mode: 'create' | 'edit';
  /** The group being edited. Required in `edit` mode. */
  readonly group?: NuxeoGroup;
}

/** What the dialog closes with: the values to save. The caller creates or updates the group. */
export interface NxsGroupFormDialogResult {
  readonly mode: 'create' | 'edit';
  readonly groupname: string;
  readonly grouplabel: string;
  /** The member usernames, in the order they were added. */
  readonly memberUsers: string[];
  /** Set when the user chose Create another, so the caller opens a fresh dialog. */
  readonly createAnother?: boolean;
}

/**
 * Creates or edits a group, as a `MatDialog`: `dialog.open(NxsGroupFormDialogComponent, { data })`.
 *
 * The dialog does not write anything itself: it closes with the values and the caller saves them.
 * Members are found by searching the directory as the user types, or typed and confirmed with Enter.
 * The group name cannot change in edit mode, because it is the group's identity.
 */
@Component({
  selector: 'nxs-group-form-dialog',
  standalone: true,
  templateUrl: './group-form-dialog.component.html',
  styleUrl: './group-form-dialog.component.scss',
  imports: [
    FormsModule,
    MatAutocompleteModule,
    MatButtonModule,
    MatChipsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-group-form-dialog' },
})
export class NxsGroupFormDialogComponent implements OnInit {
  private readonly dialogRef =
    inject<MatDialogRef<NxsGroupFormDialogComponent, NxsGroupFormDialogResult | undefined>>(
      MatDialogRef,
    );
  private readonly userService = inject(UserService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly data = inject<NxsGroupFormDialogData>(MAT_DIALOG_DATA);

  protected readonly separatorKeysCodes: number[] = [ENTER, COMMA];
  protected readonly groupname = signal('');
  protected readonly grouplabel = signal('');
  protected readonly members = signal<string[]>([]);
  protected readonly memberQuery = signal('');
  protected readonly memberOptions = signal<NuxeoUser[]>([]);
  protected readonly canSave = computed(() => {
    if (this.data.mode === 'create') return this.groupname().trim().length > 0;
    return !!this.data.group;
  });

  private readonly searchTerms = new Subject<string>();
  /** Set by a choice from the autocomplete, so the same Enter does not also add the typed text. */
  private skipNextChipInput = false;
  /** Members as they stood before the current search began, so a pick never drops one of them. */
  private membersBeforeQuery = new Set<string>();
  private readonly memberChipInput = viewChild(MatChipInput);

  ngOnInit(): void {
    const group = this.data.group;
    if (this.data.mode === 'edit' && group) {
      this.groupname.set(group.groupname);
      this.grouplabel.set(group.grouplabel ?? '');
      this.members.set([...(group.memberUsers ?? [])]);
    }
    this.searchTerms
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((query) =>
          this.userService.searchUsersPaged(query.trim() || '*', 30, 0).pipe(
            // A failed request is an empty result, so the next search still runs.
            catchError(() => of({ entries: [] })),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (res) => {
          const chosen = new Set(this.members());
          this.memberOptions.set(
            (res.entries ?? []).filter((user) => user.id && !chosen.has(user.id)),
          );
        },
      });
  }

  protected onMemberSearch(query: string): void {
    if (!this.memberQuery()) {
      this.membersBeforeQuery = new Set(this.members());
    }
    this.memberQuery.set(query);
    this.searchTerms.next(query);
  }

  protected onMemberInputKeydown(event: KeyboardEvent): void {
    // Enter should pick from the search results, not commit the typed text as a member.
    if (event.key === 'Enter' && this.memberQuery().trim() && this.memberOptions().length > 0) {
      this.skipNextChipInput = true;
    }
  }

  protected onMemberSelected(event: MatAutocompleteSelectedEvent): void {
    this.skipNextChipInput = true;
    const userId = (event.option.value as NuxeoUser)?.id?.trim();
    if (userId) {
      // The autocomplete can add the typed text as a partial chip first. Drop only that chip, and only when
      // this search added it: a member already on the list, or picked from blank results, is never dropped.
      const typed = this.memberQuery().trim();
      const kept = this.members().filter(
        (id) =>
          !(
            id === typed &&
            id !== userId &&
            userId.startsWith(id) &&
            !this.membersBeforeQuery.has(id)
          ),
      );
      this.members.set(kept.includes(userId) ? kept : [...kept, userId]);
      this.membersBeforeQuery = new Set(this.members());
    }
    this.clearMemberSearch();
    event.option.deselect();
  }

  protected addMemberFromInput(event: MatChipInputEvent): void {
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
    const resolved = this.resolveMember(raw);
    if (resolved && !this.members().includes(resolved)) {
      this.members.update((members) => [...members, resolved]);
    }
    event.chipInput.clear();
    this.clearMemberSearch();
  }

  protected removeMember(id: string): void {
    this.members.update((members) => members.filter((member) => member !== id));
    this.searchTerms.next(this.memberQuery());
  }

  protected submit(createAnother = false): void {
    if (!this.canSave()) return;
    this.dialogRef.close({
      mode: this.data.mode,
      groupname: this.groupname().trim(),
      grouplabel: this.grouplabel().trim(),
      memberUsers: [...this.members()],
      ...(this.data.mode === 'create' ? { createAnother } : {}),
    });
  }

  /** The second line of a member option: the name and email Nuxeo holds for the user, if any. */
  protected userDisplayLine(user: NuxeoUser): string {
    const name =
      `${user.properties?.firstName?.trim() ?? ''} ${user.properties?.lastName?.trim() ?? ''}`.trim();
    const email = user.properties?.email ?? '';
    if (name && email) return `${name} · ${email}`;
    return name || email;
  }

  /** A typed username becomes a member unless it is only a prefix of a known one still being typed. */
  private resolveMember(raw: string): string | null {
    const typed = this.memberQuery().trim();
    const options = this.memberOptions();
    if (typed && raw === typed && this.isIncompletePrefix(raw)) return null;
    if (typed && raw.startsWith(typed) && raw.length > typed.length) {
      const suffix = raw.slice(typed.length);
      const match = options.find((user) => user.id === suffix);
      if (match?.id) return match.id;
    }
    if (this.isIncompletePrefix(raw)) return null;
    return options.find((user) => user.id === raw)?.id ?? raw;
  }

  private isIncompletePrefix(value: string): boolean {
    const options = this.memberOptions();
    if (options.some((user) => user.id === value)) return false;
    return options.some((user) => user.id.startsWith(value) && user.id !== value);
  }

  private clearMemberSearch(): void {
    this.memberQuery.set('');
    this.memberOptions.set([]);
    this.searchTerms.next('');
    this.memberChipInput()?.clear();
  }
}
