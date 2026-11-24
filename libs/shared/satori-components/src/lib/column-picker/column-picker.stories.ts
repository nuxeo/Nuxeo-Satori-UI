import type { Meta, StoryObj } from '@storybook/angular';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { NxsColumnPickerComponent, type NxsPickableColumn } from './column-picker.component';

const column = (key: string, label: string, visible = true): NxsPickableColumn => ({
  key,
  label,
  visible,
});

const meta: Meta<NxsColumnPickerComponent> = {
  title: 'Tables/Column picker',
  component: NxsColumnPickerComponent,
  tags: ['autodocs'],
  args: {
    columns: [
      column('title', 'Title'),
      column('modified', 'Modified'),
      column('creator', 'Created by', false),
      column('size', 'Size', false),
    ],
    required: ['title'],
    defaults: ['title', 'modified'],
    apply: fn(),
    dismiss: fn(),
  },
  render: (args) => ({
    props: args,
    // The panel anchors to the right of this box. On a narrow screen the box is the canvas's
    // width less its 16px padding on each side, so the page does not scroll sideways.
    template: `<div style="position: relative; width: min(420px, calc(100vw - 32px)); height: 360px">
  <nxs-column-picker
    [columns]="columns"
    [required]="required"
    [defaults]="defaults"
    (apply)="apply($event)"
    (dismiss)="dismiss()"
  />
</div>`,
  }),
};

export default meta;

type Story = StoryObj<NxsColumnPickerComponent>;

/** The title column is required, so its checkbox is checked and disabled. */
export const SomeColumnsHidden: Story = {};

export const KeyboardContract: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const dialog = canvas.getByRole('dialog');
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog).toHaveFocus();
    await expect(canvas.getByRole('checkbox', { name: 'Title' })).toBeDisabled();
    await userEvent.tab();
    const modified = canvas.getByRole('checkbox', { name: 'Modified' });
    await expect(modified).toHaveFocus();
    await userEvent.keyboard(' ');
    await waitFor(() => expect(modified).not.toBeChecked());
    await userEvent.keyboard('{Escape}');
    await expect(args.dismiss).toHaveBeenCalledTimes(1);
    await expect(args.apply).not.toHaveBeenCalled();
    // This story keeps the panel mounted, exposing the discarded pending selection.
    await waitFor(() => expect(modified).toBeChecked());
    await userEvent.keyboard(' ');
    const done = canvas.getByRole('button', { name: 'Done' });
    done.focus();
    await userEvent.keyboard('{Enter}');
    await expect(args.apply).toHaveBeenCalledWith(['title']);
  },
};

export const AllColumnsShown: Story = {
  args: {
    columns: [
      column('title', 'Title'),
      column('modified', 'Modified'),
      column('creator', 'Created by'),
      column('size', 'Size'),
    ],
  },
};

/** More columns than fit: the list scrolls inside the panel, and the actions stay in view. */
export const ManyColumns: Story = {
  args: {
    columns: [
      column('title', 'Title'),
      column('type', 'Type'),
      column('state', 'State'),
      column('version', 'Version'),
      column('modified', 'Modified'),
      column('lastContributor', 'Last contributor'),
      column('created', 'Created'),
      column('creator', 'Created by', false),
      column('size', 'Size', false),
      column('path', 'Path', false),
      column('tags', 'Tags', false),
      column('collections', 'Collections', false),
    ],
  },
};
