import type { Meta, StoryObj } from '@storybook/angular';
import { expect, fn, userEvent, within } from 'storybook/test';

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

/** Uploading: the first done, the second on its way with its own progress, the third waiting. */
export const Uploading: Story = { args: { items: at('uploading') } };

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
