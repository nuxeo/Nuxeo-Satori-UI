import type { Provider } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { delay, of, throwError, type Observable } from 'rxjs';
import { action } from 'storybook/actions';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { DocumentDetailService, type NuxeoDocument } from '@nuxeo-satori/platform/nuxeo-client';

import { NxsManageVersionsComponent } from './manage-versions.component';

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

const DAY = 86_400_000;

function document(over: Partial<NuxeoDocument> = {}, version: [number, number] = [1, 2]) {
  return {
    uid: 'contract',
    title: 'Supplier contract',
    type: 'File',
    path: '/default-domain/workspaces/legal/Supplier contract',
    facets: ['Versionable'],
    isCheckedOut: true,
    properties: { 'uid:major_version': version[0], 'uid:minor_version': version[1] },
    contextParameters: { permissions: ['Read', 'Write', 'WriteVersion'] },
    ...over,
  } as NuxeoDocument;
}

function version(major: number, minor: number, daysAgo: number, who: string): NuxeoDocument {
  return document(
    {
      uid: `contract-${major}-${minor}`,
      isVersion: true,
      isCheckedOut: false,
      versionableId: 'contract',
      properties: {
        'uid:major_version': major,
        'uid:minor_version': minor,
        'dc:modified': new Date(Date.now() - daysAgo * DAY).toISOString(),
        'dc:lastContributor': who,
      },
    },
    [major, minor],
  );
}

const VERSIONS = [version(0, 1, 30, 'jdoe'), version(1, 0, 12, 'asmith'), version(1, 2, 2, 'jdoe')];

const withVersions = (
  getVersionsDirect: () => Observable<NuxeoDocument[]> = () => of(VERSIONS).pipe(delay(300)),
) => {
  const detail: Pick<DocumentDetailService, 'getVersionsDirect' | 'createVersion'> = {
    getVersionsDirect: logged('getVersionsDirect', getVersionsDirect),
    createVersion: logged('createVersion', () => of(version(2, 0, 0, 'jdoe'))),
  };
  return applicationConfig({
    providers: [{ provide: DocumentDetailService, useValue: detail }] satisfies Provider[],
  });
};

/**
 * A document's versions, as the document's info panel shows them: the number, which opens the list
 * newest first; Create Version while there are changes to version; and the way back to the latest
 * while a version is open. Choosing a version asks the host to open it — it never restores.
 */
const meta: Meta<NxsManageVersionsComponent> = {
  title: 'Documents/Manage versions',
  component: NxsManageVersionsComponent,
  tags: ['autodocs'],
  render: (args) => ({
    props: args,
    template: `
      <div style="padding: 16px; min-height: 280px; background: var(--mat-sys-surface)">
        <nxs-manage-versions
          [document]="document"
          (versionSelected)="versionSelected($event)"
          (latestSelected)="latestSelected()"
          (versionCreated)="versionCreated($event)"
        />
      </div>
    `,
  }),
  args: { document: document() },
  argTypes: {
    document: {
      control: 'object',
      description:
        'The document on screen — the live document or one of its versions. Required. Needs the `permissions` enricher.',
    },
    versionSelected: {
      action: 'versionSelected',
      description: 'A version the user chose. Open it read-only.',
    },
    latestSelected: {
      action: 'latestSelected',
      description: 'The live document, chosen while a version is on screen.',
    },
    versionCreated: {
      action: 'versionCreated',
      description: 'A version was created; reload the document.',
    },
  },
};

export default meta;

type Story = StoryObj<NxsManageVersionsComponent>;

/** Checked out at 1.2+: the list offers Create Version above the versions, newest first. */
export const CheckedOut: Story = {
  decorators: [withVersions()],
  play: async ({ canvasElement }) => {
    await userEvent.click(
      await within(canvasElement).findByRole('button', { name: 'Version 1.2+' }),
    );
    const menu = within(canvasElement.ownerDocument.body);
    await waitFor(() =>
      expect(menu.getByRole('menuitemradio', { name: /^1\.2 Modified/ })).toBeVisible(),
    );
    await expect(await menu.findByRole('menuitem', { name: 'Create Version' })).toBeVisible();
  },
};

/** Checked in at 1.2: nothing new to version, so the list has no Create Version. */
export const CheckedIn: Story = {
  decorators: [withVersions()],
  args: { document: document({ isCheckedOut: false }) },
};

/** Version 1.0 open: the list leads back to the latest and marks 1.0 as the one on screen. */
export const ViewingAVersion: Story = {
  decorators: [withVersions()],
  args: { document: version(1, 0, 12, 'asmith') },
};

/** Never versioned, and the user may version it: the control is the Create Version button. */
export const NoVersionYet: Story = {
  decorators: [withVersions()],
  args: { document: document({}, [0, 0]) },
};

/** Never versioned, without `WriteVersion` (or not `Versionable`, or a record): "Unversioned". */
export const Unversioned: Story = {
  decorators: [withVersions()],
  args: {
    document: document({ contextParameters: { permissions: ['Read', 'Write'] } }, [0, 0]),
  },
};

/** The list cannot be read: it says so and offers Retry. */
export const ListFails: Story = {
  decorators: [withVersions(() => throwError(() => new HttpErrorResponse({ status: 500 })))],
};
