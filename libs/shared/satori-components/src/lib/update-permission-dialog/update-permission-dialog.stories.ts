import type { Provider } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { of, throwError, type Observable } from 'rxjs';
import { action } from 'storybook/actions';

import {
  DocumentDetailService,
  type NuxeoAce,
  type PermissionWithNotificationResult,
} from '@nuxeo/satori-platform/nuxeo-client';

import {
  NxsUpdatePermissionDialogComponent,
  type NxsUpdatePermissionDialogData,
} from './update-permission-dialog.component';

/** Logs each call in the Actions panel under `name`, then lets the fake answer it. */
function logged<A extends unknown[], R>(
  name: string,
  method: (...args: A) => R,
): (...args: A) => R {
  return (...args) => {
    action(name)(...args);
    return method(...args);
  };
}

const EXTERNAL: NuxeoAce = {
  id: 'transient/j.martin@partner.example:Read:true:Administrator::1927929600000',
  username: 'transient/j.martin@partner.example',
  permission: 'Read',
  granted: true,
  externalUser: true,
  creator: 'Administrator',
  begin: null,
  end: '2031-02-01T00:00:00.000Z',
  status: 'effective',
};

const LOCAL: NuxeoAce = {
  ...EXTERNAL,
  id: 'jdoe:ReadWrite:true:Administrator::',
  username: 'jdoe',
  usernameLabel: 'John Doe',
  permission: 'ReadWrite',
  externalUser: false,
  end: null,
};

const replaced = (): Observable<PermissionWithNotificationResult> =>
  of({ document: { uid: 'story-doc' } as never, notificationSent: true });

const withDialog = (
  ace: NuxeoAce,
  replace: () => Observable<PermissionWithNotificationResult> = replaced,
) => {
  const detail: Pick<DocumentDetailService, 'replacePermissionWithNotification'> = {
    replacePermissionWithNotification: logged('replacePermissionWithNotification', replace),
  };
  const dialogRef: Pick<MatDialogRef<NxsUpdatePermissionDialogComponent>, 'close'> = {
    close: logged('dialogRef.close', () => undefined),
  };
  const data: NxsUpdatePermissionDialogData = {
    documentUid: 'story-doc',
    ace,
    permissions: ['Read', 'ReadWrite', 'Everything'],
  };
  const providers: Provider[] = [
    { provide: DocumentDetailService, useValue: detail },
    { provide: MatDialogRef, useValue: dialogRef },
    { provide: MAT_DIALOG_DATA, useValue: data },
  ];
  return applicationConfig({ providers });
};

const meta: Meta<NxsUpdatePermissionDialogComponent> = {
  title: 'Dialogs/Update permission',
  component: NxsUpdatePermissionDialogComponent,
  tags: ['autodocs'],
  parameters: {
    // MatDialog's overlay has no padding; the centred layout's would widen the page.
    layout: 'fullscreen',
    // The preview shows the dialog inline; a page opens it through MatDialog, so the code shown is
    // that call rather than the preview's wrapper.
    docs: {
      // It has no inputs; the API page lists the dialog data it reads instead.
      api: { types: ['NxsUpdatePermissionDialogData'] },
      source: {
        language: 'typescript',
        code: `this.dialog
  .open(NxsUpdatePermissionDialogComponent, {
    data: { documentUid: doc.uid, ace, permissions: doc.contextParameters?.userVisiblePermissions },
  })
  .afterClosed()
  .subscribe((updated) => updated && this.reloadPermissions());`,
      },
    },
  },
  render: () => ({
    template: `
      <div
        style="width: fit-content; max-width: 95vw; margin: 16px auto; border-radius: 28px; background: var(--mat-sys-surface-container-high)"
      >
        <nxs-update-permission-dialog />
      </div>
    `,
  }),
};

export default meta;

type Story = StoryObj<NxsUpdatePermissionDialogComponent>;

/** An external user's share: its end date stays required and the person is always emailed. */
export const ExternalShare: Story = { decorators: [withDialog(EXTERNAL)] };

/** A user's permanent entry, with the time frame and the notification to choose. */
export const UserEntry: Story = { decorators: [withDialog(LOCAL)] };

/** A user's entry between two dates. */
export const DatedEntry: Story = {
  decorators: [
    withDialog({ ...LOCAL, begin: '2030-01-02T00:00:00.000Z', end: '2030-03-04T00:00:00.000Z' }),
  ],
};

/** Nuxeo refuses (403): Update reports a refusal and the dialog stays open. */
export const Refused: Story = {
  decorators: [withDialog(LOCAL, () => throwError(() => new HttpErrorResponse({ status: 403 })))],
};
