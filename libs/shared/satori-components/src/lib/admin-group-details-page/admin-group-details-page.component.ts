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
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, type PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { filter, switchMap } from 'rxjs';

import {
  DocumentDetailService,
  principalPermissionTimeFrameLabel,
  PrincipalPermissionsService,
  type NuxeoGroup,
  type PrincipalPermissionPage,
  type PrincipalPermissionRow,
  UserService,
} from '@nuxeo/satori-platform/nuxeo-client';

import {
  NxsConfirmDialogComponent,
  type NxsConfirmDialogData,
} from '../confirm-dialog/confirm-dialog.component';
import {
  NxsGroupFormDialogComponent,
  type NxsGroupFormDialogData,
  type NxsGroupFormDialogResult,
} from '../group-form-dialog/group-form-dialog.component';

/** Permission rows per page, in the permissions table. */
const PERMISSIONS_PAGE_SIZE = 10;

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

/**
 * One group: its label, members, nested groups, and the permissions it holds. An administrator edits
 * the group, removes members or nested groups, or deletes the group from here.
 *
 * It does not navigate. A deletion emits `deleted` so the host can return to the list, and choosing a
 * member, a nested group or a document emits its id for the host to route to.
 */
/** The ID the host renders this page under, through `lib-extension-outlet`. */
export const NXS_ADMIN_GROUP_DETAILS_PAGE_ID = 'nxs.components.adminGroupDetailsPage';

@Component({
  selector: 'nxs-admin-group-details-page',
  standalone: true,
  templateUrl: './admin-group-details-page.component.html',
  styleUrl: './admin-group-details-page.component.scss',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatPaginatorModule,
    MatProgressSpinnerModule,
    MatTableModule,
    MatTooltipModule,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-admin-group-details-page' },
})
export class NxsAdminGroupDetailsPageComponent {
  private readonly userService = inject(UserService);
  private readonly permissions = inject(PrincipalPermissionsService);
  private readonly documentDetail = inject(DocumentDetailService);
  private readonly dialog = inject(MatDialog);
  private readonly translate = inject(TranslateService);
  private readonly locale = inject(LOCALE_ID);
  private readonly destroyRef = inject(DestroyRef);

  /** The group name to show. Changing it loads that group. */
  readonly groupId = input.required<string>();
  /** Called once the group is deleted, so the host can return to the list. */
  readonly deleted = input<() => void>(() => undefined);
  /** Called with the username when a member is chosen. */
  readonly userChosen = input<(username: string) => void>(() => undefined);
  /** Called with the group name when a nested group is chosen. */
  readonly groupChosen = input<(groupname: string) => void>(() => undefined);
  /** Called with the document id when a permission's document is chosen. */
  readonly documentChosen = input<(documentId: string) => void>(() => undefined);

  protected readonly memberColumns = ['username', 'actions'] as const;
  protected readonly nestedColumns = ['groupname', 'actions'] as const;
  protected readonly permissionColumns = [
    'on',
    'right',
    'timeFrame',
    'grantedBy',
    'actions',
  ] as const;
  protected readonly pageSize = PERMISSIONS_PAGE_SIZE;

  protected readonly group = signal<NuxeoGroup | null>(null);
  protected readonly loading = signal(false);
  protected readonly loadFailed = signal(false);
  protected readonly status = signal<Status | null>(null);
  protected readonly permissionsPage = signal<PrincipalPermissionPage>(EMPTY_PAGE);
  protected readonly permissionsLoading = signal(false);
  protected readonly permissionsIndex = signal(0);

  constructor() {
    effect(() => {
      const id = this.groupId();
      untracked(() => this.load(id));
    });
  }

  private load(id: string): void {
    this.loading.set(true);
    this.loadFailed.set(false);
    this.userService
      .getGroup(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (group) => {
          this.group.set(group);
          this.loading.set(false);
          this.permissionsIndex.set(0);
          this.loadPermissions(id);
        },
        error: () => {
          this.group.set(null);
          this.loadFailed.set(true);
          this.loading.set(false);
        },
      });
  }

  private loadPermissions(principal: string): void {
    this.permissionsLoading.set(true);
    this.permissions
      .listLocalPermissionRows(principal, PERMISSIONS_PAGE_SIZE, this.permissionsIndex())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (page) => {
          this.permissionsPage.set(page);
          this.permissionsLoading.set(false);
        },
        error: () => {
          this.permissionsPage.set(EMPTY_PAGE);
          this.permissionsLoading.set(false);
        },
      });
  }

  protected onPermissionsPage(event: PageEvent): void {
    this.permissionsIndex.set(event.pageIndex);
    this.loadPermissions(this.groupId());
  }

  protected edit(): void {
    const group = this.group();
    if (!group) return;
    this.dialog
      .open<
        NxsGroupFormDialogComponent,
        NxsGroupFormDialogData,
        NxsGroupFormDialogResult | undefined
      >(NxsGroupFormDialogComponent, { width: '480px', data: { mode: 'edit', group } })
      .afterClosed()
      .pipe(
        filter((result): result is NxsGroupFormDialogResult => !!result && result.mode === 'edit'),
        switchMap((result) =>
          this.userService.updateGroup(group.groupname, {
            grouplabel: result.grouplabel,
            memberUsers: [...result.memberUsers],
          }),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => this.finish('satori-components.admin-group-details-page.group-saved', false),
        error: () => this.finish('satori-components.admin-group-details-page.update-failed', true),
      });
  }

  protected deleteGroup(): void {
    const group = this.group();
    if (!group) return;
    this.confirm(group.groupname)
      .pipe(
        switchMap(() => this.userService.deleteGroup(group.groupname)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => this.deleted()(),
        error: () => this.finish('satori-components.admin-group-details-page.delete-failed', true),
      });
  }

  protected removeMember(userId: string): void {
    const group = this.group();
    if (!group) return;
    const remaining = (group.memberUsers ?? []).filter((id) => id !== userId);
    this.userService
      .updateGroup(group.groupname, { memberUsers: remaining })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.finish('satori-components.admin-group-details-page.member-removed', false),
        error: () =>
          this.finish('satori-components.admin-group-details-page.could-not-remove-member', true),
      });
  }

  protected removeNestedGroup(nestedId: string): void {
    const group = this.group();
    if (!group) return;
    const remaining = (group.memberGroups ?? []).filter((id) => id !== nestedId);
    this.userService
      .updateGroup(group.groupname, { memberGroups: remaining })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () =>
          this.finish('satori-components.admin-group-details-page.nested-group-removed', false),
        error: () =>
          this.finish('satori-components.admin-group-details-page.could-not-update-nested', true),
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
          this.status.set({
            text: 'satori-components.admin-group-details-page.permission-removed',
            error: false,
          });
          this.loadPermissions(this.groupId());
        },
        error: () =>
          this.finish(
            'satori-components.admin-group-details-page.could-not-remove-permission',
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

  private confirm(groupname: string) {
    const data: NxsConfirmDialogData = {
      title: this.translate.instant('satori-components.admin-group-details-page.delete-group'),
      message: this.translate.instant(
        'satori-components.admin-group-details-page.delete-group-named',
        {
          name: groupname,
        },
      ),
      confirmLabel: this.translate.instant('satori-components.admin-group-details-page.delete'),
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

  /** Reports the outcome on the status line, and reloads the group so the page shows the change. */
  private finish(text: string, error: boolean): void {
    this.status.set({ text, error });
    if (!error) {
      this.load(this.groupId());
    }
  }
}
