import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { action } from 'storybook/actions';
import { expect, userEvent, within } from 'storybook/test';

import { dialogPreview } from '../../../.storybook/dialog-preview';

import { NxsChangePasswordDialogComponent } from './change-password-dialog.component';

const DATA = { username: 'jdoe' };

/** The dialog with its data, and a dialog reference that records what it closes with. */
const withDialog = () =>
  applicationConfig({
    providers: [
      { provide: MAT_DIALOG_DATA, useValue: DATA },
      { provide: MatDialogRef, useValue: { close: action('dialogRef.close') } },
    ],
  });

const meta: Meta<NxsChangePasswordDialogComponent> = {
  title: 'Dialogs/Change password',
  component: NxsChangePasswordDialogComponent,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      api: { types: ['NxsChangePasswordDialogData'] },
      source: {
        language: 'typescript',
        code: `this.dialog
  .open(NxsChangePasswordDialogComponent, { data: { username: user.id } })
  .afterClosed()
  .subscribe((password) => { if (password) this.setPassword(user.id, password); });`,
      },
    },
  },
  render: dialogPreview('nxs-change-password-dialog'),
  decorators: [withDialog()],
};

export default meta;

type Story = StoryObj<NxsChangePasswordDialogComponent>;

/** Type the same password twice and press Set password: the dialog closes with the password. */
export const Matching: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const [first, second] = canvas.getAllByLabelText(/password/i);
    await userEvent.type(first, 'correct-horse-7');
    await userEvent.type(second, 'correct-horse-7');
    await expect(canvas.getByRole('button', { name: 'Set password' })).toBeEnabled();
  },
};

/** The two fields differ: Set password stays off and the dialog says why. */
export const Mismatch: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const [first, second] = canvas.getAllByLabelText(/password/i);
    await userEvent.type(first, 'correct-horse-7');
    await userEvent.type(second, 'correct-horse-8');
    await expect(await canvas.findByRole('alert')).toHaveTextContent('do not match');
    await expect(canvas.getByRole('button', { name: 'Set password' })).toBeDisabled();
  },
};
