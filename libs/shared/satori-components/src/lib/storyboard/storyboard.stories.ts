import type { Meta, StoryObj } from '@storybook/angular';
import { expect, fn, userEvent, within } from 'storybook/test';

import { NxsStoryboardComponent, type NxsStoryboardItem } from './storyboard.component';

/** A 1×1 transparent GIF, so the stories draw a real image without a Nuxeo server. */
const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const frames: readonly NxsStoryboardItem[] = [
  { timecode: 0, thumbnailUrl: PIXEL, label: 'Opening titles' },
  { timecode: 15, thumbnailUrl: PIXEL, label: '' },
  { timecode: 30, thumbnailUrl: PIXEL, label: '' },
  { timecode: 75, thumbnailUrl: PIXEL, label: 'The interview begins' },
  { timecode: 132, thumbnailUrl: PIXEL, label: '' },
];

/**
 * The strip of frames under a video that seeks it. The host passes the frames it already holds and
 * moves its own player when `seek` says where, which is what lets the document viewer and an asset
 * screen show one strip over two different players.
 */
const meta: Meta<NxsStoryboardComponent> = {
  title: 'Media/Storyboard',
  component: NxsStoryboardComponent,
  tags: ['autodocs'],
  args: {
    items: frames,
    label: '',
    activeTimecode: null,
    seek: fn(),
  },
  argTypes: {
    items: {
      control: 'object',
      description: 'The frames, in the order they are shown. Usually ordered by timecode.',
    },
    label: {
      control: 'text',
      description:
        'The list’s accessible name, already translated. Blank, or only whitespace or zero-width characters, names it “Video storyboard”.',
    },
    activeTimecode: {
      control: 'number',
      description: 'The frame to mark as the one playing, by timecode. `null` marks none.',
    },
    seek: { control: false, description: 'Where the host should move the video to, in seconds.' },
  },
};

export default meta;

type Story = StoryObj<NxsStoryboardComponent>;

/** A video Nuxeo built a storyboard for: five frames, each seeking the player when pressed. */
export const VideoStoryboard: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('list', { name: 'Video storyboard' })).toBeVisible();
    await expect(canvas.getAllByRole('listitem')).toHaveLength(5);
    await userEvent.click(
      canvas.getByRole('button', { name: 'Seek to The interview begins 1:15' }),
    );
    await expect(args.seek).toHaveBeenCalledWith(75);
  },
};

/** The frame the player is on is outlined and marked `aria-current`. */
export const Playing: Story = {
  args: { activeTimecode: 30 },
};

/**
 * A storyboard whose thumbnails have not arrived, or whose renditions Nuxeo has none of: each frame
 * keeps its place and its timecode, and shows a placeholder rather than a broken image.
 */
export const ThumbnailsMissing: Story = {
  args: { items: frames.map((frame) => ({ ...frame, thumbnailUrl: null })) },
};

/** Not a video, or the storyboard has not loaded: the strip renders nothing at all. */
export const NoFrames: Story = {
  args: { items: [] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('list')).toBeNull();
  },
};

/** Every frame is an ordinary button: Tab reaches it, Enter and Space press it. */
export const KeyboardContract: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const first = canvas.getByRole('button', { name: 'Seek to Opening titles 0:00' });
    first.focus();
    await userEvent.keyboard('{Enter}');
    await expect(args.seek).toHaveBeenLastCalledWith(0);
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Seek to 0:15' })).toHaveFocus();
    await userEvent.keyboard(' ');
    await expect(args.seek).toHaveBeenLastCalledWith(15);
  },
};
