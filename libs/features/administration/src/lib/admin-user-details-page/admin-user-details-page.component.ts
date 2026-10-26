import {
  Component,
  LOCALE_ID,
  OnInit,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import {
  DocumentDetailService,
  NuxeoGroup,
  NuxeoUser,
  PrincipalPermissionPage,
  PrincipalPermissionRow,
  PrincipalPermissionsService,
  UserService,
  principalPermissionTimeFrameLabel,
} from '@nuxeo/satori-platform/nuxeo-client';

import { ConfirmDialogComponent, ConfirmDialogData } from '@nuxeo/satori-platform/ui';
import {
  UserFormDialogComponent,
  UserFormDialogData,
  UserFormDialogResult,
} from '../user-form-dialog/user-form-dialog.component';
import {
  ChangePasswordDialogComponent,
  ChangePasswordDialogData,
} from '../change-password-dialog/change-password-dialog.component';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

const PERM_PAGE_SIZE = 10;

@Component({
  selector: 'lib-admin-user-details-page',
  standalone: true,
  imports: [
    TranslatePipe,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatDialogModule,
    MatSnackBarModule,
    MatPaginatorModule,
  ],
  templateUrl: './admin-user-details-page.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './admin-user-details-page.component.scss',
})
export class AdminUserDetailsPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly translate = inject(TranslateService);
  private readonly locale = inject(LOCALE_ID);
  private readonly router = inject(Router);
  private readonly userService = inject(UserService);
  private readonly permService = inject(PrincipalPermissionsService);
  private readonly documentDetail = inject(DocumentDetailService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  readonly user = signal<NuxeoUser | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly groupColumns = ['name', 'identifier', 'actions'] as const;
  readonly permColumns = ['on', 'right', 'timeFrame', 'grantedBy', 'actions'] as const;

  /** Group display names for the Groups table and permission section titles. */
  readonly groupInfo = signal<Array<{ id: string; label: string }>>([]);

  readonly localPerm = signal<PrincipalPermissionPage | null>(null);
  readonly localPermLoading = signal(false);
  readonly localPageIndex = signal(0);

  readonly groupPermMap = signal<Record<string, PrincipalPermissionPage>>({});
  readonly groupPermLoading = signal<Record<string, boolean>>({});

  readonly permPageSize = PERM_PAGE_SIZE;

  private userId = '';

  private resetState(): void {
    this.user.set(null);
    this.loading.set(false);
    this.error.set(null);
    this.groupInfo.set([]);
    this.localPerm.set(null);
    this.localPermLoading.set(false);
    this.localPageIndex.set(0);
    this.groupPermMap.set({});
    this.groupPermLoading.set({});
  }

  ngOnInit(): void {
    this.route.paramMap.subscribe((paramMap) => {
      this.userId = paramMap.get('userId') ?? '';
      this.resetState();
      this.load();
    });
  }

  load(): void {
    if (!this.userId) {
      this.error.set(this.translate.instant('admin.message.missing-user-id'));
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    this.userService.getUser(this.userId).subscribe({
      next: (user) => {
        this.user.set(user);
        this.loading.set(false);
        this.loadGroupInfo(user);
        this.localPageIndex.set(0);
        this.loadLocalPerms();
        this.loadAllGroupPerms(user);
      },
      error: (e) => {
        this.error.set(
          e?.error?.message ?? this.translate.instant('admin.message.could-not-load-user-details'),
        );
        this.loading.set(false);
      },
    });
  }

  private loadGroupInfo(user: NuxeoUser): void {
    const groups = user.properties.groups ?? [];
    if (!groups.length) {
      this.groupInfo.set([]);
      return;
    }
    forkJoin(
      groups.map((gid) =>
        this.userService.getGroup(gid).pipe(catchError(() => of(null as NuxeoGroup | null))),
      ),
    ).subscribe((gs) => {
      this.groupInfo.set(
        groups.map((gid, i) => ({
          id: gid,
          label: gs[i]?.grouplabel ?? gid,
        })),
      );
    });
  }

  loadLocalPerms(): void {
    this.localPermLoading.set(true);
    this.permService
      .listLocalPermissionRows(this.userId, PERM_PAGE_SIZE, this.localPageIndex())
      .subscribe({
        next: (p) => {
          this.localPerm.set(p);
          this.localPermLoading.set(false);
        },
        error: () => {
          this.localPerm.set({
            rows: [],
            totalDocuments: 0,
            numberOfPages: 0,
            currentPageIndex: 0,
            currentPageSize: 0,
          });
          this.localPermLoading.set(false);
        },
      });
  }

  onLocalPermPage(e: PageEvent): void {
    this.localPageIndex.set(e.pageIndex);
    this.loadLocalPerms();
  }

  private loadAllGroupPerms(user: NuxeoUser): void {
    const groups = user.properties.groups ?? [];
    this.groupPermMap.set({});
    const loading: Record<string, boolean> = {};
    for (const g of groups) {
      loading[g] = true;
    }
    this.groupPermLoading.set(loading);
    for (const g of groups) {
      this.loadGroupPermPage(g, 0);
    }
  }

  loadGroupPermPage(groupId: string, pageIndex: number): void {
    this.groupPermLoading.update((m) => ({ ...m, [groupId]: true }));
    this.permService.listLocalPermissionRows(groupId, PERM_PAGE_SIZE, pageIndex).subscribe({
      next: (p) => {
        this.groupPermMap.update((m) => ({ ...m, [groupId]: p }));
        this.groupPermLoading.update((m) => ({ ...m, [groupId]: false }));
      },
      error: () => {
        this.groupPermMap.update((m) => ({
          ...m,
          [groupId]: {
            rows: [],
            totalDocuments: 0,
            numberOfPages: 0,
            currentPageIndex: 0,
            currentPageSize: 0,
          },
        }));
        this.groupPermLoading.update((m) => ({ ...m, [groupId]: false }));
      },
    });
  }

  onGroupPermPage(groupId: string, e: PageEvent): void {
    this.loadGroupPermPage(groupId, e.pageIndex);
  }

  groupPermPage(groupId: string): PrincipalPermissionPage | null {
    return this.groupPermMap()[groupId] ?? null;
  }

  isGroupPermLoading(groupId: string): boolean {
    return this.groupPermLoading()[groupId] === true;
  }

  openChangePassword(): void {
    const user = this.user();
    if (!user) return;
    this.dialog
      .open<ChangePasswordDialogComponent, ChangePasswordDialogData, string | undefined>(
        ChangePasswordDialogComponent,
        {
          width: '400px',
          data: { username: user.id },
        },
      )
      .afterClosed()
      .subscribe((newPassword) => {
        if (!newPassword) return;
        this.userService.updateUser(user.id, { password: newPassword }).subscribe({
          next: () => {
            this.snackBar.open(
              this.translate.instant('admin.message.password-updated'),
              this.translate.instant('common.dismiss'),
              { duration: 3000 },
            );
            this.load();
          },
          error: (e) =>
            this.snackBar.open(
              e?.error?.message ?? this.translate.instant('admin.message.password-update-failed'),
              this.translate.instant('common.dismiss'),
              {
                duration: 5000,
              },
            ),
        });
      });
  }

  openEdit(): void {
    const user = this.user();
    if (!user) return;
    this.dialog
      .open<UserFormDialogComponent, UserFormDialogData, UserFormDialogResult | undefined>(
        UserFormDialogComponent,
        {
          width: '480px',
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
              this.load();
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

  confirmDelete(): void {
    const user = this.user();
    if (!user) return;
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
            this.router.navigate(['/administration/users-groups']);
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

  removeGroup(groupId: string): void {
    const user = this.user();
    if (!user) return;
    const nextGroups = (user.properties.groups ?? []).filter((g) => g !== groupId);
    this.userService.updateUser(user.id, { groups: nextGroups }).subscribe({
      next: () => {
        this.snackBar.open(
          this.translate.instant('admin.message.group-removed-from-user'),
          this.translate.instant('common.dismiss'),
          { duration: 2500 },
        );
        this.load();
      },
      error: (e) =>
        this.snackBar.open(
          e?.error?.message ?? this.translate.instant('admin.message.could-not-update-user-groups'),
          this.translate.instant('common.dismiss'),
          {
            duration: 5000,
          },
        ),
    });
  }

  removePermission(row: PrincipalPermissionRow): void {
    this.documentDetail
      .removePermission(row.documentUid, {
        user: row.acePrincipal,
        permission: row.permission,
        acl: 'local',
      })
      .subscribe({
        next: () => {
          this.snackBar.open(
            this.translate.instant('admin.message.permission-removed'),
            this.translate.instant('common.dismiss'),
            { duration: 2500 },
          );
          this.loadLocalPerms();
          const u = this.user();
          if (u) this.loadAllGroupPerms(u);
        },
        error: (e) =>
          this.snackBar.open(
            e?.error?.message ??
              this.translate.instant('admin.message.could-not-remove-permission'),
            this.translate.instant('common.dismiss'),
            {
              duration: 5000,
            },
          ),
      });
  }

  timeFrameLabel(row: PrincipalPermissionRow): string {
    return principalPermissionTimeFrameLabel(
      row,
      (key) => this.translate.instant(key),
      this.locale,
    );
  }
}
