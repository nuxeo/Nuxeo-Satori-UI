import type { Meta, StoryObj } from '@storybook/angular';
import { expect, fn, userEvent, within } from 'storybook/test';

import { NxsPagerComponent } from './pager.component';

/**
 * Previous and Next for a list the server pages. Nuxeo counts a folder's children only when they fit
 * on one page, so the pager shows "of N" only for a real total and follows `hasNextPage` for Next.
 */
const meta: Meta<NxsPagerComponent> = {
  title: 'Tables/Pager',
  component: NxsPagerComponent,
  tags: ['autodocs'],
  args: {
    pageIndex: 1,
    pageSize: 50,
    itemCount: 50,
    totalSize: -2,
    hasNextPage: true,
    disabled: false,
    label: '',
    pageChange: fn(),
  },
  argTypes: {
    pageIndex: {
      control: { type: 'number', min: 0 },
      description: 'The page on screen, from zero.',
    },
    pageSize: {
      control: { type: 'number', min: 1 },
      description: 'How many items a full page holds.',
    },
    itemCount: {
      control: { type: 'number', min: 0 },
      description: 'How many items the page on screen holds.',
    },
    totalSize: {
      control: 'number',
      description: 'Every item across every page; negative when the server did not count them.',
    },
    hasNextPage: { control: 'boolean', description: 'Whether the server has another page.' },
    disabled: { control: 'boolean', description: 'Disables both buttons while a page loads.' },
    label: {
      control: 'text',
      description:
        'The landmark’s accessible name, already translated. Blank, or only whitespace or zero-width characters, names it “Pages”.',
    },
    pageChange: { control: false, description: 'The page index to load.' },
  },
};

export default meta;

type Story = StoryObj<NxsPagerComponent>;

/** The second page of a folder Nuxeo did not count: the range, with no total. */
export const UncountedFolder: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('51–100')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Next page' }));
    await expect(args.pageChange).toHaveBeenCalledWith(2);
  },
};

/** The last page of a collection, which Nuxeo counts: "of N" appears and Next is disabled. */
export const LastPageOfACountedList: Story = {
  args: { itemCount: 10, totalSize: 60, hasNextPage: false },
};

/** The server offered a next page that was empty: the range gives way to "No more items". */
export const PastTheEnd: Story = {
  args: { pageIndex: 2, itemCount: 0, hasNextPage: false },
};

/** While the next page loads, neither button can be pressed twice. */
export const Loading: Story = {
  args: { disabled: true },
};
