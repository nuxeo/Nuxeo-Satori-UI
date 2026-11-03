import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { of } from 'rxjs';
import { action } from 'storybook/actions';
import { expect, fn, userEvent, within } from 'storybook/test';

import { UserService, type NuxeoGroup, type NuxeoUser } from '@nuxeo/satori-platform/nuxeo-client';

import { dialogPreview } from '../../../.storybook/dialog-preview';

import {
  NxsGroupFormDialogComponent,
  type NxsGroupFormDialogData,
} from './group-form-dialog.component';

const closeDialog = fn(action('dialogRef.close'));

const USERS = {
  entries: [
    { id: 'alice', properties: { firstName: 'Alice', lastName: 'Ng', email: 'alice@acme.test' } },
    { id: 'bob', properties: {} },
  ] as unknown as NuxeoUser[],
};

const GROUP = {
  groupname: 'editors',
  grouplabel: 'Editors',
  memberUsers: ['carol'],
} as unknown as NuxeoGroup;

/** The dialog with its data, and a directory that answers from memory. */
const withDirectory = (data: NxsGroupFormDialogData) =>
  applicationConfig({
    providers: [
      { provide: MAT_DIALOG_DATA, useValue: data },
      { provide: MatDialogRef, useValue: { close: closeDialog } },
      { provide: UserService, useValue: { searchUsersPaged: () => of(USERS) } },
    ],
  });

const meta: Meta<NxsGroupFormDialogComponent> = {
  title: 'Dialogs/Group form',
  component: NxsGroupFormDialogComponent,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      api: { types: ['NxsGroupFormDialogData', 'NxsGroupFormDialogResult'] },
      source: {
        language: 'typescript',
        code: `this.dialog
  .open(NxsGroupFormDialogComponent, { data: { mode: 'create' } })
  .afterClosed()
  .subscribe((result) => { if (result) this.saveGroup(result); });`,
      },
    },
  },
  render: dialogPreview('nxs-group-form-dialog'),
};

export default meta;

type Story = StoryObj<NxsGroupFormDialogComponent>;

/** A new group: name it and press Create. The dialog closes with the values. */
export const Creating: Story = {
  decorators: [withDirectory({ mode: 'create' })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole('textbox', { name: 'Group name' }), 'editors');
    await expect(canvas.getByRole('button', { name: 'Create' })).toBeEnabled();
  },
};

/** An existing group: the name is fixed, and its members can be added to or removed. */
export const Editing: Story = {
  decorators: [withDirectory({ mode: 'edit', group: GROUP })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('textbox', { name: 'Group name' })).toBeDisabled();
    await expect(canvas.getByRole('button', { name: 'Save' })).toBeEnabled();
  },
};

/** The preview stays mounted; this asserts the dialog's close request. */
export const KeyboardCancellation: Story = {
  ...Creating,
  play: async ({ canvasElement }) => {
    closeDialog.mockClear();
    const cancel = await within(canvasElement).findByRole('button', { name: 'Cancel' });
    cancel.focus();
    await userEvent.keyboard('{Enter}');
    await expect(closeDialog).toHaveBeenCalledTimes(1);
  },
};
