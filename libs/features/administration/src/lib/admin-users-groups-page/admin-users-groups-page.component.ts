import { Component, DestroyRef, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatTableModule } from '@angular/material/table';
import { MatTabsModule, MatTabGroup } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { Router } from '@angular/router';
import { catchError, filter, forkJoin, map, of, switchMap, tap, timer } from 'rxjs';

import {
  NuxeoDocument,
  NuxeoGroup,
  NuxeoGroupList,
  NuxeoUser,
  NuxeoUserList,
  UserService,
  resolvePaginatedListTotal,
} from '@nuxeo/satori-platform/nuxeo-client';

import { ConfirmDialogComponent, ConfirmDialogData } from '@nuxeo/satori-platform/ui';
import {
  GroupFormDialogComponent,
  GroupFormDialogData,
  GroupFormDialogResult,
} from '../group-form-dialog/group-form-dialog.component';
import {
  UserFormDialogComponent,
  UserFormDialogData,
  UserFormDialogResult,
} from '../user-form-dialog/user-form-dialog.component';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

export interface RecentUserGroupRow {
  kind: 'user' | 'group';
  name: string;
  identifier: string;
  email: string;
}

@Component({
  selector: 'lib-admin-users-groups-page',
  standalone: true,
  imports: [
    TranslatePipe,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatTableModule,
    MatTabsModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    MatDialogModule,
    MatSnackBarModule,
    MatMenuModule,
    MatPaginatorModule,
  ],
  templateUrl: './admin-users-groups-page.component.html',
  styleUrl: './admin-users-groups-page.component.scss',
})
export class AdminUsersGroupsPageComponent implements OnInit {
  private readonly userService = inject(UserService);
  private readonly translate = inject(TranslateService);
  /** The active language as a signal, so a `computed` that calls `instant()` recomputes on a switch. */
  private readonly currentLang = toSignal(
    this.translate.onLangChange.pipe(map((event) => event.lang)),
    { initialValue: this.translate.getCurrentLang() },
  );
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private membersMenuCloseTimer: ReturnType<typeof setTimeout> | null = null;
  private membersMenuHoverTrigger: MatMenuTrigger | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => this.cancelCloseMembersMenu());
  }

  readonly userColumns = ['username', 'name', 'email', 'groups', 'admin', 'actions'] as const;
  readonly groupColumns = ['groupname', 'label', 'members', 'actions'] as const;
  readonly recentColumns = ['name', 'identifier', 'email'] as const;

  users = signal<NuxeoUser[]>([]);
  groups = signal<NuxeoGroup[]>([]);
  readonly pageSize = 20;
  readonly usersPageIndex = signal(0);
  readonly groupsPageIndex = signal(0);
  readonly usersTotal = signal(0);
  readonly groupsTotal = signal(0);
  usersLoading = signal(false);
  groupsLoading = signal(false);
  usersError = signal<string | null>(null);
  groupsError = signal<string | null>(null);

  combinedSearchQuery = '';
  recentRows = signal<RecentUserGroupRow[]>([]);
  recentLoading = signal(false);
  /** Client-side pages for the merged "Recently Created" table (API returns two lists merged). */
  readonly recentPageIndex = signal(0);
  readonly recentPageSize = 5;
  readonly recentRowsPage = computed(() => {
    const all = this.recentRows();
    const start = this.recentPageIndex() * this.recentPageSize;
    return all.slice(start, start + this.recentPageSize);
  });

  readonly selectedTabIndex = signal(0);
  readonly usersTabLabel = computed(() => {
    this.currentLang();
    return this.translate.instant('admin.admin-users-groups-page.users-tab', {
      count: this.usersTotal(),
    });
  });
  readonly groupsTabLabel = computed(() => {
    this.currentLang();
    return this.translate.instant('admin.admin-users-groups-page.groups-tab', {
      count: this.groupsTotal(),
    });
  });
  private readonly tabGroup = viewChild<MatTabGroup>('ugTabGroup');

  ngOnInit(): void {
    this.runSearch();
    this.loadRecent();
  }

  runSearch(): void {
    this.usersPageIndex.set(0);
    this.groupsPageIndex.set(0);
    this.usersLoading.set(true);
    this.groupsLoading.set(true);
    this.usersError.set(null);
    this.groupsError.set(null);

    const query = this.combinedSearchQuery;

    forkJoin({
      users: this.userService.searchUsersPaged(query, this.pageSize, 0).pipe(
        catchError((err) => {
          this.usersError.set(
            err?.message ?? this.translate.instant('admin.message.could-not-load-users'),
          );
          return of({ 'entity-type': 'users', entries: [], totalSize: 0 } satisfies NuxeoUserList);
        }),
      ),
      groups: this.userService.searchGroupsPaged(query, this.pageSize, 0).pipe(
        catchError((err) => {
          this.groupsError.set(
            err?.message ?? this.translate.instant('admin.message.could-not-load-groups'),
          );
          return of({
            'entity-type': 'groups',
            entries: [],
            totalSize: 0,
          } satisfies NuxeoGroupList);
        }),
      ),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ users, groups }) => {
          const usersTotal = resolvePaginatedListTotal(users, this.pageSize, 0);
          const groupsTotal = resolvePaginatedListTotal(groups, this.pageSize, 0);

          this.users.set(users.entries ?? []);
          this.usersTotal.set(usersTotal);
          this.groups.set(groups.entries ?? []);
          this.groupsTotal.set(groupsTotal);

          this.applySearchTabSelection(query, usersTotal, groupsTotal);

          this.usersLoading.set(false);
          this.groupsLoading.set(false);
        },
        error: () => {
          this.usersLoading.set(false);
          this.groupsLoading.set(false);
        },
      });
  }

  loadRecent(): void {
    this.recentLoading.set(true);
    this.userService
      .getRecentlyCreatedUsersAndGroups(50, 0)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const rows = (res.entries ?? [])
            .map((doc) => this.mapRecentEntry(doc))
            .filter((row): row is RecentUserGroupRow => row !== null);
          this.recentPageIndex.set(0);
          this.recentRows.set(rows);
          this.recentLoading.set(false);
        },
        error: () => {
          this.recentPageIndex.set(0);
          this.recentRows.set([]);
          this.recentLoading.set(false);
        },
      });
  }

  loadUsers(): void {
    this.usersLoading.set(true);
    this.usersError.set(null);
    const pageIndex = this.usersPageIndex();
    this.userService
      .searchUsersPaged(this.combinedSearchQuery, this.pageSize, pageIndex)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.users.set(res.entries ?? []);
          this.usersTotal.set(resolvePaginatedListTotal(res, this.pageSize, pageIndex));
          this.usersLoading.set(false);
        },
        error: (err) => {
          this.usersError.set(
            err?.message ?? this.translate.instant('admin.message.could-not-load-users'),
          );
          this.usersLoading.set(false);
        },
      });
  }

  loadGroups(): void {
    this.groupsLoading.set(true);
    this.groupsError.set(null);
    const pageIndex = this.groupsPageIndex();
    this.userService
      .searchGroupsPaged(this.combinedSearchQuery, this.pageSize, pageIndex)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.groups.set(res.entries ?? []);
          this.groupsTotal.set(resolvePaginatedListTotal(res, this.pageSize, pageIndex));
          this.groupsLoading.set(false);
        },
        error: (err) => {
          this.groupsError.set(
            err?.message ?? this.translate.instant('admin.message.could-not-load-groups'),
          );
          this.groupsLoading.set(false);
        },
      });
  }

  onUsersPage(event: PageEvent): void {
    if (event.pageIndex === this.usersPageIndex()) return;
    this.usersPageIndex.set(event.pageIndex);
    this.loadUsers();
  }

  onGroupsPage(event: PageEvent): void {
    if (event.pageIndex === this.groupsPageIndex()) return;
    this.groupsPageIndex.set(event.pageIndex);
    this.loadGroups();
  }

  onRecentPage(event: PageEvent): void {
    if (event.pageIndex === this.recentPageIndex()) return;
    this.recentPageIndex.set(event.pageIndex);
  }

  openRecentRow(row: RecentUserGroupRow): void {
    if (row.kind === 'user') {
      this.openUserDetails(row.identifier);
      return;
    }
    this.openGroupDetails(row.identifier);
  }

  selectUser(user: NuxeoUser): void {
    this.openUserDetails(user.id);
  }

  selectGroup(group: NuxeoGroup): void {
    this.openGroupDetails(group.groupname);
  }

  private openUserDetails(userId: string): void {
    this.router.navigate(['/administration/users-groups/user', userId]);
  }

  private openGroupDetails(groupId: string): void {
    this.router.navigate(['/administration/users-groups/group', groupId]);
  }

  private afterMutation(): void {
    this.runSearch();
    // Audit indexing can be async (Nuxeo Web UI refreshes after a short delay).
    timer(1000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.loadRecent());
  }

  openCreateUser(): void {
    this.openCreateUserDialog();
  }

  private openCreateUserDialog(): void {
    this.dialog
      .open<UserFormDialogComponent, UserFormDialogData, UserFormDialogResult | undefined>(
        UserFormDialogComponent,
        {
          width: '480px',
          maxHeight: '90vh',
          data: { mode: 'create' },
        },
      )
      .afterClosed()
      .pipe(
        filter((r): r is UserFormDialogResult => !!r && r.mode === 'create'),
        switchMap((r) => {
          const invited = r.invited === true;
          if (invited) {
            return of({ r, invited: true as const, user: null });
          }
          return this.userService.getUser(r.username).pipe(
            map((user) => ({ r, invited: false as const, user })),
            catchError(() => of({ r, invited: false as const, user: null })),
          );
        }),
        tap(({ r, invited, user }) => {
          if (!invited && user) {
            const current = this.users();
            if (!current.some((u) => u.id === user.id)) {
              this.users.set([user, ...current]);
            }
          }
          this.snackBar.open(
            invited
              ? this.translate.instant('admin.invitation-sent', { email: r.email })
              : this.translate.instant('admin.message.user-created'),
            this.translate.instant('common.dismiss'),
            { duration: invited ? 6000 : 3000 },
          );
          if (!invited) {
            this.combinedSearchQuery = r.username;
          }
          this.afterMutation();
        }),
        map(({ r }) => r.createAnother === true),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((createAnother) => {
        if (createAnother) {
          this.openCreateUserDialog();
        }
      });
  }

  openEditUser(user: NuxeoUser): void {
    this.dialog
      .open<UserFormDialogComponent, UserFormDialogData, UserFormDialogResult | undefined>(
        UserFormDialogComponent,
        {
          width: '480px',
          maxHeight: '90vh',
          data: { mode: 'edit', user },
        },
      )
      .afterClosed()
      .subscribe((r) => {
        if (!r || r.mode !== 'edit') return;
        this.userService
          .updateUser(user.id, {
            firstName: r.firstName,
            lastName: r.lastName,
            company: r.company,
            email: r.email,
            password: r.password,
            groups: r.groups,
          })
          .subscribe({
            next: () => {
              this.snackBar.open(
                this.translate.instant('admin.message.user-updated'),
                this.translate.instant('common.dismiss'),
                { duration: 3000 },
              );
              this.afterMutation();
            },
            error: (e) =>
              this.snackBar.open(
                e?.error?.message ?? this.translate.instant('admin.message.update-failed'),
                this.translate.instant('common.dismiss'),
                {
                  duration: 5000,
                },
              ),
          });
      });
  }

  confirmDeleteUser(user: NuxeoUser): void {
    this.dialog
      .open<ConfirmDialogComponent, ConfirmDialogData, boolean | undefined>(
        ConfirmDialogComponent,
        {
          width: '400px',
          data: {
            title: this.translate.instant('confirm.delete-user'),
            message: this.translate.instant('confirm.delete-user-named', { name: user.id }),
            confirmLabel: this.translate.instant('confirm.delete'),
          },
        },
      )
      .afterClosed()
      .subscribe((ok) => {
        if (!ok) return;
        this.userService.deleteUser(user.id).subscribe({
          next: () => {
            this.snackBar.open(
              this.translate.instant('admin.message.user-deleted'),
              this.translate.instant('common.dismiss'),
              { duration: 3000 },
            );
            this.afterMutation();
          },
          error: (e) =>
            this.snackBar.open(
              e?.error?.message ?? this.translate.instant('admin.message.delete-failed'),
              this.translate.instant('common.dismiss'),
              { duration: 5000 },
            ),
        });
      });
  }

  openCreateGroup(): void {
    this.openCreateGroupDialog();
  }

  private openCreateGroupDialog(): void {
    this.dialog
      .open<GroupFormDialogComponent, GroupFormDialogData, GroupFormDialogResult | undefined>(
        GroupFormDialogComponent,
        { width: '480px', data: { mode: 'create' } },
      )
      .afterClosed()
      .subscribe((r) => {
        if (!r || r.mode !== 'create') return;
        this.userService
          .createGroup({
            groupname: r.groupname,
            grouplabel: r.grouplabel,
            memberUsers: r.memberUsers,
          })
          .subscribe({
            next: () => {
              this.snackBar.open(
                this.translate.instant('admin.message.group-created'),
                this.translate.instant('common.dismiss'),
                { duration: 3000 },
              );
              this.afterMutation();
              if (r.createAnother) {
                this.openCreateGroupDialog();
              }
            },
            error: (e) =>
              this.snackBar.open(
                e?.error?.message ?? this.translate.instant('admin.message.create-failed'),
                this.translate.instant('common.dismiss'),
                {
                  duration: 5000,
                },
              ),
          });
      });
  }

  openEditGroup(group: NuxeoGroup): void {
    this.dialog
      .open<GroupFormDialogComponent, GroupFormDialogData, GroupFormDialogResult | undefined>(
        GroupFormDialogComponent,
        { width: '480px', data: { mode: 'edit', group } },
      )
      .afterClosed()
      .subscribe((r) => {
        if (!r || r.mode !== 'edit') return;
        this.userService
          .updateGroup(group.groupname, {
            grouplabel: r.grouplabel,
            memberUsers: r.memberUsers,
          })
          .subscribe({
            next: () => {
              this.snackBar.open(
                this.translate.instant('admin.message.group-updated'),
                this.translate.instant('common.dismiss'),
                { duration: 3000 },
              );
              this.afterMutation();
            },
            error: (e) =>
              this.snackBar.open(
                e?.error?.message ?? this.translate.instant('admin.message.update-failed'),
                this.translate.instant('common.dismiss'),
                {
                  duration: 5000,
                },
              ),
          });
      });
  }

  confirmDeleteGroup(group: NuxeoGroup): void {
    this.dialog
      .open<ConfirmDialogComponent, ConfirmDialogData, boolean | undefined>(
        ConfirmDialogComponent,
        {
          width: '400px',
          data: {
            title: this.translate.instant('confirm.delete-group'),
            message: this.translate.instant('confirm.delete-group-named', {
              name: group.groupname,
            }),
            confirmLabel: this.translate.instant('confirm.delete'),
          },
        },
      )
      .afterClosed()
      .subscribe((ok) => {
        if (!ok) return;
        this.userService.deleteGroup(group.groupname).subscribe({
          next: () => {
            this.snackBar.open(
              this.translate.instant('admin.message.group-deleted'),
              this.translate.instant('common.dismiss'),
              { duration: 3000 },
            );
            this.afterMutation();
          },
          error: (e) =>
            this.snackBar.open(
              e?.error?.message ?? this.translate.instant('admin.message.delete-failed'),
              this.translate.instant('common.dismiss'),
              { duration: 5000 },
            ),
        });
      });
  }

  usersEmptyMessage(): string {
    if (this.combinedSearchQuery.trim() && this.users().length === 0 && this.groupsTotal() > 0) {
      return this.translate.instant('admin.admin-users-groups-page.no-users-match-see-groups');
    }
    return this.translate.instant('admin.admin-users-groups-page.no-users-match');
  }

  groupsEmptyMessage(): string {
    if (this.combinedSearchQuery.trim() && this.groups().length === 0 && this.usersTotal() > 0) {
      return this.translate.instant('admin.admin-users-groups-page.no-groups-match-see-users');
    }
    return this.translate.instant('admin.admin-users-groups-page.no-groups-match');
  }

  /** Switch tabs after a combined search based on which result set has matches. */
  private applySearchTabSelection(query: string, usersTotal: number, groupsTotal: number): void {
    if (!query.trim()) {
      return;
    }
    if (usersTotal === 0 && groupsTotal > 0) {
      this.selectResultsTab(1);
    } else if (usersTotal > 0) {
      this.selectResultsTab(0);
    }
  }

  private selectResultsTab(index: 0 | 1): void {
    this.selectedTabIndex.set(index);
    queueMicrotask(() => {
      const group = this.tabGroup();
      if (group) {
        group.selectedIndex = index;
      }
    });
  }

  private mapRecentEntry(doc: NuxeoDocument): RecentUserGroupRow | null {
    if (doc.type === 'user') {
      const props = doc.properties;
      const firstName = String(props['user:firstName'] ?? '').trim();
      const lastName = String(props['user:lastName'] ?? '').trim();
      const joined = `${firstName} ${lastName}`.trim();
      return {
        kind: 'user',
        name: joined || doc.uid,
        identifier: doc.uid,
        email: String(props['user:email'] ?? ''),
      };
    }
    if (doc.type === 'group') {
      const label = String(doc.properties['group:grouplabel'] ?? '').trim();
      return {
        kind: 'group',
        name: label || doc.uid,
        identifier: doc.uid,
        email: '',
      };
    }
    return null;
  }

  displayName(user: NuxeoUser): string {
    const fn = user.properties.firstName?.trim() ?? '';
    const ln = user.properties.lastName?.trim() ?? '';
    const joined = `${fn} ${ln}`.trim();
    return joined || user.id;
  }

  groupsLabel(user: NuxeoUser): string {
    return (user.properties.groups ?? []).join(', ');
  }

  memberUsernames(group: NuxeoGroup): string[] {
    return group.memberUsers ?? [];
  }

  membersPreviewLeading(group: NuxeoGroup): string {
    const members = this.memberUsernames(group);
    if (!members.length) return '—';
    return members.slice(0, 3).join(', ');
  }

  membersOverflowCount(group: NuxeoGroup): number {
    return Math.max(0, this.memberUsernames(group).length - 3);
  }

  membersOverflowUsernames(group: NuxeoGroup): string[] {
    return this.memberUsernames(group).slice(3);
  }

  openMembersMenu(trigger: MatMenuTrigger): void {
    this.membersMenuHoverTrigger = trigger;
    this.cancelCloseMembersMenu();
    if (!trigger.menuOpen) {
      trigger.openMenu();
    }
  }

  scheduleCloseMembersMenu(trigger: MatMenuTrigger): void {
    this.cancelCloseMembersMenu();
    this.membersMenuCloseTimer = setTimeout(() => {
      if (this.membersMenuHoverTrigger === trigger) {
        trigger.closeMenu();
      }
    }, 200);
  }

  onMembersMenuPanelEnter(trigger: MatMenuTrigger): void {
    this.membersMenuHoverTrigger = trigger;
    this.cancelCloseMembersMenu();
  }

  onMembersMenuPanelLeave(trigger: MatMenuTrigger): void {
    this.scheduleCloseMembersMenu(trigger);
  }

  cancelCloseMembersMenu(): void {
    if (this.membersMenuCloseTimer) {
      clearTimeout(this.membersMenuCloseTimer);
      this.membersMenuCloseTimer = null;
    }
  }

  membersMoreAriaLabel(group: NuxeoGroup): string {
    const count = this.membersOverflowCount(group);
    return this.translate.instant(
      count === 1
        ? 'admin.admin-users-groups-page.show-more-members-one'
        : 'admin.admin-users-groups-page.show-more-members-many',
      { count },
    );
  }

  membersPreview(group: NuxeoGroup): string {
    const members = this.memberUsernames(group);
    if (!members.length) return '—';
    if (members.length <= 3) return members.join(', ');
    return `${members.slice(0, 3).join(', ')}, +${members.length - 3}`;
  }
}
