import {
  Component,
  DestroyRef,
  inject,
  OnInit,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { catchError, finalize, of, forkJoin, map, switchMap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  CURRENT_USERNAME,
  UserService,
  DocumentDetailService,
  permissionRightLabel,
  type NuxeoUser,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';
import {
  ShareSavedSearchAddPermissionDialogComponent,
  type ShareSavedSearchAddPermissionDialogData,
  type ShareSavedSearchAddPermissionResult,
} from '../share-saved-search-add-permission-dialog/share-saved-search-add-permission-dialog.component';
import { ShareSavedSearchExternalDialogComponent } from '../share-saved-search-external-dialog/share-saved-search-external-dialog.component';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { NxsSpinnerComponent } from '@nuxeo/satori-platform/components';

export interface PermissionEntry {
  id: string;
  /** Nuxeo's id for the ACE the row shows; absent for a row not read from the ACL. */
  aceId?: string;
  userGroup: string;
  right: string;
  timeFrame: string;
  grantedBy: string;
  /** The ACE's own instants, so an edit that leaves the dates alone can write them back. */
  begin?: string | null;
  end?: string | null;
  /**
   * Whether the entry grants or denies. `Document.ReplacePermission` only ever writes a grant, so
   * a deny must never be editable: submitting one unchanged would invert it.
   */
  granted?: boolean;
}

interface PermissionSummary {
  userGroup: string;
  right: string;
  timeFrame: string;
  grantedBy: string;
}

interface ExternalPermissionEntry extends PermissionSummary {
  id: string;
  aceId?: string;
  email: string;
  begin?: string | null;
  end?: string | null;
}

interface AceLike {
  id?: string;
  username?: string;
  email?: string;
  permission?: string;
  creator?: string;
  externalUser?: boolean;
  begin?: string | null;
  end?: string | null;
  /** Absent means granted; Nuxeo sends `false` only for a deny. */
  granted?: boolean;
}

/**
 * Nuxeo's inheritance-blocking marker: a deny-`Everything` ACE for `Everyone`.
 *
 * The same predicate as `isInheritanceMarker` in `nxs-permissions-panel`, which is internal to
 * `satori-components`; exporting it to share three comparisons would add a customer-visible export.
 */
function isInheritanceMarker(ace: AceLike): boolean {
  const principal = (ace.username ?? '').replace(/^group:/, '');
  return principal === 'Everyone' && ace.permission === 'Everything' && ace.granted === false;
}

export interface ShareSavedSearchDialogData {
  title: string;
  id: string;
}

@Component({
  selector: 'lib-share-saved-search-dialog',
  standalone: true,
  imports: [
    NxsSpinnerComponent,
    TranslatePipe,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatSelectModule,
  ],
  templateUrl: './share-saved-search-dialog.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './share-saved-search-dialog.component.scss',
})
export class ShareSavedSearchDialogComponent implements OnInit {
  private readonly translate = inject(TranslateService);
  readonly dialogRef = inject(
    MatDialogRef<ShareSavedSearchDialogComponent, PermissionEntry[] | null>,
  );
  readonly data = inject<ShareSavedSearchDialogData>(MAT_DIALOG_DATA);
  private readonly dialog = inject(MatDialog);
  private readonly currentUsername = inject(CURRENT_USERNAME);
  private readonly userService = inject(UserService);
  private readonly detailService = inject(DocumentDetailService);
  private readonly destroyRef = inject(DestroyRef);

  readonly permissions = signal<PermissionEntry[]>([]);
  readonly inheritedPermissions = signal<PermissionSummary[]>([]);
  readonly externalPermissions = signal<ExternalPermissionEntry[]>([]);
  readonly isInheritanceBlocked = signal(false);
  /** The saved search's `userVisiblePermissions`, the rights the add and edit dialogs offer. */
  private readonly visiblePermissions = signal<readonly string[] | null>(null);
  readonly saving = signal(false);
  readonly loading = signal(false);

  private nextId = 1;

  ngOnInit(): void {
    if (this.data.id) {
      this.loadPermissionsFromApi();
    } else {
      this.loadPermissionsFromCurrentUser();
    }
  }

  private loadPermissionsFromApi(): void {
    this.loading.set(true);
    this.detailService
      .getDocumentPermissions(this.data.id)
      .pipe(catchError(() => of(null)))
      .subscribe((doc) => {
        this.loading.set(false);
        if (!doc) {
          this.loadPermissionsFromCurrentUser();
          return;
        }
        this.parsePermissionsFromDocument(doc);
      });
  }

  private parsePermissionsFromDocument(doc: NuxeoDocument): void {
    const visible = doc.contextParameters?.['userVisiblePermissions'];
    this.visiblePermissions.set(Array.isArray(visible) ? (visible as string[]) : null);
    const allAcls = ((doc.contextParameters?.acls as unknown) ?? []) as Array<{
      name: string;
      aces: AceLike[];
    }>;

    // Find local ACL (usually first or named 'local')
    const localAcl = allAcls.find((acl) => acl.name === 'local') || allAcls[0];
    const localAces = localAcl?.aces ?? [];

    const localRows = this.localRowsOf(localAces);

    const externalRows: ExternalPermissionEntry[] = localAces
      .filter((ace) => !!ace.externalUser)
      .map((ace, index) => ({
        id: ace.id || `external-${index}`,
        aceId: ace.id,
        email: ace.email || ace.username || '',
        userGroup: ace.email || ace.username || 'Unknown',
        right: ace.permission || 'Read',
        timeFrame: this.toTimeFrameLabel(ace.begin, ace.end),
        grantedBy: ace.creator || 'System',
        begin: ace.begin,
        end: ace.end,
      }));

    // Find inherited ACLs
    const inheritedAcls = allAcls.filter((acl) => acl.name !== 'local');
    this.isInheritanceBlocked.set(!allAcls.some((acl) => acl.name === 'inherited'));
    const inheritedRows: PermissionSummary[] = inheritedAcls
      .flatMap((acl) => acl.aces ?? [])
      .map((ace) => ({
        userGroup: ace.username || ace.email || 'Unknown',
        right: ace.permission || 'Read',
        timeFrame: 'Inherited',
        grantedBy: ace.creator || 'Parent',
      }));

    this.permissions.set(localRows);
    this.externalPermissions.set(externalRows);
    this.inheritedPermissions.set(inheritedRows);
    this.nextId = localRows.length + 1;
  }

  private localRowsOf(aces: readonly AceLike[]): PermissionEntry[] {
    return (
      aces
        .filter((ace) => !ace.externalUser)
        // Blocked inheritance is not a flag in Nuxeo: it is a deny-`Everything` ACE for `Everyone`,
        // which `isInheritanceBlocked` already represents and the toggle maintains. Listed as an
        // ordinary row it was editable, and `Document.ReplacePermission` writes a grant — so
        // submitting it unchanged would have granted Everyone full access.
        .filter((ace) => !isInheritanceMarker(ace))
        .map((ace, index: number) => ({
          // The ACE id, not the position: a re-read must not move an open edit onto another row.
          id: ace.id || `local-${index}`,
          aceId: ace.id,
          userGroup: ace.username || ace.email || 'Unknown',
          right: ace.permission || 'Read',
          timeFrame: this.toTimeFrameLabel(ace.begin, ace.end),
          grantedBy: ace.creator || 'System',
          begin: ace.begin,
          end: ace.end,
          granted: ace.granted !== false,
        }))
    );
  }

  /**
   * Replaces the local rows with the server's, keeping the unsaved edit of any row whose entry is
   * still there. Nuxeo answers 200 to removing an id it no longer holds, so only a re-read shows
   * whether a removal took.
   */
  private reconcileLocalRows(doc: NuxeoDocument): void {
    const acls = ((doc.contextParameters?.acls as unknown) ?? []) as Array<{
      name: string;
      aces: AceLike[];
    }>;
    const local = acls.find((acl) => acl.name === 'local') || acls[0];
    const shown = new Map(
      this.permissions()
        .filter((row) => row.aceId)
        .map((row) => [row.aceId, row]),
    );
    const rows = this.localRowsOf(local?.aces ?? []).map(
      (row) => (row.aceId ? shown.get(row.aceId) : undefined) ?? row,
    );
    this.permissions.set(rows);
    this.nextId = rows.length + 1;
  }

  openExternalPermissionDialog(): void {
    if (!this.data.id || this.saving()) return;

    this.dialog
      .open<ShareSavedSearchExternalDialogComponent, { savedSearchId: string }, boolean>(
        ShareSavedSearchExternalDialogComponent,
        {
          width: '720px',
          data: { savedSearchId: this.data.id },
        },
      )
      .afterClosed()
      .subscribe((created) => {
        if (!created) return;
        this.loadPermissionsFromApi();
      });
  }

  editExternalPermission(row: ExternalPermissionEntry): void {
    if (!this.data.id || this.saving()) return;

    this.dialog
      .open<
        ShareSavedSearchExternalDialogComponent,
        {
          savedSearchId: string;
          initialData: {
            id: string;
            email: string;
            right: string;
            begin?: string | null;
            end?: string | null;
          };
        },
        boolean
      >(ShareSavedSearchExternalDialogComponent, {
        width: '720px',
        data: {
          savedSearchId: this.data.id,
          initialData: {
            id: row.id,
            email: row.email,
            right: row.right,
            begin: row.begin,
            end: row.end,
          },
        },
      })
      .afterClosed()
      .subscribe((updated) => {
        if (!updated) return;
        this.loadPermissionsFromApi();
      });
  }

  sendExternalNotification(row: ExternalPermissionEntry): void {
    if (!this.data.id || this.saving() || !row.id) return;

    this.saving.set(true);
    this.detailService
      .sendNotificationEmailForPermission(this.data.id, row.id)
      .pipe(
        catchError((error) => {
          console.error('Error sending permission notification:', error);
          this.saving.set(false);
          return of(null);
        }),
      )
      .subscribe(() => {
        this.saving.set(false);
      });
  }

  removeExternalPermission(row: ExternalPermissionEntry): void {
    // By id: removing by user would also take every other entry the same address holds.
    if (!this.data.id || this.saving() || !row.aceId) return;

    this.saving.set(true);
    this.detailService
      .removePermissionById(this.data.id, row.aceId)
      .pipe(
        catchError((error) => {
          console.error('Error removing external permission:', error);
          this.saving.set(false);
          return of(null);
        }),
      )
      .subscribe((result) => {
        this.saving.set(false);
        if (!result) return;
        this.loadPermissionsFromApi();
      });
  }

  togglePermissionInheritance(): void {
    if (!this.data.id || this.saving()) return;

    this.saving.set(true);
    const op = this.isInheritanceBlocked()
      ? this.detailService.unblockPermissionInheritance(this.data.id)
      : this.detailService.blockPermissionInheritance(this.data.id);

    op.pipe(
      catchError((error) => {
        console.error('Error updating permission inheritance:', error);
        this.saving.set(false);
        return of(null);
      }),
    ).subscribe((result) => {
      this.saving.set(false);
      if (!result) return;
      this.loadPermissionsFromApi();
    });
  }

  private loadPermissionsFromCurrentUser(): void {
    const username = this.currentUsername()?.trim();
    if (!username) {
      this.permissions.set([]);
      this.inheritedPermissions.set([]);
      return;
    }

    this.userService
      .getUser(username)
      .pipe(catchError(() => of(null)))
      .subscribe((user) => {
        if (!user) {
          this.permissions.set([]);
          this.inheritedPermissions.set([]);
          return;
        }

        this.applyUserPermissions(user);
      });
  }

  private applyUserPermissions(user: NuxeoUser): void {
    const localRows: PermissionEntry[] = [
      {
        id: String(this.nextId++),
        userGroup: this.toDisplayName(user),
        // A permission identifier, not its label: `right` is also what an edit round-trips and
        // what `save()` writes, so a label here could not be told from a permission (NXSAT-334).
        // The table renders it through `permissionLabel`, so it still reads "Manage everything".
        right: user.isAdministrator ? 'Everything' : 'Read',
        timeFrame: 'Permanent',
        grantedBy: 'System',
      },
    ];

    const groups = user.properties.groups ?? [];
    groups.forEach((group) => {
      localRows.push({
        id: String(this.nextId++),
        userGroup: group,
        right: 'Read',
        timeFrame: 'Permanent',
        grantedBy: 'Group',
      });
    });

    this.permissions.set(localRows);
    this.inheritedPermissions.set(
      groups.map((group) => ({
        userGroup: group,
        right: 'Inherited',
        timeFrame: 'Permanent',
        grantedBy: 'Parent',
      })),
    );
  }

  /**
   * A permission as a person reads it. This table rendered `row.right` raw, so it alone showed
   * Nuxeo identifiers — `ReadWrite`, `WriteSecurity` — in every locale, which is what made storing
   * an English label in `right` look reasonable. The document, collection and browse tables all go
   * through this helper; an unlabelled permission still shows its identifier, as Web UI's does.
   */
  /**
   * Whether a row may be edited: it has to exist on the server, and it has to be a grant.
   *
   * Nuxeo's write operations only grant, so there is no way to replace a deny without inverting
   * it. Hiding the control is not the control — `editRow` checks this too, and the server checks
   * every write regardless.
   */
  protected isEditable(row: PermissionEntry): boolean {
    return !!row.aceId && row.granted !== false;
  }

  protected permissionLabel(permission: string): string {
    return permissionRightLabel(permission, (key) => this.translate.instant(key));
  }

  private toDisplayName(user: NuxeoUser): string {
    const firstName = user.properties.firstName?.trim() ?? '';
    const lastName = user.properties.lastName?.trim() ?? '';
    const fullName = `${firstName} ${lastName}`.trim();
    if (fullName) return fullName;
    return user.properties.username || user.id;
  }

  openAddPermissionDialog(): void {
    this.dialog
      .open<
        ShareSavedSearchAddPermissionDialogComponent,
        ShareSavedSearchAddPermissionDialogData,
        ShareSavedSearchAddPermissionResult[] | null
      >(ShareSavedSearchAddPermissionDialogComponent, {
        width: '720px',
        data: {
          title: this.translate.instant('confirm.add-a-permission'),
          permissions: this.visiblePermissions(),
        },
      })
      .afterClosed()
      .subscribe((result) => {
        if (!result || result.length === 0 || !this.data.id) return;

        this.saving.set(true);

        // The dialog returns the server's own identifiers, so they are sent as they are: the
        // display-label mapping would turn `Write` into the broader `ReadWrite`.
        const requests = result.map((entry) =>
          this.detailService.addPermission(this.data.id, {
            username: entry.userGroup,
            permission: entry.right,
            // The dialog's own resolved values, rather than its rendered label parsed back.
            begin: entry.begin,
            end: entry.end,
            // The dialog asks whether to notify, so the answer is honoured rather than dropped.
            notify: entry.notify,
            comment: entry.comment ?? '',
          }),
        );

        forkJoin(requests)
          .pipe(
            catchError((error) => {
              console.error('Error adding permissions:', error);
              this.saving.set(false);
              return of(null);
            }),
          )
          .subscribe(() => {
            this.saving.set(false);
            // Refresh permissions from API after adding
            this.loadPermissionsFromApi();
          });
      });
  }

  removeRow(id: string): void {
    const row = this.permissions().find((r) => r.id === id);
    // By id: removing by user would also take every other entry that user or group holds.
    // One removal and its re-read at a time, so an older read cannot restore a later removal.
    if (!row || !this.data.id || !row.aceId || this.saving()) return;

    // Remove from local state first
    this.permissions.update((rows) => rows.filter((r) => r.id !== id));

    const uid = this.data.id;
    this.saving.set(true);
    this.detailService
      .removePermissionById(uid, row.aceId)
      .pipe(
        map(() => true),
        catchError((error) => {
          console.error('Error removing permission:', error);
          // Revert the removal on error
          this.permissions.update((rows) => [...rows, row]);
          return of(false);
        }),
        switchMap((removed) =>
          !removed
            ? of(null)
            : this.detailService.getDocumentPermissions(uid).pipe(
                catchError((error) => {
                  console.error('Error re-reading permissions after a removal:', error);
                  return of(null);
                }),
              ),
        ),
        finalize(() => this.saving.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((doc) => {
        if (doc) this.reconcileLocalRows(doc);
      });
  }

  editRow(id: string): void {
    const row = this.permissions().find((r) => r.id === id);
    // Not while a write or its re-read is in flight: the ACL is mid-change, and submitting into it
    // used to be dropped by the guard below without telling anyone. The button is disabled too.
    // Never a deny entry: `Document.ReplacePermission` writes a grant, so an edit would invert it.
    // `nxs-permissions-panel` refuses the same thing (`refusalsFor`, reason `deny-entry`).
    if (!row || this.saving() || !this.isEditable(row)) return;

    this.dialog
      .open<
        ShareSavedSearchAddPermissionDialogComponent,
        ShareSavedSearchAddPermissionDialogData,
        ShareSavedSearchAddPermissionResult[] | null
      >(ShareSavedSearchAddPermissionDialogComponent, {
        width: '720px',
        data: {
          title: this.translate.instant('confirm.update'),
          initialData: row,
          permissions: this.visiblePermissions(),
        },
      })
      .afterClosed()
      .subscribe((result) => {
        if (!result || result.length === 0 || !this.data.id || !row.aceId || this.saving()) return;

        const updatedEntry = result[0];
        const uid = this.data.id;
        // Show the edit at once, then let the re-read below replace it with the server's own row.
        this.permissions.update((rows) =>
          rows.map((r) =>
            r.id === id
              ? {
                  ...r,
                  userGroup: updatedEntry.userGroup,
                  right: updatedEntry.right,
                  timeFrame: updatedEntry.timeFrame,
                  grantedBy: updatedEntry.grantedBy,
                }
              : r,
          ),
        );

        this.saving.set(true);
        this.detailService
          .replacePermission(uid, {
            id: row.aceId,
            username: row.userGroup,
            // The dialog returns the server's own identifier, written as it is: the display-label
            // mapping would turn `Write` into the broader `ReadWrite` (NXSAT-334).
            permission: updatedEntry.right,
            // Already resolved by the dialog: a day the user picked, or this entry's own instant
            // where they left it alone. Reading them back out of the rendered `timeFrame` only
            // worked in English, and cleared a one-sided range in every other locale.
            begin: updatedEntry.begin,
            end: updatedEntry.end,
            notify: updatedEntry.notify,
            comment: updatedEntry.comment,
          })
          .pipe(
            map(() => true),
            catchError((error) => {
              console.error('Error updating permission:', error);
              // Put the row back as the server last showed it.
              this.permissions.update((rows) => rows.map((r) => (r.id === id ? row : r)));
              return of(false);
            }),
            // `replaced` has to reach the subscriber: a write that never happened and a write
            // whose re-read failed both arrive with no document, but only the second one leaves
            // the row's ACE id stale.
            switchMap((replaced) =>
              !replaced
                ? of({ replaced, doc: null as NuxeoDocument | null })
                : this.detailService.getDocumentPermissions(uid).pipe(
                    map((doc) => ({ replaced, doc: doc as NuxeoDocument | null })),
                    catchError((error) => {
                      console.error('Error re-reading permissions after an update:', error);
                      return of({ replaced, doc: null as NuxeoDocument | null });
                    }),
                  ),
            ),
            finalize(() => this.saving.set(false)),
            takeUntilDestroyed(this.destroyRef),
          )
          .subscribe(({ replaced, doc }) => {
            // Nuxeo answers 200 to replacing an id it no longer holds and changes nothing, so only
            // the re-read shows what actually took.
            if (doc) {
              this.parsePermissionsFromDocument(doc);
              return;
            }
            // Nothing was written, and the row has already been put back with its id intact.
            if (!replaced) return;
            // The write took but the re-read did not. An ACE id encodes the permission and the
            // dates, so the one on screen is now stale, and a further edit or removal would
            // address an entry the server no longer has — which Nuxeo answers 200 to, changing
            // nothing. Drop it: a row with no ACE id offers no actions, the same state a row
            // never read from the ACL is in.
            this.permissions.update((rows) =>
              rows.map((r) => (r.id === id ? { ...r, aceId: undefined } : r)),
            );
          });
      });
  }

  save(): void {
    if (this.saving() || !this.data.id) return;

    this.saving.set(true);

    const permissions = this.permissions();
    if (permissions.length === 0) {
      this.saving.set(false);
      this.dialogRef.close(permissions);
      return;
    }

    // Create API calls for each permission
    const requests = permissions.map((perm) => {
      const { right, timeFrame } = this.normalizePermissionForApi(perm);
      const [begin, end] = this.parseTimeFrame(timeFrame);

      return this.detailService.replacePermission(this.data.id, {
        username: perm.userGroup,
        email: null,
        permission: right,
        begin: begin || null,
        end: end || null,
        notify: false,
        comment: null,
      });
    });

    forkJoin(requests)
      .pipe(
        catchError((error) => {
          console.error('Error saving permissions:', error);
          this.saving.set(false);
          return of(null);
        }),
      )
      .subscribe(() => {
        this.saving.set(false);
        // Refresh permissions from API after save
        this.loadPermissionsFromApi();
      });
  }

  /**
   * The permission to write for a row.
   *
   * `save()` replays every row, so this runs over entries the user never touched — which is why it
   * must never rewrite a permission Nuxeo defines. It used to map `Write` to `ReadWrite`, widening
   * an untouched entry's access on any save, and the labels below were indistinguishable from
   * identifiers (NXSAT-334). Rows now carry identifiers; the map is kept only so a label left in
   * state by an older build still resolves rather than reaching the server verbatim.
   */
  private normalizePermissionForApi(perm: PermissionEntry): { right: string; timeFrame: string } {
    const legacyLabelToPermission: Record<string, string> = {
      Edit: 'ReadWrite',
      Manage: 'Everything',
      'Manage everything': 'Everything',
      'Can collect': 'ReadCanCollect',
    };

    return {
      right: legacyLabelToPermission[perm.right] ?? perm.right,
      timeFrame: perm.timeFrame,
    };
  }

  private parseTimeFrame(timeFrame: string): [string | null, string | null] {
    if (timeFrame === 'Permanent') {
      return [null, null];
    }

    // "Until <end>" — only end date set
    if (timeFrame.startsWith('Until ')) {
      return [null, timeFrame.slice(6).trim()];
    }

    // "From <begin>" — only begin date set
    if (timeFrame.startsWith('From ')) {
      return [timeFrame.slice(5).trim(), null];
    }

    const parts = timeFrame.split(' - ');
    if (parts.length === 2) {
      return [parts[0].trim(), parts[1].trim()];
    }

    return [null, null];
  }

  private toTimeFrameLabel(
    begin: string | null | undefined,
    end: string | null | undefined,
  ): string {
    if (!begin && !end) return this.translate.instant('permissions.time-frame.permanent');
    if (!begin && end) return this.translate.instant('permissions.time-frame.until', { end });
    if (begin && !end) return this.translate.instant('permissions.time-frame.from', { begin });
    return this.translate.instant('permissions.time-frame.range', { begin, end });
  }
}
