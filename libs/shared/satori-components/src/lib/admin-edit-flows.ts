import type { MatDialog } from '@angular/material/dialog';
import { filter, type Observable, switchMap } from 'rxjs';
import {
  type NuxeoGroup,
  type NuxeoUser,
  type UserService,
} from '@nuxeo/satori-platform/nuxeo-client';

import {
  NxsConfirmDialogComponent,
  type NxsConfirmDialogData,
} from './confirm-dialog/confirm-dialog.component';
import {
  NxsGroupFormDialogComponent,
  type NxsGroupFormDialogData,
  type NxsGroupFormDialogResult,
} from './group-form-dialog/group-form-dialog.component';
import {
  NxsUserFormDialogComponent,
  type NxsUserFormDialogData,
  type NxsUserFormDialogResult,
} from './user-form-dialog/user-form-dialog.component';

/** Edits a user in the form dialog and saves what it returns. Shared by the users and groups pages and the user page. */
export function saveEditedUser(
  dialog: MatDialog,
  userService: UserService,
  user: NuxeoUser,
): Observable<unknown> {
  return dialog
    .open<NxsUserFormDialogComponent, NxsUserFormDialogData, NxsUserFormDialogResult | undefined>(
      NxsUserFormDialogComponent,
      { width: '480px', maxHeight: '90vh', data: { mode: 'edit', user } },
    )
    .afterClosed()
    .pipe(
      filter((result): result is NxsUserFormDialogResult => !!result && result.mode === 'edit'),
      switchMap((result) =>
        userService.updateUser(user.id, {
          firstName: result.firstName,
          lastName: result.lastName,
          company: result.company,
          email: result.email,
          password: result.password,
          groups: [...result.groups],
        }),
      ),
    );
}

/** Edits a group in the form dialog and saves what it returns. Shared by the groups pages. */
export function saveEditedGroup(
  dialog: MatDialog,
  userService: UserService,
  group: NuxeoGroup,
): Observable<unknown> {
  return dialog
    .open<
      NxsGroupFormDialogComponent,
      NxsGroupFormDialogData,
      NxsGroupFormDialogResult | undefined
    >(NxsGroupFormDialogComponent, { width: '480px', data: { mode: 'edit', group } })
    .afterClosed()
    .pipe(
      filter((result): result is NxsGroupFormDialogResult => !!result && result.mode === 'edit'),
      switchMap((result) =>
        userService.updateGroup(group.groupname, {
          grouplabel: result.grouplabel,
          memberUsers: [...result.memberUsers],
        }),
      ),
    );
}

/** Asks before a deletion; emits once, only when the user confirms. */
export function confirmAction(dialog: MatDialog, data: NxsConfirmDialogData): Observable<true> {
  return dialog
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
