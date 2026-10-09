import type { Provider } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { NEVER, of, type Observable } from 'rxjs';
import { action } from 'storybook/actions';

import { NuxeoDriveService } from '@nuxeo-satori/platform/nuxeo-client';

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

const componentDescription = `
"Open with Nuxeo Drive", shown as a Material dialog. A host opens it with
\`dialog.open(NxsDriveDialogComponent, { data: { folderPath } })\`.

When it opens it asks Nuxeo, through the platform's \`NuxeoDriveService\`, whether the current user
has a Nuxeo Drive token. With one, it hands Drive the folder through an \`nxdrive://direct-transfer\`
link and closes itself. Without one — or when the check fails — it offers the Drive installers for
Linux, macOS and Windows, and a Close button.

**Inputs**

None. It reads the dialog's data instead:

- \`folderPath\` — \`string\`, optional. The repository folder Drive should open; the repository root
  when absent.

**What it calls**

- \`NuxeoDriveService.hasDriveToken()\`, once, when it opens.
- With a token: \`buildDirectTransferUrl(folderPath)\`, then \`openDriveUrl(…)\`, then
  \`MatDialogRef.close()\`.
- The Close button: \`MatDialogRef.close()\`.

It emits nothing; the dialog reference is how it reports closing. Its title, labels and button are
translated from the application's catalogue.

**In these stories** the dialog is shown inline rather than over the page, and \`NuxeoDriveService\`
and the dialog reference are fakes that never contact Nuxeo and close nothing. Every call they receive
is logged in the **Actions** panel. With a token the dialog would close at once, so only the two
states a user sees are shown.
`;

const meta: Meta<NxsDriveDialogComponent> = {
  title: 'Dialogs/Nuxeo Drive',
  component: NxsDriveDialogComponent,
  tags: ['autodocs'],
  parameters: {
    docs: { description: { component: componentDescription } },
  },
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
