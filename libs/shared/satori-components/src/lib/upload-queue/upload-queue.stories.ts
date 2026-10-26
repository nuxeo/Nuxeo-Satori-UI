import type { Meta, StoryObj } from '@storybook/angular';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { NxsUploadQueue, type NxsUploadItem } from './upload-queue';
import { NxsUploadQueueComponent } from './upload-queue.component';

const FILES = [
  new File(['x'.repeat(184_320)], 'Claim 42 — photos.zip'),
  new File(['x'.repeat(52_000)], 'Adjuster report.pdf'),
  new File(['x'.repeat(2_048)], 'Notes.txt'),
];

/** The queue at a moment of its run, built through `NxsUploadQueue` as a page would drive it. */
function at(moment: 'staged' | 'uploading' | 'failed' | 'done'): readonly NxsUploadItem[] {
  const queue = new NxsUploadQueue();
  queue.stage(FILES);
  if (moment === 'staged') return queue.items();
  queue.start();
  queue.progress({ percent: 33.4, fileIndex: 0, fileCount: 3 });
  queue.progress({ percent: 50, fileIndex: 1, fileCount: 3 });
  if (moment === 'uploading') return queue.items();
  if (moment === 'failed') {
    queue.fail({ status: 403 });
    return queue.items();
  }
  queue.complete([]);
  return queue.items();
}

/** Fifteen files, the first uploading and the rest waiting: none of them has a button yet. */
function longRun(): readonly NxsUploadItem[] {
  const queue = new NxsUploadQueue();
  queue.stage(
    Array.from({ length: 15 }, (_, i) => new File(['x'.repeat(4_096)], `Scan ${i + 1}.pdf`)),
  );
  queue.start();
  queue.progress({ percent: 40, fileIndex: 0, fileCount: 15 });
  return queue.items();
}

/**
 * The files of an upload, each with its own state. The page runs the upload and drives an
 * `NxsUploadQueue`; this draws it and reports Remove and Retry.
 */
const meta: Meta<NxsUploadQueueComponent> = {
  title: 'Upload/Upload queue',
  component: NxsUploadQueueComponent,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { items: at('staged'), label: 'Files to upload', remove: fn(), retry: fn() },
  argTypes: {
    items: {
      control: false,
      description: 'The files, in order, as an `NxsUploadQueue` holds them. Required.',
    },
    label: {
      control: 'text',
      description: 'The list’s accessible name, already translated. Required.',
    },
    remove: { control: false, description: 'The id of a file to take out.' },
    retry: { control: false, description: 'The id of a refused file to try again.' },
  },
  render: (args) => ({
    props: args,
    template: `<div style="width: 420px"><nxs-upload-queue [items]="items" [label]="label" (remove)="remove($event)" (retry)="retry($event)" /></div>`,
  }),
};

export default meta;

type Story = StoryObj<NxsUploadQueueComponent>;

/** Chosen, not uploading yet: each with its size and a Remove. */
export const Chosen: Story = {};

/**
 * Uploading: the first done, the second on its way with its own progress, the third waiting. The
 * list does not scroll, so it takes no tab stop.
 */
export const Uploading: Story = {
  args: { items: at('uploading') },
  play: async ({ canvasElement }) => {
    const list = within(canvasElement).getByRole('list', { name: 'Files to upload' });
    await expect(list.scrollHeight).toBeLessThanOrEqual(list.clientHeight);
    // The list measures itself after it renders; give it the frame it would take to say otherwise.
    await new Promise((settled) => requestAnimationFrame(() => requestAnimationFrame(settled)));
    await expect(list).not.toHaveAttribute('tabindex');
  },
};

/** The server refused the second: it says why, with Retry; the third waits for another run. */
export const Refused: Story = {
  args: { items: at('failed') },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Retry Adjuster report.pdf' }));
    await expect(args.retry).toHaveBeenCalled();
  },
};

/** All uploaded. */
export const Uploaded: Story = { args: { items: at('done') } };

/** A long run under way: the list scrolls and holds no button, so the list itself takes focus. */
export const LongRun: Story = {
  args: { items: longRun() },
  play: async ({ canvasElement }) => {
    const list = within(canvasElement).getByRole('list', { name: 'Files to upload' });
    await expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
    await expect(within(list).queryAllByRole('button')).toHaveLength(0);
    await waitFor(() => expect(list).toHaveAttribute('tabindex', '0'));
  },
};
