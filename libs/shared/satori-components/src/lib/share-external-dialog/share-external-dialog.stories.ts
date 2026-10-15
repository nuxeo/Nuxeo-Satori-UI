import type { Provider } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { NEVER, of, throwError, type Observable } from 'rxjs';
import { action } from 'storybook/actions';

import {
  DocumentDetailService,
  type PermissionWithNotificationResult,
} from '@nuxeo/satori-platform/nuxeo-client';

import {
  NxsShareExternalDialogComponent,
  type NxsShareExternalDialogData,
} from './share-external-dialog.component';

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

const shared = (): Observable<PermissionWithNotificationResult> =>
  of({ document: { uid: 'story-doc' } as never, notificationSent: true });

const withDialog = (
  data: Partial<NxsShareExternalDialogData> = {},
  share: () => Observable<PermissionWithNotificationResult> = shared,
) => {
  const detail: Pick<DocumentDetailService, 'addExternalPermissionWithNotification'> = {
    addExternalPermissionWithNotification: logged('addExternalPermissionWithNotification', share),
  };
  const dialogRef: Pick<
    MatDialogRef<NxsShareExternalDialogComponent>,
    'close' | 'backdropClick' | 'keydownEvents' | 'disableClose'
  > = {
    close: logged('dialogRef.close', () => undefined),
    backdropClick: () => NEVER,
    keydownEvents: () => NEVER,
    disableClose: false,
  };
  const providers: Provider[] = [
    { provide: DocumentDetailService, useValue: detail },
    { provide: MatDialogRef, useValue: dialogRef },
    { provide: MAT_DIALOG_DATA, useValue: { documentUid: 'story-doc', ...data } },
  ];
  return applicationConfig({ providers });
};

const meta: Meta<NxsShareExternalDialogComponent> = {
  title: 'Dialogs/Share with external user',
  component: NxsShareExternalDialogComponent,
  tags: ['autodocs'],
  parameters: {
    // MatDialog's overlay has no padding; the centred layout's would widen the page.
    layout: 'fullscreen',
    // The preview shows the dialog inline; a page opens it through MatDialog, so the code shown is
    // that call rather than the preview's wrapper.
    docs: {
      // It has no inputs; the API page lists the dialog data it reads instead.
      api: { types: ['NxsShareExternalDialogData'] },
      source: {
        language: 'typescript',
        code: `this.dialog
  .open(NxsShareExternalDialogComponent, {
    data: { documentUid: doc.uid, permissions: doc.contextParameters?.userVisiblePermissions },
  })
  .afterClosed()
  .subscribe((shared) => shared && this.reloadPermissions());`,
      },
    },
  },
  render: () => ({
    template: `
      <div
        style="width: fit-content; max-width: 95vw; margin: 16px auto; border-radius: 28px; background: var(--mat-sys-surface-container-high)"
      >
        <nxs-share-external-dialog />
      </div>
    `,
  }),
};

export default meta;

type Story = StoryObj<NxsShareExternalDialogComponent>;

/** A document type naming no visible permissions: Nuxeo's default three are offered. */
export const Default: Story = { decorators: [withDialog()] };

/** The rights a type makes visible, here Read and Edit, are the only ones offered. */
export const TypeRights: Story = {
  decorators: [withDialog({ permissions: ['Read', 'ReadWrite'] })],
};

/** Nuxeo refuses (403): Create reports a refusal and keeps what was typed. */
export const Refused: Story = {
  decorators: [withDialog({}, () => throwError(() => new HttpErrorResponse({ status: 403 })))],
};
