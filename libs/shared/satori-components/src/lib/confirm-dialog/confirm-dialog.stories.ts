import { inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { action } from 'storybook/actions';
import { userEvent, within } from 'storybook/test';

import { dialogPreview } from '../../../.storybook/dialog-preview';

import { NxsConfirmDialogComponent, type NxsConfirmDialogData } from './confirm-dialog.component';

/** The words come from the catalogue, as a caller's do: the story shows what a translator would ship. */
const withDialog = () =>
  applicationConfig({
    providers: [
      {
        provide: MAT_DIALOG_DATA,
        useFactory: (): NxsConfirmDialogData => {
          const translate = inject(TranslateService);
          return {
            title: translate.instant('satori-components.admin-users-groups-page.delete-user'),
            message: translate.instant(
              'satori-components.admin-users-groups-page.delete-user-named',
              { name: 'jdoe' },
            ),
            confirmLabel: translate.instant('satori-components.admin-user-details-page.delete'),
          };
        },
      },
      { provide: MatDialogRef, useValue: { close: action('dialogRef.close') } },
    ],
  });

const meta: Meta<NxsConfirmDialogComponent> = {
  title: 'Dialogs/Confirm',
  component: NxsConfirmDialogComponent,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      api: { types: ['NxsConfirmDialogData'] },
      source: {
        language: 'typescript',
        code: `this.dialog
  .open(NxsConfirmDialogComponent, { data: { title, message, confirmLabel } })
  .afterClosed()
  .subscribe((ok) => { if (ok) this.delete(id); });`,
      },
    },
  },
  render: dialogPreview('nxs-confirm-dialog'),
  decorators: [withDialog()],
};

export default meta;

type Story = StoryObj<NxsConfirmDialogComponent>;

/** The question as the caller wrote it: confirming closes with true. */
export const Asking: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Delete' }));
  },
};
