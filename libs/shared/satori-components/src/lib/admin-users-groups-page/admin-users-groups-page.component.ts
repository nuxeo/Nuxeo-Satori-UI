import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatPaginatorModule, type PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { catchError, filter, forkJoin, map, of, type Subscription, switchMap } from 'rxjs';

import {
  resolvePaginatedListTotal,
  type NuxeoDocument,
  type NuxeoGroup,
  type NuxeoGroupList,
  type NuxeoUser,
  type NuxeoUserList,
  UserService,
} from '@nuxeo/satori-platform/nuxeo-client';

import { type NxsConfirmDialogData } from '../confirm-dialog/confirm-dialog.component';
import {
  NxsGroupFormDialogComponent,
  type NxsGroupFormDialogData,
  type NxsGroupFormDialogResult,
} from '../group-form-dialog/group-form-dialog.component';
import {
  NxsUserFormDialogComponent,
  type NxsUserFormDialogData,
  type NxsUserFormDialogResult,
} from '../user-form-dialog/user-form-dialog.component';

/** A row of the "recently created" table: a user or a group. */
export interface NxsRecentPrincipalRow {
  readonly kind: 'user' | 'group';
  readonly name: string;
  readonly identifier: string;
  readonly email: string;
}

/** A message for the status line, already translated. `error` marks a refusal. */
interface Status {
  readonly text: string;
  readonly error: boolean;
}

/** How many members a group row lists before the rest are counted as "+N". */
const MEMBERS_SHOWN = 3;

/** The ID the host renders this page under, through `lib-extension-outlet`. */
export const NXS_ADMIN_USERS_GROUPS_PAGE_ID = 'nxs.components.adminUsersGroupsPage';

/**
 * The administration screen for users and groups: search both, see who was created recently, and
 * create, edit or delete. It writes through `UserService` and asks before deleting.
 *
 * It does not navigate. Choosing a user or a group calls `userChosen` or `groupChosen` with the id,
 * and the host routes to its details page. Outcomes appear in a status line on the page, which stays
 * on screen until the next action, so a refusal is not lost the way a snackbar's timeout would lose it.
 */
import { saveEditedUser, saveEditedGroup, confirmAction } from '../admin-edit-flows';

@Component({
  selector: 'nxs-admin-users-groups-page',
  standalone: true,
  templateUrl: './admin-users-groups-page.component.html',
  styleUrl: './admin-users-groups-page.component.scss',
  imports: [
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatPaginatorModule,
    MatProgressSpinnerModule,
    MatTableModule,
    MatTabsModule,
    MatTooltipModule,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-admin-users-groups-page' },
})
export class NxsAdminUsersGroupsPageComponent implements OnInit {
  private readonly userService = inject(UserService);
  private readonly dialog = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);
  private readonly translate = inject(TranslateService);

  /** Called with the username when the user chooses one. */
  readonly userChosen = input<(username: string) => void>(() => undefined);
  /** Called with the group name when the user chooses one. */
  readonly groupChosen = input<(groupname: string) => void>(() => undefined);

  protected readonly pageSize = 20;
  protected readonly recentPageSize = 5;
  protected readonly userColumns = ['username', 'name', 'email', 'groups', 'actions'] as const;
  protected readonly groupColumns = ['groupname', 'label', 'members', 'actions'] as const;
  protected readonly recentColumns = ['name', 'identifier', 'email'] as const;

  protected readonly query = signal('');
  protected readonly users = signal<NuxeoUser[]>([]);
  protected readonly groups = signal<NuxeoGroup[]>([]);
  protected readonly usersPage = signal(0);
  protected readonly groupsPage = signal(0);
  protected readonly usersTotal = signal(0);
  protected readonly groupsTotal = signal(0);
  protected readonly usersLoading = signal(false);
  protected readonly groupsLoading = signal(false);
  protected readonly usersError = signal(false);
  protected readonly groupsError = signal(false);
  protected readonly recent = signal<NxsRecentPrincipalRow[]>([]);
  protected readonly recentLoading = signal(false);
  protected readonly recentPage = signal(0);
  protected readonly recentPageRows = computed(() => {
    const start = this.recentPage() * this.recentPageSize;
    return this.recent().slice(start, start + this.recentPageSize);
  });
  protected readonly selectedTab = signal(0);
  protected readonly status = signal<Status | null>(null);

  /** The search the user last submitted; paging continues it, whatever is typed since. */
  private committedQuery = '';
  private searchRequest?: Subscription;
  private usersRequest?: Subscription;
  private groupsRequest?: Subscription;

  ngOnInit(): void {
    this.runSearch();
    this.loadRecent();
  }

  /** Searches users and groups together, from the first page of each. */
  protected runSearch(): void {
    this.cancelRequests();
    this.usersPage.set(0);
    this.groupsPage.set(0);
    this.usersLoading.set(true);
    this.groupsLoading.set(true);
    this.usersError.set(false);
    this.groupsError.set(false);
    const query = this.query();
    this.committedQuery = query;
    this.searchRequest = forkJoin({
      users: this.userService.searchUsersPaged(query, this.pageSize, 0).pipe(
        catchError(() => {
          this.usersError.set(true);
          return of({ 'entity-type': 'users', entries: [], totalSize: 0 } satisfies NuxeoUserList);
        }),
      ),
      groups: this.userService.searchGroupsPaged(query, this.pageSize, 0).pipe(
        catchError(() => {
          this.groupsError.set(true);
          return of({
            'entity-type': 'groups',
            entries: [],
            totalSize: 0,
          } satisfies NuxeoGroupList);
        }),
      ),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ users, groups }) => {
        this.users.set(users.entries ?? []);
        this.usersTotal.set(resolvePaginatedListTotal(users, this.pageSize, 0));
        this.groups.set(groups.entries ?? []);
        this.groupsTotal.set(resolvePaginatedListTotal(groups, this.pageSize, 0));
        this.selectTabFor(query, this.usersTotal(), this.groupsTotal());
        this.usersLoading.set(false);
        this.groupsLoading.set(false);
      });
  }

  protected loadRecent(): void {
    this.recentLoading.set(true);
    this.userService
      .getRecentlyCreatedUsersAndGroups(50, 0)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.recentPage.set(0);
          this.recent.set(this.recentRowsFrom(res.entries ?? []));
          this.recentLoading.set(false);
        },
        error: () => {
          this.recent.set([]);
          this.recentLoading.set(false);
        },
      });
  }

  /**
   * Pages users from the search the user last submitted, not the text being typed. A page that
   * was still loading when another search or page started is dropped, so its answer cannot land
   * on top of the newer one.
   */
  protected onUsersPage(event: PageEvent): void {
    this.cancelRequests();
    this.usersPage.set(event.pageIndex);
    this.usersLoading.set(true);
    this.usersError.set(false);
    this.usersRequest = this.userService
      .searchUsersPaged(this.committedQuery, this.pageSize, event.pageIndex)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.users.set(res.entries ?? []);
          this.usersTotal.set(resolvePaginatedListTotal(res, this.pageSize, event.pageIndex));
          this.usersLoading.set(false);
        },
        error: () => {
          this.users.set([]);
          this.usersTotal.set(0);
          this.usersError.set(true);
          this.usersLoading.set(false);
        },
      });
  }

  protected onGroupsPage(event: PageEvent): void {
    this.cancelRequests();
    this.groupsPage.set(event.pageIndex);
    this.groupsLoading.set(true);
    this.groupsError.set(false);
    this.groupsRequest = this.userService
      .searchGroupsPaged(this.committedQuery, this.pageSize, event.pageIndex)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.groups.set(res.entries ?? []);
          this.groupsTotal.set(resolvePaginatedListTotal(res, this.pageSize, event.pageIndex));
          this.groupsLoading.set(false);
        },
        error: () => {
          this.groups.set([]);
          this.groupsTotal.set(0);
          this.groupsError.set(true);
          this.groupsLoading.set(false);
        },
      });
  }

  /**
   * Drops every list request still in flight. A request that is dropped never clears its loading
   * flag, so a list left mid-load by another action is cleared here.
   */
  private cancelRequests(): void {
    if (this.searchRequest && !this.searchRequest.closed) {
      this.usersLoading.set(false);
      this.groupsLoading.set(false);
    }
    if (this.usersRequest && !this.usersRequest.closed) this.usersLoading.set(false);
    if (this.groupsRequest && !this.groupsRequest.closed) this.groupsLoading.set(false);
    this.searchRequest?.unsubscribe();
    this.usersRequest?.unsubscribe();
    this.groupsRequest?.unsubscribe();
  }

  protected onRecentPage(event: PageEvent): void {
    this.recentPage.set(event.pageIndex);
  }

  protected openRecent(row: NxsRecentPrincipalRow): void {
    if (row.kind === 'user') this.userChosen()(row.identifier);
    else this.groupChosen()(row.identifier);
  }

  protected openCreateUser(): void {
    this.dialog
      .open<NxsUserFormDialogComponent, NxsUserFormDialogData, NxsUserFormDialogResult | undefined>(
        NxsUserFormDialogComponent,
        { width: '480px', maxHeight: '90vh', data: { mode: 'create' } },
      )
      .afterClosed()
      .pipe(
        filter((result): result is NxsUserFormDialogResult => !!result && result.mode === 'create'),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => {
        this.status.set({
          text: result.invited
            ? 'satori-components.admin-users-groups-page.invitation-sent'
            : 'satori-components.admin-users-groups-page.user-created',
          error: false,
        });
        if (!result.invited) this.query.set(result.username);
        this.runSearch();
        this.loadRecent();
        if (result.createAnother) this.openCreateUser();
      });
  }

  protected openEditUser(user: NuxeoUser): void {
    saveEditedUser(this.dialog, this.userService, user)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.finish('satori-components.admin-users-groups-page.user-updated', false),
        error: () => this.finish('satori-components.admin-users-groups-page.update-failed', true),
      });
  }

  protected deleteUser(user: NuxeoUser): void {
    this.confirm({
      title: 'satori-components.admin-users-groups-page.delete-user',
      message: 'satori-components.admin-users-groups-page.delete-user-named',
      name: user.id,
    })
      .pipe(
        switchMap(() => this.userService.deleteUser(user.id)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => this.finish('satori-components.admin-users-groups-page.user-deleted', false),
        error: () => this.finish('satori-components.admin-users-groups-page.delete-failed', true),
      });
  }

  protected openCreateGroup(): void {
    this.dialog
      .open<
        NxsGroupFormDialogComponent,
        NxsGroupFormDialogData,
        NxsGroupFormDialogResult | undefined
      >(NxsGroupFormDialogComponent, { width: '480px', data: { mode: 'create' } })
      .afterClosed()
      .pipe(
        filter(
          (result): result is NxsGroupFormDialogResult => !!result && result.mode === 'create',
        ),
        switchMap((result) =>
          this.userService
            .createGroup({
              groupname: result.groupname,
              grouplabel: result.grouplabel,
              memberUsers: [...result.memberUsers],
            })
            .pipe(map(() => result)),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (result) => {
          this.finish('satori-components.admin-users-groups-page.group-created', false);
          if (result.createAnother) this.openCreateGroup();
        },
        error: () => this.finish('satori-components.admin-users-groups-page.create-failed', true),
      });
  }

  protected openEditGroup(group: NuxeoGroup): void {
    saveEditedGroup(this.dialog, this.userService, group)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.finish('satori-components.admin-users-groups-page.group-updated', false),
        error: () => this.finish('satori-components.admin-users-groups-page.update-failed', true),
      });
  }

  protected deleteGroup(group: NuxeoGroup): void {
    this.confirm({
      title: 'satori-components.admin-users-groups-page.delete-group',
      message: 'satori-components.admin-users-groups-page.delete-group-named',
      name: group.groupname,
    })
      .pipe(
        switchMap(() => this.userService.deleteGroup(group.groupname)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => this.finish('satori-components.admin-users-groups-page.group-deleted', false),
        error: () => this.finish('satori-components.admin-users-groups-page.delete-failed', true),
      });
  }

  /** The name a user row shows: first and last name, or the username when neither is set. */
  protected displayName(user: NuxeoUser): string {
    const joined =
      `${user.properties.firstName?.trim() ?? ''} ${user.properties.lastName?.trim() ?? ''}`.trim();
    return joined || user.id;
  }

  protected groupsLabel(user: NuxeoUser): string {
    return (user.properties.groups ?? []).join(', ');
  }

  /** The first few members, and "+N" for the rest, so a large group does not fill the row. */
  protected membersPreview(group: NuxeoGroup): string {
    const members = group.memberUsers ?? [];
    if (members.length === 0) return '—';
    if (members.length <= MEMBERS_SHOWN) return members.join(', ');
    return `${members.slice(0, MEMBERS_SHOWN).join(', ')}, +${members.length - MEMBERS_SHOWN}`;
  }

  /** Runs the confirm dialog for a deletion; it emits once when the user confirms. */
  private confirm(names: { title: string; message: string; name: string }) {
    const data: NxsConfirmDialogData = {
      title: this.translate.instant(names.title),
      message: this.translate.instant(names.message, { name: names.name }),
      confirmLabel: this.translate.instant('satori-components.admin-users-groups-page.delete'),
    };
    return confirmAction(this.dialog, data);
  }

  /** Reports the outcome on the status line and refreshes both lists. */
  private finish(key: string, error: boolean): void {
    this.status.set({ text: key, error });
    if (!error) {
      this.runSearch();
      this.loadRecent();
    }
  }

  private selectTabFor(query: string, usersTotal: number, groupsTotal: number): void {
    if (!query.trim()) return;
    if (usersTotal === 0 && groupsTotal > 0) this.selectedTab.set(1);
    else if (usersTotal > 0) this.selectedTab.set(0);
  }

  private recentRowsFrom(docs: NuxeoDocument[]): NxsRecentPrincipalRow[] {
    return docs.flatMap((doc): NxsRecentPrincipalRow[] => {
      if (doc.type === 'user') {
        const firstName = String(doc.properties['user:firstName'] ?? '').trim();
        const lastName = String(doc.properties['user:lastName'] ?? '').trim();
        return [
          {
            kind: 'user',
            name: `${firstName} ${lastName}`.trim() || doc.uid,
            identifier: doc.uid,
            email: String(doc.properties['user:email'] ?? ''),
          },
        ];
      }
      if (doc.type === 'group') {
        const label = String(doc.properties['group:grouplabel'] ?? '').trim();
        return [{ kind: 'group', name: label || doc.uid, identifier: doc.uid, email: '' }];
      }
      return [];
    });
  }
}
