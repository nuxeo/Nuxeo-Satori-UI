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

/**
 * Every part of the card opens the document, including under the type pill.
 *
 * `userEvent.click` cannot see this: it dispatches on the element it is handed and never consults
 * stacking order, so it reports a hit on a point the user's pointer could never reach. The check
 * has to be `elementFromPoint`, which is the same hit test the browser runs for a real click.
 */
export const TheWholeCardOpens: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const card = canvas.getAllByRole('listitem')[0];
    const name = canvas.getByRole('button', { name: 'Spring campaign hero.jpg' });

    const hit = (element: Element): Element | null => {
      const box = element.getBoundingClientRect();
      return document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    };

    /* The button itself, or anything inside it, is a real hit: a click there runs the handler, on
       the button or by bubbling up to it. An ANCESTOR of the button is not, and must not be
       accepted — clicks do not travel downwards. Containment tested both ways would accept one,
       and that is the dead zone this story exists to catch rather than a hypothetical: with the
       overlay stopping short of the type row, the hit at the pill's centre lands on
       `div.nxs-asset-grid__body`, which contains the button but carries no handler. Measured in
       Chromium — a real `mouse.click()` at that point reaches the button 0 times, while a check
       that allowed ancestors stayed green over it. */
    const reached = (landed: Element | null): string => {
      if (landed === name || name.contains(landed)) return 'the name button';
      if (landed === null) return 'nothing';
      const classes = String(landed.className).trim().split(/\s+/).filter(Boolean).join('.');
      return `${landed.tagName.toLowerCase()}${classes ? `.${classes}` : ''}`;
    };

    // The checkbox is the one region that must NOT open the document — it is its own control.
    for (const region of ['.nxs-asset-grid__thumbnail', '.nxs-asset-grid__type'] as const) {
      const target = card.querySelector(region);
      await expect(target).not.toBeNull();
      // Asserted as a string, not a boolean: a failure then names the element the pointer would
      // have reached instead, which `expected false to be true` cannot.
      await expect(`${region} hits ${reached(hit(target as Element))}`).toBe(
        `${region} hits the name button`,
      );
    }
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
