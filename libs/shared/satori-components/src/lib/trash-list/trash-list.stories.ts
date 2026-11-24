import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { of, throwError } from 'rxjs';
import { action } from 'storybook/actions';
import { expect, fn, within } from 'storybook/test';

import {
  DocumentDetailService,
  TrashService,
  type NuxeoDocument,
  type NuxeoDocumentList,
} from '@nuxeo/satori-platform/nuxeo-client';

import { NxsTrashListComponent } from './trash-list.component';

const TRASHED = [
  ['Q3 invoice', 'File', 'jdoe'],
  ['Meeting notes', 'Note', 'asmith'],
  ['Brand assets', 'Folder', 'jdoe'],
  ['Contract draft', 'File', 'mlee'],
].map(
  ([title, type, contributor], index) =>
    ({
      'entity-type': 'document',
      uid: `trashed-${index}`,
      title,
      type,
      path: `/default-domain/workspaces/Acme/${title}`,
      isTrashed: true,
      properties: {
        'dc:modified': `2026-10-0${index + 1}T09:30:00.000Z`,
        'dc:created': '2026-09-01T09:30:00.000Z',
        'dc:lastContributor': contributor,
        'dc:creator': contributor,
      },
    }) as unknown as NuxeoDocument,
);

/** The list with a trash that answers from memory. `fail` makes the search fail. */
const withTrash = (entries: readonly NuxeoDocument[], fail = false) =>
  applicationConfig({
    providers: [
      {
        provide: TrashService,
        useValue: {
          searchTrash: (params: unknown) => {
            action('searchTrash')(params);
            return fail
              ? throwError(() => ({ status: 500 }))
              : of<NuxeoDocumentList>({
                  entries: [...entries],
                  resultsCount: entries.length,
                  totalSize: entries.length,
                  currentPageSize: entries.length,
                  currentPageIndex: 0,
                  numberOfPages: 1,
                });
          },
          restoreDocument: (uid: string) => {
            action('restoreDocument')(uid);
            return of({});
          },
          permanentlyDelete: (uid: string) => {
            action('permanentlyDelete')(uid);
            return of(undefined);
          },
        },
      },
      {
        provide: DocumentDetailService,
        useValue: { fetchThumbnail: () => throwError(() => ({ status: 404 })) },
      },
    ],
  });

const meta: Meta<NxsTrashListComponent> = {
  title: 'Components/Trash list',
  component: NxsTrashListComponent,
  tags: ['autodocs'],
  args: { openHandler: fn(), resultsHandler: fn() },
  argTypes: {
    initialView: { control: 'select', options: ['table', 'grid', 'list'] },
  },
  parameters: {
    docs: { api: { types: ['NxsTrashListResults', 'NxsTrashListView'] } },
  },
  decorators: [withTrash(TRASHED)],
};

export default meta;

type Story = StoryObj<NxsTrashListComponent>;

/** The trash as a table: sortable headers, selection, and Restore and Delete permanently on each row. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('table', { name: 'Trashed documents' })).toBeVisible();
    await expect(await canvas.findByText('4 trashed documents')).toBeVisible();
  },
};

/** The same documents as cards. */
export const Grid: Story = {
  args: { initialView: 'grid' },
};

/** The same documents as a list, with Restore and Delete permanently on each item. */
export const List: Story = {
  args: { initialView: 'list' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole('button', { name: 'Restore Meeting notes' }),
    ).toBeInTheDocument();
  },
};

/** Nothing in the trash, or nothing matching the filters. */
export const Empty: Story = {
  decorators: [withTrash([])],
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText('The trash is empty')).toBeVisible();
  },
};

/** The server failed to return the trash: the state says so and offers to try again. */
export const LoadFailed: Story = {
  decorators: [withTrash([], true)],
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText('The trash could not be loaded'),
    ).toBeVisible();
  },
};
