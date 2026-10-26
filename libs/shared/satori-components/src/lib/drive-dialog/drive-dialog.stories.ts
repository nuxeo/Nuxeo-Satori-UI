import type { Provider } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { NEVER, of, type Observable } from 'rxjs';
import { action } from 'storybook/actions';

import { NuxeoDriveService } from '@nuxeo/satori-platform/nuxeo-client';

import { dialogPreview } from '../../../.storybook/dialog-preview';

import { NxsDriveDialogComponent } from './drive-dialog.component';

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

const withDrive = (hasDriveToken: () => Observable<boolean>) => {
  const drive: Pick<
    NuxeoDriveService,
    'hasDriveToken' | 'buildDirectTransferUrl' | 'openDriveUrl'
  > = {
    hasDriveToken: logged('hasDriveToken', hasDriveToken),
    buildDirectTransferUrl: logged(
      'buildDirectTransferUrl',
      (path: string) => `nxdrive://direct-transfer${path}`,
    ),
    openDriveUrl: logged<[url: string], void>('openDriveUrl', () => undefined),
  };
  const dialogRef: Pick<MatDialogRef<NxsDriveDialogComponent>, 'close'> = {
    close: logged('dialogRef.close', () => undefined),
  };
  const providers: Provider[] = [
    { provide: NuxeoDriveService, useValue: drive },
    { provide: MatDialogRef, useValue: dialogRef },
  ];
  return applicationConfig({ providers });
};

const meta: Meta<NxsDriveDialogComponent> = {
  title: 'Dialogs/Nuxeo Drive',
  component: NxsDriveDialogComponent,
  tags: ['autodocs'],
  parameters: {
    // MatDialog's overlay has no padding; the centred layout's would widen the page.
    layout: 'fullscreen',
    // The preview shows the dialog inline; a page opens it through MatDialog, so the code shown is
    // that call rather than the preview's wrapper.
    docs: {
      // It has no inputs; the API page lists the dialog data it reads instead.
      api: { types: ['NxsDriveDialogData'] },
      source: {
        language: 'typescript',
        code: `this.dialog.open(NxsDriveDialogComponent, {
  data: { folderPath: '/default-domain/workspaces/claims' },
});`,
      },
    },
  },
  render: dialogPreview('nxs-drive-dialog'),
};

export default meta;

type Story = StoryObj<NxsDriveDialogComponent>;

/** No Drive token for this user, or the check failed: the installers are offered. */
export const NoDriveToken: Story = { decorators: [withDrive(() => of(false))] };

/** While Nuxeo is asked whether this user has a Drive token. */
export const Checking: Story = { decorators: [withDrive(() => NEVER)] };
