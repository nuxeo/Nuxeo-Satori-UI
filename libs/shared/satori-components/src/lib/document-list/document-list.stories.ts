import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { throwError } from 'rxjs';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { DocumentDetailService, type NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';

import type { NxsHeadingLevel } from '../heading-level';
import { provideNxsComponents } from '../provide-nxs-components';
import { NxsDocumentListComponent, type NxsDocumentListColumn } from './document-list.component';

const HEADING_LEVELS: readonly NxsHeadingLevel[] = [1, 2, 3, 4, 5, 6];

function document(
  uid: string,
  title: string,
  type: string,
  modified: string,
  contributor: string,
  facets: string[] = [],
): NuxeoDocument {
  return {
    uid,
    title,
    type,
    facets,
    path: `/default-domain/workspaces/Claims/${uid}`,
    lastModified: modified,
    properties: { 'dc:lastContributor': contributor, 'dc:created': '2026-01-05T09:00:00.000Z' },
  } as NuxeoDocument;
}

/** A claims folder: two sub-folders, then files, in the server's order. */
const CLAIMS: readonly NuxeoDocument[] = [
  document('archive', 'Archive', 'Folder', '2026-09-01T10:00:00Z', 'Administrator', ['Folderish']),
  document('pending', 'Pending review', 'Folder', '2026-09-14T08:30:00Z', 'jsmith', ['Folderish']),
  document('claim-42', 'Claim 42 — water damage', 'File', '2026-10-02T16:45:00Z', 'jsmith'),
  document('claim-43', 'Claim 43 — storm', 'File', '2026-10-03T11:20:00Z', 'mlopez'),
  document('photos', 'Site photos', 'Picture', '2026-10-04T09:05:00Z', 'mlopez'),
  document('notes', 'Adjuster notes', 'Note', '2026-10-06T14:10:00Z', 'Administrator'),
];

const COLUMNS: readonly NxsDocumentListColumn[] = [
  { key: 'title', label: 'Title', sortable: true },
  { key: 'type', label: 'Type' },
  { key: 'modified', label: 'Modified', sortable: true },
  { key: 'lastContributor', label: 'Last contributor', sortable: true },
];

/**
 * One page of a folder as a table. The host fetches the page and the order; the list shows what it
 * is given, never sorts it, and asks for another order or page. Thumbnails here answer "none", so
 * each row shows its type icon.
 */
const meta: Meta<NxsDocumentListComponent> = {
  title: 'Tables/Document list',
  component: NxsDocumentListComponent,
  tags: ['autodocs'],
  decorators: [
    applicationConfig({
      providers: [
        provideNxsComponents(),
        {
          provide: DocumentDetailService,
          useValue: { fetchThumbnail: () => throwError(() => ({ status: 404 })) },
        },
      ],
    }),
  ],
  parameters: { layout: 'padded' },
  args: {
    documents: CLAIMS,
    columns: COLUMNS,
    label: 'Contents of Claims',
    sort: null,
    selectedIds: [],
    selectable: true,
    pageIndex: 0,
    pageSize: 50,
    totalSize: 6,
    hasNextPage: false,
    loading: false,
    error: null,
    errorHeading: 'The folder could not be loaded',
    emptyHeading: '',
    emptyMessage: '',
    stateHeadingLevel: 2,
    rowActions: {},
    dropEnabled: false,
    dropLabel: '',
    sortChange: fn(),
    pageChange: fn(),
    open: fn(),
    rowAction: fn(),
    filesDropped: fn(),
    retry: fn(),
  },
  argTypes: {
    documents: { control: 'object', description: 'The page on screen, in the server’s order.' },
    columns: { control: 'object', description: 'The columns, in order.' },
    label: { control: 'text', description: 'The table’s accessible name, already translated.' },
    sort: { control: 'object', description: 'The order the page is in, or null.' },
    selectedIds: { control: 'object', description: 'The selected documents’ ids, on every page.' },
    selectable: { control: 'boolean', description: 'Shows the selection checkboxes.' },
    pageIndex: {
      control: { type: 'number', min: 0 },
      description: 'The page on screen, from zero.',
    },
    pageSize: {
      control: { type: 'number', min: 1 },
      description: 'How many rows a full page holds.',
    },
    totalSize: {
      control: 'number',
      description: 'Every document across every page; negative when not counted.',
    },
    hasNextPage: { control: 'boolean', description: 'Whether the server has another page.' },
    loading: { control: 'boolean', description: 'Shows the loader in place of the rows.' },
    error: {
      control: 'select',
      options: [null, 401, 403, 404, 500],
      description: 'The status of the request that failed, or null.',
    },
    errorHeading: { control: 'text', description: 'What failed. Shown for a server error only.' },
    emptyHeading: { control: 'text', description: 'The empty state’s heading.' },
    emptyMessage: { control: 'text', description: 'The empty state’s second line.' },
    stateHeadingLevel: {
      control: 'select',
      options: HEADING_LEVELS,
      description: 'The level of the empty and error states’ headings.',
    },
    rowActions: { control: 'object', description: 'Each row’s menu entries, by document id.' },
    dropEnabled: { control: 'boolean', description: 'Accepts files dragged onto the list.' },
    dropLabel: { control: 'text', description: 'What the list says while files are over it.' },
    sortChange: { control: false, description: 'The order asked for, or null when cleared.' },
    pageChange: { control: false, description: 'The page index asked for.' },
    open: { control: false, description: 'A row was opened.' },
    rowAction: { control: false, description: 'A row’s menu entry was chosen.' },
    filesDropped: { control: false, description: 'Files dropped on the list.' },
    retry: { control: false, description: 'Retry was pressed on a server error.' },
  },
};

export default meta;

type Story = StoryObj<NxsDocumentListComponent>;

/** A folder's first page in the server's order. Click a header to ask for another order. */
export const FolderContents: Story = {};

/** Sorted on the server by Modified, newest first: that header says so, and only that one. */
export const SortedByModified: Story = {
  args: { sort: { key: 'modified', direction: 'desc' } },
};

/** Two documents selected: their rows are highlighted and the header checkbox is indeterminate. */
export const WithASelection: Story = {
  args: { selectedIds: ['claim-42', 'photos'] },
};

/**
 * From the keyboard: Tab reaches one row, Space selects it, Shift+Down extends the selection and
 * Enter opens the row with focus.
 */
export const KeyboardSelection: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const rows = canvas.getAllByRole('row').filter((row) => row.closest('tbody'));
    rows[0].focus();
    await userEvent.keyboard(' ');
    await userEvent.keyboard('{Shift>}{ArrowDown}{ArrowDown}{/Shift}');
    await waitFor(() =>
      expect(rows.map((row) => within(row).getByRole('checkbox').matches(':checked'))).toEqual([
        true,
        true,
        true,
        false,
        false,
        false,
      ]),
    );
    await expect(rows[2]).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await expect(args.open).toHaveBeenCalledWith(expect.objectContaining({ uid: 'claim-42' }));
  },
};

/** Page two of a six-document folder at four a page, which Nuxeo counted: "5–6 of 6". */
export const SecondPage: Story = {
  args: { pageIndex: 1, pageSize: 4, totalSize: 6, documents: CLAIMS.slice(4) },
};

/** Each row with a menu of its own, named for the row. */
export const WithRowActions: Story = {
  args: {
    rowActions: {
      archive: [
        { id: 'acme.collection.edit', label: 'Edit', icon: 'pencil' },
        { id: 'acme.collection.delete', label: 'Delete', icon: 'trash' },
      ],
    },
  },
};

/** While a page loads. */
export const Loading: Story = {
  args: { loading: true },
};

/** An empty folder, with a heading of the host's own. */
export const Empty: Story = {
  args: { documents: [], emptyHeading: 'This folder is empty' },
};

/** A 403: it says the user has no access, not that something broke, and offers no Retry. */
export const PermissionDenied: Story = {
  args: { error: 403 },
};

/** A server error: the host's heading, and Retry. */
export const ServerError: Story = {
  args: { error: 500 },
};

/** Accepts files dragged from the computer; dropping one reports the files to the host. */
export const AcceptsDroppedFiles: Story = {
  args: { dropEnabled: true, dropLabel: 'Drop files to upload them to Claims' },
};
