import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { of, throwError } from 'rxjs';
import { action } from 'storybook/actions';
import { expect, userEvent, within } from 'storybook/test';

import { UserService, type NuxeoUser } from '@nuxeo/satori-platform/nuxeo-client';

import { dialogPreview } from '../../../.storybook/dialog-preview';

import {
  NxsUserFormDialogComponent,
  type NxsUserFormDialogData,
} from './user-form-dialog.component';

const GROUPS = {
  entries: [
    { groupname: 'members', grouplabel: 'Members' },
    { groupname: 'managers', grouplabel: 'Managers' },
  ],
};

const USER = {
  id: 'jdoe',
  properties: {
    firstName: 'Jane',
    lastName: 'Doe',
    company: 'Acme',
    email: 'jdoe@acme.test',
    groups: ['members'],
  },
} as unknown as NuxeoUser;

/** The dialog with its data, a directory that answers from memory, and a create that `answer` decides. */
const withServer = (data: NxsUserFormDialogData, createAnswer = () => of({})) =>
  applicationConfig({
    providers: [
      { provide: MAT_DIALOG_DATA, useValue: data },
      { provide: MatDialogRef, useValue: { close: action('dialogRef.close') } },
      {
        provide: UserService,
        useValue: {
          searchGroupsPaged: () => of(GROUPS),
          createUser: (body: unknown) => {
            action('createUser')(body);
            return createAnswer();
          },
        },
      },
    ],
  });

const meta: Meta<NxsUserFormDialogComponent> = {
  title: 'Dialogs/User form',
  component: NxsUserFormDialogComponent,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      api: { types: ['NxsUserFormDialogData', 'NxsUserFormDialogResult'] },
      source: {
        language: 'typescript',
        code: `this.dialog
  .open(NxsUserFormDialogComponent, { data: { mode: 'create' } })
  .afterClosed()
  .subscribe((result) => { if (result) this.reload(); });`,
      },
    },
  },
  render: dialogPreview('nxs-user-form-dialog'),
};

export default meta;

type Story = StoryObj<NxsUserFormDialogComponent>;

/** A new user, created with no password so the server sends an invitation. */
export const Creating: Story = {
  decorators: [withServer({ mode: 'create' })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole('textbox', { name: 'Username' }), 'newuser');
    await userEvent.type(canvas.getByRole('textbox', { name: 'Email' }), 'new@acme.test');
    await expect(canvas.getByRole('button', { name: 'Create' })).toBeEnabled();
  },
};

/** An existing user: the username is fixed, and Save closes with the edited values. */
export const Editing: Story = {
  decorators: [withServer({ mode: 'edit', user: USER })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('textbox', { name: 'Username' })).toBeDisabled();
    await expect(canvas.getByRole('button', { name: 'Save' })).toBeEnabled();
  },
};

/** The server says the username is taken: the dialog stays open and says so. */
export const Refused: Story = {
  decorators: [
    withServer({ mode: 'create' }, () =>
      throwError(() => ({ error: { message: 'User already exists' } })),
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole('textbox', { name: 'Username' }), 'jdoe');
    await userEvent.type(canvas.getByRole('textbox', { name: 'Email' }), 'jdoe@acme.test');
    await userEvent.click(canvas.getByRole('button', { name: 'Create' }));
    await expect(await canvas.findByRole('alert')).toHaveTextContent('already exists');
  },
};
