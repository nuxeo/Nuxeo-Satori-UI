import type { Provider } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { NEVER, of, type Observable } from 'rxjs';

import { NuxeoDriveService } from '@nuxeo-satori/platform/nuxeo-client';

import { NxsDriveDialogComponent } from './drive-dialog.component';

/**
 * A host opens it with `dialog.open(NxsDriveDialogComponent, { data })`; these stories render its
 * content inline, over a `NuxeoDriveService` that answers the token check without asking Nuxeo and
 * a `MatDialogRef` whose `close()` does nothing. With a token the dialog hands Drive the folder and
 * closes at once, so only the two states a user sees are shown.
 */
const withDrive = (hasDriveToken: () => Observable<boolean>) => {
  const drive: Pick<
    NuxeoDriveService,
    'hasDriveToken' | 'buildDirectTransferUrl' | 'openDriveUrl'
  > = {
    hasDriveToken,
    buildDirectTransferUrl: (path) => `nxdrive://direct-transfer${path}`,
    openDriveUrl: () => undefined,
  };
  const dialogRef: Pick<MatDialogRef<NxsDriveDialogComponent>, 'close'> = {
    close: () => undefined,
  };
  const providers: Provider[] = [
    { provide: NuxeoDriveService, useValue: drive },
    { provide: MatDialogRef, useValue: dialogRef },
  ];
  return applicationConfig({ providers });
};

/** The dialog's chrome comes from the application's catalogue (`preview.ts`). */
const meta: Meta<NxsDriveDialogComponent> = {
  title: 'Dialogs/Nuxeo Drive',
  component: NxsDriveDialogComponent,
  render: () => ({
    template: `
      <div style="border-radius: 28px; background: var(--mat-sys-surface-container-high)">
        <nxs-drive-dialog />
      </div>
    `,
  }),
};

export default meta;

type Story = StoryObj<NxsDriveDialogComponent>;

/** No Drive token for this user, or the check failed: the installers are offered. */
export const NoDriveToken: Story = { decorators: [withDrive(() => of(false))] };

/** While Nuxeo is asked whether this user has a Drive token. */
export const Checking: Story = { decorators: [withDrive(() => NEVER)] };
