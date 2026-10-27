import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  LOCALE_ID,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgTemplateOutlet } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, type PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { catchError, filter, forkJoin, of, switchMap } from 'rxjs';

import {
  DocumentDetailService,
  principalPermissionTimeFrameLabel,
  PrincipalPermissionsService,
  type NuxeoGroup,
  type NuxeoUser,
  type PrincipalPermissionPage,
  type PrincipalPermissionRow,
  UserService,
} from '@nuxeo/satori-platform/nuxeo-client';

import {
  NxsChangePasswordDialogComponent,
  type NxsChangePasswordDialogData,
} from '../change-password-dialog/change-password-dialog.component';
import {
  NxsConfirmDialogComponent,
  type NxsConfirmDialogData,
} from '../confirm-dialog/confirm-dialog.component';
import {
  NxsUserFormDialogComponent,
  type NxsUserFormDialogData,
  type NxsUserFormDialogResult,
} from '../user-form-dialog/user-form-dialog.component';

/** Permission rows per page, in each permissions table. */
const PERMISSIONS_PAGE_SIZE = 10;

/** A group the user belongs to, with the label Nuxeo gives it. */
interface MemberGroup {
  readonly id: string;
  readonly label: string;
}

/** A status line message: a translation key, and whether it reports a refusal. */
interface Status {
  readonly text: string;
  readonly error: boolean;
}

const EMPTY_PAGE: PrincipalPermissionPage = {
  rows: [],
  totalDocuments: 0,
  numberOfPages: 0,
  currentPageIndex: 0,
  currentPageSize: 0,
};

/** The ID the host renders this page under, through `lib-extension-outlet`. */
export const NXS_ADMIN_USER_DETAILS_PAGE_ID = 'nxs.components.adminUserDetailsPage';

/**
 * One user's profile: their details, groups, and the permissions they hold directly and through each
 * group. An administrator edits, changes the password of, removes from groups, or deletes the user here.
 *
 * It does not navigate. A deletion calls `deleted` so the host can return to the list, and choosing a
 * group or a document calls its callback with the id for the host to route to. Outcomes appear on a status line that stays
 * until the next action.
 */
@Component({
  selector: 'nxs-admin-user-details-page',
  standalone: true,
  templateUrl: './admin-user-details-page.component.html',
  styleUrl: './admin-user-details-page.component.scss',
  imports: [
    MatButtonModule,
    NgTemplateOutlet,
    MatIconModule,
    MatPaginatorModule,
    MatProgressSpinnerModule,
    MatTableModule,
    MatTooltipModule,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-admin-user-details-page' },
})
export class NxsAdminUserDetailsPageComponent {
  private readonly userService = inject(UserService);
  private readonly permissions = inject(PrincipalPermissionsService);
  private readonly documentDetail = inject(DocumentDetailService);
  private readonly dialog = inject(MatDialog);
  private readonly translate = inject(TranslateService);
  private readonly locale = inject(LOCALE_ID);
  private readonly destroyRef = inject(DestroyRef);

  /** The username to show. Changing it loads that user. */
  readonly userId = input.required<string>();
  /** Called once the user is deleted, so the host can return to the list. */
  readonly deleted = input<() => void>(() => undefined);
  /** Called with the group name when a group is chosen. */
  readonly groupChosen = input<(groupname: string) => void>(() => undefined);
  /** Called with the document id when a permission's document is chosen. */
  readonly documentChosen = input<(documentId: string) => void>(() => undefined);

  protected readonly permissionColumns = [
    'on',
    'right',
    'timeFrame',
    'grantedBy',
    'actions',
  ] as const;
  protected readonly groupColumns = ['name', 'identifier', 'actions'] as const;
  protected readonly pageSize = PERMISSIONS_PAGE_SIZE;

  protected readonly user = signal<NuxeoUser | null>(null);
  protected readonly loading = signal(false);
  protected readonly loadFailed = signal(false);
  protected readonly status = signal<Status | null>(null);
  protected readonly groups = signal<MemberGroup[]>([]);
  protected readonly localPermissions = signal<PrincipalPermissionPage>(EMPTY_PAGE);
  protected readonly localPermissionsLoading = signal(false);
  protected readonly localPage = signal(0);
  protected readonly groupPermissions = signal<Record<string, PrincipalPermissionPage>>({});
  protected readonly groupPermissionsLoading = signal<Record<string, boolean>>({});

  constructor() {
    effect(() => {
      const id = this.userId();
      untracked(() => this.load(id));
    });
  }

  /** Loads the user, then the groups and their permissions. */
  private load(id: string): void {
    this.loading.set(true);
    this.loadFailed.set(false);
    this.userService
      .getUser(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (user) => {
          this.user.set(user);
          this.loading.set(false);
          this.loadGroups(user);
          this.localPage.set(0);
          this.loadLocalPermissions(id);
          this.loadGroupPermissions(user);
        },
        error: () => {
          this.user.set(null);
          this.loadFailed.set(true);
          this.loading.set(false);
        },
      });
  }

  private loadGroups(user: NuxeoUser): void {
    const ids = user.properties.groups ?? [];
    if (ids.length === 0) {
      this.groups.set([]);
      return;
    }
    forkJoin(
      ids.map((id) =>
        this.userService.getGroup(id).pipe(catchError(() => of<NuxeoGroup | null>(null))),
      ),
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((found) => {
        this.groups.set(ids.map((id, i) => ({ id, label: found[i]?.grouplabel ?? id })));
      });
  }

  private loadLocalPermissions(principal: string): void {
    this.localPermissionsLoading.set(true);
    this.permissions
      .listLocalPermissionRows(principal, PERMISSIONS_PAGE_SIZE, this.localPage())
      .pipe(
        catchError(() => of(EMPTY_PAGE)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((page) => {
        this.localPermissions.set(page);
        this.localPermissionsLoading.set(false);
      });
  }

  private loadGroupPermissions(user: NuxeoUser): void {
    const ids = user.properties.groups ?? [];
    this.groupPermissions.set({});
    this.groupPermissionsLoading.set(Object.fromEntries(ids.map((id) => [id, true])));
    ids.forEach((id) => this.loadGroupPermissionPage(id, 0));
  }

  private loadGroupPermissionPage(groupId: string, pageIndex: number): void {
    this.groupPermissionsLoading.update((m) => ({ ...m, [groupId]: true }));
    this.permissions
      .listLocalPermissionRows(groupId, PERMISSIONS_PAGE_SIZE, pageIndex)
      .pipe(
        catchError(() => of(EMPTY_PAGE)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((page) => {
        this.groupPermissions.update((m) => ({ ...m, [groupId]: page }));
        this.groupPermissionsLoading.update((m) => ({ ...m, [groupId]: false }));
      });
  }

  /** Turns to another page of one permissions table: the direct ones when `groupId` is null. */
  protected pageChanged(groupId: string | null, event: PageEvent): void {
    if (groupId === null) {
      this.localPage.set(event.pageIndex);
      this.loadLocalPermissions(this.userId());
    } else {
      this.loadGroupPermissionPage(groupId, event.pageIndex);
    }
  }

  protected changePassword(): void {
    const user = this.user();
    if (!user) return;
    this.dialog
      .open<NxsChangePasswordDialogComponent, NxsChangePasswordDialogData, string | undefined>(
        NxsChangePasswordDialogComponent,
        { width: '400px', data: { username: user.id } },
      )
      .afterClosed()
      .pipe(
        filter((password): password is string => !!password),
        switchMap((password) => this.userService.updateUser(user.id, { password })),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () =>
          this.finish('satori-components.admin-user-details-page.password-updated', false),
        error: () =>
          this.finish('satori-components.admin-user-details-page.password-update-failed', true),
      });
  }

  protected edit(): void {
    const user = this.user();
    if (!user) return;
    this.dialog
      .open<NxsUserFormDialogComponent, NxsUserFormDialogData, NxsUserFormDialogResult | undefined>(
        NxsUserFormDialogComponent,
        { width: '480px', maxHeight: '90vh', data: { mode: 'edit', user } },
      )
      .afterClosed()
      .pipe(
        filter((result): result is NxsUserFormDialogResult => !!result && result.mode === 'edit'),
        switchMap((result) =>
          this.userService.updateUser(user.id, {
            firstName: result.firstName,
            lastName: result.lastName,
            company: result.company,
            email: result.email,
            password: result.password,
            groups: [...result.groups],
          }),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => this.finish('satori-components.admin-user-details-page.user-updated', false),
        error: () => this.finish('satori-components.admin-user-details-page.update-failed', true),
      });
  }

  protected deleteUser(): void {
    const user = this.user();
    if (!user) return;
    this.confirm(user.id)
      .pipe(
        switchMap(() => this.userService.deleteUser(user.id)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => this.deleted()(),
        error: () => this.finish('satori-components.admin-user-details-page.delete-failed', true),
      });
  }

  /** Takes the user out of one group, by sending the groups that remain. */
  protected removeFromGroup(groupId: string): void {
    const user = this.user();
    if (!user) return;
    const remaining = (user.properties.groups ?? []).filter((id) => id !== groupId);
    this.userService
      .updateUser(user.id, { groups: remaining })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () =>
          this.finish('satori-components.admin-user-details-page.removed-from-group', false),
        error: () =>
          this.finish('satori-components.admin-user-details-page.could-not-update-groups', true),
      });
  }

  protected removePermission(row: PrincipalPermissionRow): void {
    this.documentDetail
      .removePermission(row.documentUid, {
        user: row.acePrincipal,
        permission: row.permission,
        acl: 'local',
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          // Reloads each table once, on the page it is showing. `finish` would also reload the
          // user and reset the direct permissions to their first page.
          this.status.set({
            text: 'satori-components.admin-user-details-page.permission-removed',
            error: false,
          });
          this.loadLocalPermissions(this.userId());
          const user = this.user();
          if (user) this.loadGroupPermissions(user);
        },
        error: () =>
          this.finish(
            'satori-components.admin-user-details-page.could-not-remove-permission',
            true,
          ),
      });
  }

  protected timeFrame(row: PrincipalPermissionRow): string {
    return principalPermissionTimeFrameLabel(
      row,
      (key) => this.translate.instant(key),
      this.locale,
    );
  }

  protected groupPermissionsOf(groupId: string): PrincipalPermissionPage {
    return this.groupPermissions()[groupId] ?? EMPTY_PAGE;
  }

  private confirm(username: string) {
    const data: NxsConfirmDialogData = {
      title: this.translate.instant('satori-components.admin-user-details-page.delete-user'),
      message: this.translate.instant(
        'satori-components.admin-user-details-page.delete-user-named',
        { name: username },
      ),
      confirmLabel: this.translate.instant('satori-components.admin-user-details-page.delete'),
    };
    return this.dialog
      .open<NxsConfirmDialogComponent, NxsConfirmDialogData, true | undefined>(
        NxsConfirmDialogComponent,
        {
          width: '400px',
          data,
        },
      )
      .afterClosed()
      .pipe(filter((ok): ok is true => ok === true));
  }

  /** Reports the outcome on the status line, and reloads the user so the page shows the change. */
  private finish(text: string, error: boolean): void {
    this.status.set({ text, error });
    if (!error) {
      this.load(this.userId());
    }
  }
}
