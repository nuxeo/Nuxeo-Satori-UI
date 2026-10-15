import type { Provider } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { NEVER, of, throwError, type Observable } from 'rxjs';
import { action } from 'storybook/actions';

import {
  DocumentDetailService,
  type PermissionWithNotificationResult,
} from '@nuxeo-satori/platform/nuxeo-client';

import { dialogPreview } from '../../../.storybook/dialog-preview';

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
    maxWidth: '95vw',
    data: { documentUid: doc.uid, permissions: doc.contextParameters?.userVisiblePermissions },
  })
  .afterClosed()
  .subscribe((shared) => shared && this.reloadPermissions());`,
      },
    },
  },
  render: dialogPreview('nxs-share-external-dialog', { maxWidth: '95vw' }),
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

/**
 * With populated From/To dates, for the regression check to validate that date inputs wrap at
 * narrow widths without clipping their values. The dates are set programmatically after mount,
 * since Share external is for new permissions and its form starts empty by design.
 */
export const PopulatedDates: Story = {
  decorators: [withDialog()],
  play: async ({ canvasElement }) => {
    // Wait for the dialog to mount, then set date input values to exercise the wrapping check.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const from = canvasElement.querySelector<HTMLInputElement>('input[matInput]:not([required])');
    const to = canvasElement.querySelector<HTMLInputElement>('input[matInput][required]');
    if (from) {
      from.value = '1/2/2030';
      from.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (to) {
      to.value = '3/4/2030';
      to.dispatchEvent(new Event('input', { bubbles: true }));
    }
  },
};
