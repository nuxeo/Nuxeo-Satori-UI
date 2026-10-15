import type { Provider } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { NEVER, of, throwError, type Observable } from 'rxjs';
import { action } from 'storybook/actions';

import {
  DocumentDetailService,
  type NuxeoAce,
  type NuxeoDocument,
} from '@nuxeo-satori/platform/nuxeo-client';

import { dialogPreview } from '../../../.storybook/dialog-preview';

import {
  NxsDeletePermissionDialogComponent,
  type NxsDeletePermissionDialogData,
} from './delete-permission-dialog.component';

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

const withDialog = (
  ace: NuxeoAce,
  removePermissionById: () => Observable<NuxeoDocument> = () =>
    of({ uid: 'story-doc' } as NuxeoDocument),
) => {
  const detail: Pick<DocumentDetailService, 'removePermissionById'> = {
    removePermissionById: logged('removePermissionById', removePermissionById),
  };
  const dialogRef: Pick<MatDialogRef<NxsDeletePermissionDialogComponent>, 'close'> = {
    close: logged('dialogRef.close', () => undefined),
  };
  const data: NxsDeletePermissionDialogData = { documentUid: 'story-doc', ace };
  const providers: Provider[] = [
    { provide: DocumentDetailService, useValue: detail },
    { provide: MatDialogRef, useValue: dialogRef },
    { provide: MAT_DIALOG_DATA, useValue: data },
  ];
  return applicationConfig({ providers });
};

const meta: Meta<NxsDeletePermissionDialogComponent> = {
  title: 'Dialogs/Delete permission',
  component: NxsDeletePermissionDialogComponent,
  tags: ['autodocs'],
  parameters: {
    // MatDialog's overlay has no padding; the centred layout's would widen the page.
    layout: 'fullscreen',
    // The preview shows the dialog inline; a page opens it through MatDialog, so the code shown is
    // that call rather than the preview's wrapper.
    docs: {
      // It has no inputs; the API page lists the dialog data it reads instead.
      api: { types: ['NxsDeletePermissionDialogData'] },
      source: {
        language: 'typescript',
        code: `this.dialog.open(NxsDeletePermissionDialogComponent, {
  width: '560px',
  maxWidth: '95vw',
  data: { documentUid: doc.uid, ace, acl: 'local' },
  role: 'alertdialog',
});`,
      },
    },
  },
  render: dialogPreview('nxs-delete-permission-dialog', { width: '560px', maxWidth: '95vw' }),
};

export default meta;

type Story = StoryObj<NxsDeletePermissionDialogComponent>;

/** An external user's share, which Nuxeo holds under `transient/` and the dialog shows by email. */
export const ExternalShare: Story = { decorators: [withDialog(EXTERNAL)] };

/** A user's permanent entry. */
export const UserEntry: Story = {
  decorators: [
    withDialog({
      ...EXTERNAL,
      id: 'jdoe:ReadWrite:true:Administrator::',
      username: 'jdoe',
      usernameLabel: 'John Doe',
      permission: 'ReadWrite',
      externalUser: false,
      end: null,
    }),
  ],
};

/** Delete pressed: the button names the progress until Nuxeo answers. */
export const Deleting: Story = {
  decorators: [withDialog(EXTERNAL, () => NEVER)],
  play: ({ canvasElement }) => {
    canvasElement
      .querySelector<HTMLButtonElement>('.nxs-delete-permission-dialog__delete')
      ?.click();
  },
};

/** Nuxeo refuses (403): pressing Delete reports a refusal and the dialog stays open. */
export const Refused: Story = {
  decorators: [
    withDialog(EXTERNAL, () => throwError(() => new HttpErrorResponse({ status: 403 }))),
  ],
};
