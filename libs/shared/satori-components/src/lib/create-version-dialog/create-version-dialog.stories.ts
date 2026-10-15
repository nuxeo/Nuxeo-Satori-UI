import type { Provider } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { NEVER, of, throwError, type Observable } from 'rxjs';
import { action } from 'storybook/actions';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { DocumentDetailService, type NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';

import {
  NxsCreateVersionDialogComponent,
  type NxsCreateVersionDialogData,
} from './create-version-dialog.component';

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

const CONTRACT: NxsCreateVersionDialogData = {
  documentUid: 'story-doc',
  documentTitle: 'Supplier contract',
  major: 1,
  minor: 2,
};

const withDialog = (
  createVersion: () => Observable<NuxeoDocument> = () => of({ uid: 'v-2-0' } as NuxeoDocument),
) => {
  const detail: Pick<DocumentDetailService, 'createVersion'> = {
    createVersion: logged('createVersion', createVersion),
  };
  const dialogRef: Pick<MatDialogRef<NxsCreateVersionDialogComponent>, 'close'> = {
    close: logged('dialogRef.close', () => undefined),
  };
  const providers: Provider[] = [
    { provide: DocumentDetailService, useValue: detail },
    { provide: MatDialogRef, useValue: dialogRef },
    { provide: MAT_DIALOG_DATA, useValue: CONTRACT },
  ];
  return applicationConfig({ providers });
};

/**
 * Create a version of a document: Minor or Major, with the number each would give, Major first.
 * `nxs-manage-versions` opens it; a page can too.
 */
const meta: Meta<NxsCreateVersionDialogComponent> = {
  title: 'Dialogs/Create version',
  component: NxsCreateVersionDialogComponent,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      api: { types: ['NxsCreateVersionDialogData'] },
      source: {
        language: 'typescript',
        code: `this.dialog.open(NxsCreateVersionDialogComponent, {
  data: { documentUid: doc.uid, documentTitle: doc.title, major: 1, minor: 2 },
});`,
      },
    },
  },
  render: () => ({
    template: `
      <div
        style="width: 600px; max-width: 95vw; margin: 16px auto; border-radius: 28px; background: var(--mat-sys-surface-container-high)"
      >
        <nxs-create-version-dialog />
      </div>
    `,
  }),
};

export default meta;

type Story = StoryObj<NxsCreateVersionDialogComponent>;

/** Version 1.2 of a contract: 1.3 or 2.0, with 2.0 chosen. Choosing Minor and creating sends it. */
export const MajorChosen: Story = {
  decorators: [withDialog()],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const major = await canvas.findByRole('radio', { name: /2\.0 Major version/ });
    // `ngModel` writes its first value a microtask after the radio renders.
    await waitFor(() => expect(major).toBeChecked());
    await userEvent.click(canvas.getByRole('radio', { name: /1\.3 Minor version/ }));
    await expect(canvas.getByRole('radio', { name: /1\.3 Minor version/ })).toBeChecked();
  },
};

/** Create pressed: the button shows progress until Nuxeo answers. */
export const Creating: Story = {
  decorators: [withDialog(() => NEVER)],
  play: async ({ canvasElement }) => {
    await userEvent.click(
      await within(canvasElement).findByRole('button', { name: 'Create Version' }),
    );
  },
};

/** Nuxeo refuses (403): the toast says so, and the dialog stays open. */
export const Refused: Story = {
  decorators: [withDialog(() => throwError(() => new HttpErrorResponse({ status: 403 })))],
};
