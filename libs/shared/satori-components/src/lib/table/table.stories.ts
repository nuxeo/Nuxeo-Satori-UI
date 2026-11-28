import type { Meta, StoryObj } from '@storybook/angular';
import { expect, within } from 'storybook/test';

import { NxsTableComponent, type NxsTableRow } from './table.component';

/** A shared link's downloads, as a record page's share links list them. */
const DOWNLOADS: readonly NxsTableRow[] = [
  ['25 Nov 2026, 16:30', 'ab12cd34', 'FullHD'],
  ['25 Nov 2026, 16:00', 'ab12cd34', 'Original file'],
  ['24 Nov 2026, 09:12', 'ef56gh78', 'Medium'],
];

/**
 * A table of text: Angular Material's table on a native `<table>`, with a caption, column headers
 * of `scope="col"` and an optional empty row. The text stands in for what a caller binds through its
 * translate pipe.
 */
const meta: Meta<NxsTableComponent> = {
  title: 'Tables/Table',
  component: NxsTableComponent,
  tags: ['autodocs'],
  args: {
    caption: 'Downloads',
    hideCaption: false,
    columns: ['Time', 'Link', 'Item'],
    rows: DOWNLOADS,
    emptyText: '',
    dense: false,
  },
  argTypes: {
    caption: { control: 'text', description: 'The table’s caption, already translated. Required.' },
    columns: { description: 'The column headers, already translated, in order. Required.' },
    rows: { description: 'The rows, each its cells’ text, in the columns’ order.' },
    emptyText: { control: 'text' },
  },
};

export default meta;

type Story = StoryObj<NxsTableComponent>;

/** Its caption, its headers and its rows. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const table = canvas.getByRole('table', { name: 'Downloads' });
    const headers = within(table).getAllByRole('columnheader');
    await expect(headers.map((header) => header.textContent?.trim())).toEqual([
      'Time',
      'Link',
      'Item',
    ]);
    await expect(headers.every((header) => header.getAttribute('scope') === 'col')).toBe(true);
    await expect(within(table).getAllByRole('row')).toHaveLength(4);
  },
};

/** Compact rows, as inside a card, with the caption said only to assistive technology. */
export const DenseInACard: Story = {
  args: { dense: true, hideCaption: true },
  render: (args) => ({
    props: args,
    template: `<section aria-labelledby="claims-heading" style="max-width: 480px; padding: 16px; border: 1px solid var(--mat-sys-outline-variant); border-radius: 12px">
  <h3 id="claims-heading" style="margin: 0 0 8px">Downloads</h3>
  <nxs-table [caption]="caption" [hideCaption]="hideCaption" [columns]="columns" [rows]="rows" [dense]="dense" />
</section>`,
  }),
};

/** No rows yet: the empty text, in one row across the columns. */
export const Empty: Story = {
  args: { rows: [], emptyText: 'Nothing has been downloaded through these links yet.' },
  play: async ({ canvasElement }) => {
    const table = within(canvasElement).getByRole('table', { name: 'Downloads' });
    await expect(table).toHaveTextContent('Nothing has been downloaded through these links yet.');
  },
};

/** A field shown as a table, a row to each entry: a row shorter than the columns leaves cells empty. */
export const FieldAsTable: Story = {
  args: {
    caption: 'Dependants',
    hideCaption: true,
    dense: true,
    columns: ['Name', 'Relationship', 'Date of birth'],
    rows: [
      ['Ana Silva', 'Child', '3 Mar 2015'],
      ['João Silva', 'Spouse'],
    ],
  },
};
