import type { Provider } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { of, throwError, type Observable } from 'rxjs';
import { action } from 'storybook/actions';
import { expect, userEvent, within } from 'storybook/test';

import { BrowseService, type NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';

import { dialogPreview } from '../../../.storybook/dialog-preview';

import {
  NxsFolderPickerDialogComponent,
  type NxsFolderPickerDialogData,
} from './folder-picker-dialog.component';

function folder(path: string, title: string): NuxeoDocument {
  return {
    uid: path,
    title,
    type: 'Folder',
    path,
    lastModified: '',
    properties: {},
    facets: ['Folderish'],
  } as NuxeoDocument;
}

const TREE: Record<string, NuxeoDocument[]> = {
  '/default-domain/workspaces': [
    folder('/default-domain/workspaces/claims', 'Claims'),
    folder('/default-domain/workspaces/legal', 'Legal'),
  ],
  '/default-domain/workspaces/claims': [folder('/default-domain/workspaces/claims/2026', '2026')],
};

const MOVE = {
  heading: 'Move "Claim 42" to',
  confirmLabel: 'Move here',
  initialPath: '/default-domain/workspaces',
};

/** The dialog with `data`, over a repository answered from memory; `fail` fails one listing. */
const withRepository = (
  data: NxsFolderPickerDialogData,
  fail?: { path: string; status: number },
) => {
  const list = (path: string): Observable<unknown> =>
    fail?.path === path
      ? throwError(() => ({ status: fail.status }))
      : of({ entries: TREE[path] ?? [] });
  const providers: Provider[] = [
    { provide: MAT_DIALOG_DATA, useValue: data },
    { provide: MatDialogRef, useValue: { close: action('dialogRef.close') } },
    {
      provide: BrowseService,
      useValue: {
        getByPath: (path: string) => of(folder(path, path.split('/').pop() ?? '')),
        getChildren: list,
      },
    },
  ];
  return applicationConfig({ providers });
};

const meta: Meta<NxsFolderPickerDialogComponent> = {
  title: 'Dialogs/Folder picker',
  component: NxsFolderPickerDialogComponent,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      api: { types: ['NxsFolderPickerDialogData', 'NxsFolderPickerDialogResult'] },
      source: {
        language: 'typescript',
        code: `this.dialog
  .open(NxsFolderPickerDialogComponent, {
    data: {
      heading: this.translate.instant('acme.move-heading', { name: doc.title }),
      confirmLabel: this.translate.instant('acme.move-here'),
      initialPath: here,
      currentParentPath: here,
    },
  })
  .afterClosed()
  .subscribe((target) => { if (target) this.move(doc, target.uid); });`,
      },
    },
  },
  render: dialogPreview('nxs-folder-picker-dialog'),
};

export default meta;

type Story = StoryObj<NxsFolderPickerDialogComponent>;

/** Choosing where to move a document: go into Claims, then Move here. */
export const ChoosingAFolder: Story = {
  decorators: [withRepository(MOVE)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Claims' }));
    await expect(await canvas.findByRole('button', { name: '2026' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Move here' })).toBeEnabled();
  },
};

/** The document is already in this folder, so it is not offered as the destination. */
export const AlreadyHere: Story = {
  decorators: [withRepository({ ...MOVE, currentParentPath: '/default-domain/workspaces' })],
};

/** A folder the user may not open: it says so, and offers Up. */
export const NoAccess: Story = {
  decorators: [withRepository(MOVE, { path: '/default-domain/workspaces', status: 403 })],
};
