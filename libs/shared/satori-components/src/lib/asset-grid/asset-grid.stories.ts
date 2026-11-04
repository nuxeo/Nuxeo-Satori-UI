import type { Meta, StoryObj } from '@storybook/angular';
import { expect, fn, userEvent, within } from 'storybook/test';

import { NxsAssetGridComponent, type NxsAssetCard } from './asset-grid.component';

/** A 1×1 transparent GIF, so the stories draw a real image without a Nuxeo server. */
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const assets: readonly NxsAssetCard[] = [
  { id: '1', name: 'Spring campaign hero.jpg', type: 'Picture', icon: 'file', thumbnailUrl: PIXEL },
  { id: '2', name: 'Product launch.mp4', type: 'Video', icon: 'file', thumbnailUrl: PIXEL },
  { id: '3', name: 'Brand guidelines.pdf', type: 'File', icon: 'page', thumbnailUrl: null },
  { id: '4', name: 'Packshot — front.png', type: 'Picture', icon: 'file', thumbnailUrl: PIXEL },
  { id: '5', name: 'Interview audio.mp3', type: 'Audio', icon: 'audio', thumbnailUrl: null },
];

/**
 * The grid of asset cards on the asset search screen. It owns no search, no selection and no
 * navigation: the host passes the cards and the selection, and the grid reports what was pressed.
 */
const meta: Meta<NxsAssetGridComponent> = {
  title: 'Tables/Asset grid',
  component: NxsAssetGridComponent,
  tags: ['autodocs'],
  args: {
    assets,
    selectedIds: [],
    selectable: true,
    label: '',
    assetOpen: fn(),
    selectionToggle: fn(),
  },
  argTypes: {
    assets: {
      control: 'object',
      description: 'The cards, in the order they are shown. The host sorts them.',
    },
    selectedIds: {
      control: 'object',
      description: 'Which cards are selected, by id. A `Set` or a list.',
    },
    selectable: {
      control: 'boolean',
      description: 'Whether to offer the checkboxes at all.',
    },
    label: {
      control: 'text',
      description:
        'The grid’s accessible name, already translated. Blank, or only whitespace or zero-width characters, names it “Assets”.',
    },
    assetOpen: { control: false, description: 'The card whose name was pressed.' },
    selectionToggle: { control: false, description: 'The id whose checkbox was changed.' },
  },
};

export default meta;

type Story = StoryObj<NxsAssetGridComponent>;

/** A page of search results: thumbnails where Nuxeo had a rendition, the type icon where it did not. */
export const SearchResults: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('list', { name: 'Assets' })).toBeVisible();
    await expect(canvas.getAllByRole('listitem')).toHaveLength(5);
    await userEvent.click(canvas.getByRole('button', { name: 'Product launch.mp4' }));
    await expect(args.assetOpen).toHaveBeenCalledWith(
      expect.objectContaining({ id: '2' }) as unknown as NxsAssetCard,
    );
  },
};

/** Two assets selected: the card is tinted and its checkbox stays visible. */
export const WithASelection: Story = {
  args: { selectedIds: ['2', '4'] },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('checkbox', { name: 'Select Brand guidelines.pdf' }));
    await expect(args.selectionToggle).toHaveBeenCalledWith('3');
  },
};

/** A read-only listing: no checkboxes, and the names still open their documents. */
export const NotSelectable: Story = {
  args: { selectable: false },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryAllByRole('checkbox')).toHaveLength(0);
  },
};

/** No thumbnails yet — every card shows its document-type icon and keeps its place. */
export const ThumbnailsMissing: Story = {
  args: { assets: assets.map((asset) => ({ ...asset, thumbnailUrl: null })) },
};

/** No results. The grid renders nothing; the screen around it owns the empty state. */
export const NoAssets: Story = {
  args: { assets: [] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('list')).toBeNull();
  },
};

/** Tab reaches the checkbox and then the name; Space ticks, Enter opens. */
export const KeyboardContract: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const checkbox = canvas.getByRole('checkbox', { name: 'Select Spring campaign hero.jpg' });
    checkbox.focus();
    await userEvent.keyboard(' ');
    await expect(args.selectionToggle).toHaveBeenLastCalledWith('1');
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Spring campaign hero.jpg' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await expect(args.assetOpen).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: '1' }) as unknown as NxsAssetCard,
    );
  },
};
