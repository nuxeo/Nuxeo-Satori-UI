import { Component, LOCALE_ID, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';

import {
  DocumentDetailService,
  NuxeoGroup,
  PrincipalPermissionPage,
  PrincipalPermissionRow,
  PrincipalPermissionsService,
  UserService,
  principalPermissionTimeFrameLabel,
} from '@nuxeo/satori-platform/nuxeo-client';

import { ConfirmDialogComponent, ConfirmDialogData } from '@nuxeo/satori-platform/ui';
import {
  GroupFormDialogComponent,
  GroupFormDialogData,
  GroupFormDialogResult,
} from '../group-form-dialog/group-form-dialog.component';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'lib-admin-group-details-page',
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
  templateUrl: './admin-group-details-page.component.html',
  styleUrl: './admin-group-details-page.component.scss',
})
export class AdminGroupDetailsPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly translate = inject(TranslateService);
  private readonly locale = inject(LOCALE_ID);
  private readonly router = inject(Router);
  private readonly userService = inject(UserService);
  private readonly permService = inject(PrincipalPermissionsService);
  private readonly documentDetail = inject(DocumentDetailService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  readonly group = signal<NuxeoGroup | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly userColumns = ['username', 'actions'] as const;
  readonly nestedColumns = ['groupname', 'actions'] as const;
  readonly permColumns = ['on', 'right', 'timeFrame', 'grantedBy', 'actions'] as const;

  readonly localPerm = signal<PrincipalPermissionPage | null>(null);
  readonly localPermLoading = signal(false);
  readonly localPageIndex = signal(0);
  readonly permPageSize = 10;

  private groupId = '';

  private resetState(): void {
    this.group.set(null);
    this.loading.set(false);
    this.error.set(null);
    this.localPerm.set(null);
    this.localPermLoading.set(false);
    this.localPageIndex.set(0);
  }

  ngOnInit(): void {
    this.route.paramMap.subscribe((paramMap) => {
      this.groupId = paramMap.get('groupId') ?? '';
      this.resetState();
      this.load();
    });
  }

  load(): void {
    if (!this.groupId) {
      this.error.set(this.translate.instant('admin.message.missing-group-id'));
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    this.userService.getGroup(this.groupId).subscribe({
      next: (group) => {
        this.group.set(group);
        this.loading.set(false);
        this.localPageIndex.set(0);
        this.loadLocalPerms();
      },
      error: (e) => {
        this.error.set(
          e?.error?.message ?? this.translate.instant('admin.message.could-not-load-group-details'),
        );
        this.loading.set(false);
      },
    });
  }

  openEdit(): void {
    const group = this.group();
    if (!group) return;
    this.dialog
      .open<GroupFormDialogComponent, GroupFormDialogData, GroupFormDialogResult | undefined>(
        GroupFormDialogComponent,
        {
          width: '480px',
          data: { mode: 'edit', group },
        },
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
    const group = this.group();
    if (!group) return;
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

  removeMember(userId: string): void {
    const group = this.group();
    if (!group) return;
    const nextMembers = (group.memberUsers ?? []).filter((id) => id !== userId);
    this.userService.updateGroup(group.groupname, { memberUsers: nextMembers }).subscribe({
      next: () => {
        this.snackBar.open(
          this.translate.instant('admin.message.member-removed'),
          this.translate.instant('common.dismiss'),
          { duration: 2500 },
        );
        this.load();
      },
      error: (e) =>
        this.snackBar.open(
          e?.error?.message ?? this.translate.instant('admin.message.could-not-remove-member'),
          this.translate.instant('common.dismiss'),
          {
            duration: 5000,
          },
        ),
    });
  }

  loadLocalPerms(): void {
    this.localPermLoading.set(true);
    this.permService
      .listLocalPermissionRows(this.groupId, this.permPageSize, this.localPageIndex())
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

  removeNestedGroup(nestedId: string): void {
    const group = this.group();
    if (!group) return;
    const next = (group.memberGroups ?? []).filter((id) => id !== nestedId);
    this.userService.updateGroup(group.groupname, { memberGroups: next }).subscribe({
      next: () => {
        this.snackBar.open(
          this.translate.instant('admin.message.nested-group-removed'),
          this.translate.instant('common.dismiss'),
          { duration: 2500 },
        );
        this.load();
      },
      error: (e) =>
        this.snackBar.open(
          e?.error?.message ??
            this.translate.instant('admin.message.could-not-update-nested-groups'),
          this.translate.instant('common.dismiss'),
          {
            duration: 5000,
          },
        ),
    });
  }
}
