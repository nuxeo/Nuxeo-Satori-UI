import type { Meta, StoryObj } from '@storybook/angular';
import { expect, fn, userEvent, within } from 'storybook/test';

import { NxsAssetFacetsDrawerComponent, type NxsFacetGroup } from './asset-facets-drawer.component';

const groups: readonly NxsFacetGroup[] = [
  {
    id: 'asset-type',
    label: 'Asset type',
    dynamic: true,
    options: [
      { value: 'Picture', label: 'Picture', selected: true, count: 412 },
      { value: 'Video', label: 'Video', selected: false, count: 38 },
      { value: 'Audio', label: 'Audio', selected: false, count: 7 },
    ],
  },
  {
    id: 'asset-format',
    label: 'Format',
    dynamic: true,
    options: [
      { value: 'image/jpeg', label: 'JPEG', selected: false, count: 301 },
      { value: 'image/png', label: 'PNG', selected: false, count: 111 },
    ],
  },
  {
    id: 'asset-width',
    label: 'Width',
    dynamic: false,
    options: [
      { value: 'small', label: 'Up to 800 px', selected: false, count: 0 },
      { value: 'large', label: 'Over 1920 px', selected: false, count: 64 },
    ],
  },
  { id: 'color-profile', label: 'Colour profile', dynamic: true, options: [] },
];

/**
 * The faceted filter panel of the assets drawer. It owns no query and no aggregates: the host
 * passes the groups with their labels and counts already resolved, and the panel reports what the
 * user did.
 */
const meta: Meta<NxsAssetFacetsDrawerComponent> = {
  title: 'Search/Asset facets drawer',
  component: NxsAssetFacetsDrawerComponent,
  tags: ['autodocs'],
  args: {
    groups,
    fullText: '',
    autoSearch: true,
    canSaveAs: true,
    label: '',
    initiallyExpandedGroupIds: ['asset-type'],
    fullTextChange: fn(),
    fullTextSubmit: fn(),
    optionToggle: fn(),
    autoSearchChange: fn(),
    action: fn(),
  },
  argTypes: {
    groups: { control: 'object', description: 'The facet groups, in the order they are shown.' },
    fullText: { control: 'text', description: 'What is in the full-text box.' },
    autoSearch: {
      control: 'boolean',
      description: 'Whether a changed facet searches at once. With `false`, Search appears.',
    },
    canSaveAs: { control: 'boolean', description: 'Whether anything is filtered.' },
    label: {
      control: 'text',
      description:
        'The panel’s accessible name, already translated. Blank, or only whitespace or zero-width characters, names it “Asset filters”.',
    },
    initiallyExpandedGroupIds: { control: 'object', description: 'Which groups start open.' },
    fullTextChange: { control: false, description: 'The box as it is typed in.' },
    fullTextSubmit: { control: false, description: 'The box submitted, trimmed.' },
    optionToggle: { control: false, description: 'A choice was flipped.' },
    autoSearchChange: { control: false, description: 'The auto-search switch moved.' },
    action: { control: false, description: 'A footer button: reset, save-as or search.' },
  },
};

export default meta;

type Story = StoryObj<NxsAssetFacetsDrawerComponent>;

/** The drawer as it opens: the asset-type group expanded, with the server's counts. */
export const AssetFilters: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('region', { name: 'Asset filters' })).toBeVisible();
    await userEvent.click(canvas.getByRole('checkbox', { name: 'Video' }));
    await expect(args.optionToggle).toHaveBeenCalledWith({
      groupId: 'asset-type',
      value: 'Video',
    });
  },
};

/** Opening a second group. The panel keeps its own expansion state; the host is not told. */
export const ExpandingAGroup: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const format = canvas.getByRole('button', { name: /Format/ });
    await expect(format).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(format);
    await expect(format).toHaveAttribute('aria-expanded', 'true');
    await expect(canvas.getByRole('checkbox', { name: 'JPEG' })).toBeVisible();
  },
};

/** A dynamic group the server had no buckets for says so, rather than looking broken. */
export const AnEmptyFacet: Story = {
  args: { initiallyExpandedGroupIds: ['color-profile'] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('No available results')).toBeVisible();
  },
};

/** With auto search off, the Search button appears and nothing runs until it is pressed. */
export const ManualSearch: Story = {
  args: { autoSearch: false },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Search' }));
    await expect(args.action).toHaveBeenCalledWith('search');
  },
};

/** Nothing filtered yet, so there is no search worth saving. */
export const NothingFiltered: Story = {
  args: {
    canSaveAs: false,
    groups: groups.map((group) => ({
      ...group,
      options: group.options.map((option) => ({ ...option, selected: false })),
    })),
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'Save as' })).toBeDisabled();
  },
};

/** Typing searches the whole content of a document, and Clear empties and searches again. */
export const FullText: Story = {
  args: { fullText: 'invoice' },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Clear the search text' }));
    await expect(args.fullTextSubmit).toHaveBeenCalledWith('');
  },
};

/** Every control is an ordinary one: Tab reaches the box, then Clear, then the first group. */
export const KeyboardContract: Story = {
  args: { fullText: 'invoice' },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const box = canvas.getByRole('searchbox');
    box.focus();
    await userEvent.keyboard('{Enter}');
    await expect(args.fullTextSubmit).toHaveBeenLastCalledWith('invoice');
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Clear the search text' })).toHaveFocus();
  },
};
