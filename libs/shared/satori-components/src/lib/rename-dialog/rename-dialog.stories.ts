import type { Provider } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { of, throwError, type Observable } from 'rxjs';
import { action } from 'storybook/actions';
import { expect, userEvent, within } from 'storybook/test';

import { BrowseService, type NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';

import { dialogPreview } from '../../../.storybook/dialog-preview';

import { NxsRenameDialogComponent } from './rename-dialog.component';

const DATA = { documentId: 'claim-42', title: 'Claim 42 — water damage' };

/** The dialog with its data, and a server that answers the title change with `answer`. */
const withServer = (answer: (title: string) => Observable<unknown>) => {
  const providers: Provider[] = [
    { provide: MAT_DIALOG_DATA, useValue: DATA },
    { provide: MatDialogRef, useValue: { close: action('dialogRef.close') } },
    {
      provide: BrowseService,
      useValue: {
        updateDocument: (uid: string, properties: Record<string, unknown>) => {
          action('updateDocument')(uid, properties);
          return answer(String(properties['dc:title']));
        },
      },
    },
  ];
  return applicationConfig({ providers });
};

const meta: Meta<NxsRenameDialogComponent> = {
  title: 'Dialogs/Rename',
  component: NxsRenameDialogComponent,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      api: { types: ['NxsRenameDialogData'] },
      source: {
        language: 'typescript',
        code: `this.dialog
  .open(NxsRenameDialogComponent, { data: { documentId: doc.uid, title: doc.title } })
  .afterClosed()
  .subscribe((updated) => { if (updated) this.reload(); });`,
      },
    },
  },
  render: dialogPreview('nxs-rename-dialog'),
};

export default meta;

type Story = StoryObj<NxsRenameDialogComponent>;

/** Change the title and press Rename: the dialog closes with the updated document. */
export const Renaming: Story = {
  decorators: [withServer((title) => of({ uid: DATA.documentId, title } as NuxeoDocument))],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const field = canvas.getByRole('textbox', { name: 'Title' });
    await userEvent.clear(field);
    await userEvent.type(field, 'Claim 42 — closed');
    await expect(canvas.getByRole('button', { name: 'Rename' })).toBeEnabled();
  },
};

/** The server refused: the dialog stays open and says the user lacks permission. */
export const Refused: Story = {
  decorators: [withServer(() => throwError(() => ({ status: 403 })))],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const field = canvas.getByRole('textbox', { name: 'Title' });
    await userEvent.type(field, ' (final)');
    await userEvent.click(canvas.getByRole('button', { name: 'Rename' }));
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'You do not have permission to rename this document.',
    );
  },
};
