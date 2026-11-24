import type { Provider } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { NEVER, of, throwError, type Observable } from 'rxjs';
import { action } from 'storybook/actions';
import { expect, userEvent, within } from 'storybook/test';

import {
  DocumentDetailService,
  type NuxeoDocument,
  type NuxeoDocumentList,
} from '@nuxeo/satori-platform/nuxeo-client';

import { dialogPreview } from '../../../.storybook/dialog-preview';

import { NxsPublishDialogComponent, type NxsPublishDialogData } from './publish-dialog.component';

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

const node = (uid: string, path: string, title: string, props = {}): NuxeoDocument => ({
  uid,
  path,
  title,
  type: 'Section',
  lastModified: '2026-10-01T00:00:00.000Z',
  properties: props,
});

const SECTIONS: NuxeoDocument[] = [
  node('sec-root', '/default-domain/sections', 'Sections'),
  node('sec-legal', '/default-domain/sections/legal', 'Legal'),
  node('sec-contracts', '/default-domain/sections/legal/contracts', 'Contracts'),
  node('sec-press', '/default-domain/sections/press', 'Press'),
];

const VERSIONS: NuxeoDocument[] = [
  node('v-1-0', '/v', 'Supplier contract', { 'uid:major_version': 1, 'uid:minor_version': 0 }),
  node('v-1-1', '/v', 'Supplier contract', { 'uid:major_version': 1, 'uid:minor_version': 1 }),
];

const CONTRACT: NxsPublishDialogData = {
  documentUid: 'story-doc',
  documentTitle: 'Supplier contract',
  versionLabel: '1.2',
  renditions: [
    { name: 'pdf', label: 'PDF' },
    { name: 'thumbnail', label: 'Thumbnail' },
  ],
};

const listOf = (entries: NuxeoDocument[]): NuxeoDocumentList => ({
  entries,
  totalSize: entries.length,
  resultsCount: entries.length,
  currentPageSize: entries.length,
  currentPageIndex: 0,
  numberOfPages: 1,
  isNextPageAvailable: false,
});

const withDialog = (
  sections: () => Observable<NuxeoDocumentList> = () => of(listOf(SECTIONS)),
  publish: () => Observable<NuxeoDocument> = () => of({ uid: 'proxy-1' } as NuxeoDocument),
) => {
  const detail: Pick<
    DocumentDetailService,
    'getSectionTree' | 'getVersionsDirect' | 'publishDocument'
  > = {
    getSectionTree: logged('getSectionTree', sections),
    getVersionsDirect: logged('getVersionsDirect', () => of(VERSIONS)),
    publishDocument: logged('publishDocument', publish),
  };
  const dialogRef: Pick<MatDialogRef<NxsPublishDialogComponent>, 'close'> = {
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
 * Publish a document to a section: the section tree, the version to publish, a rendition instead
 * of the document, and whether to override what the section already has.
 */
const meta: Meta<NxsPublishDialogComponent> = {
  title: 'Dialogs/Publish',
  component: NxsPublishDialogComponent,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      api: { types: ['NxsPublishDialogData', 'NxsPublishRendition'] },
      source: {
        language: 'typescript',
        code: `nxsOpenPublishDialog(this.dialog, this.components, {
  documentUid: doc.uid,
  documentTitle: doc.title,
  versionLabel: '1.2',
  renditions: [{ name: 'pdf', label: 'PDF' }],
});`,
      },
    },
  },
  render: dialogPreview('nxs-publish-dialog', { width: '600px', maxWidth: '95vw' }),
};

export default meta;

type Story = StoryObj<NxsPublishDialogComponent>;

/** The sections as a tree, the document at 1.2 and its earlier versions; Publish waits for a section. */
export const ChooseASection: Story = {
  decorators: [withDialog()],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('button', { name: 'Publish' })).toBeDisabled();
    await userEvent.click(canvas.getByRole('combobox', { name: /Location/ }));
    await userEvent.click(await within(document.body).findByRole('option', { name: 'Contracts' }));
    await expect(canvas.getByRole('button', { name: 'Publish' })).toBeEnabled();
  },
};

/** Show renditions ticked: a rendition can be published instead of the document. */
export const WithRenditions: Story = {
  decorators: [withDialog()],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('checkbox', { name: 'Show renditions' }));
    await expect(canvas.getByRole('combobox', { name: 'Rendition' })).toBeInTheDocument();
  },
};

/** The sections are still being read. */
export const Loading: Story = {
  decorators: [withDialog(() => NEVER)],
};

/** The server lists no section the user can publish to. */
export const NoSections: Story = {
  decorators: [withDialog(() => of(listOf([])))],
};

/** The sections could not be read: the dialog says so and offers to try again. */
export const SectionsFailed: Story = {
  decorators: [withDialog(() => throwError(() => new HttpErrorResponse({ status: 500 })))],
};

/** Nuxeo refuses (403): the toast says so, and the dialog stays open. */
export const Refused: Story = {
  decorators: [
    withDialog(undefined, () => throwError(() => new HttpErrorResponse({ status: 403 }))),
  ],
};
