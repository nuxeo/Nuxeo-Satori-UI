import type { Meta, StoryObj } from '@storybook/angular';

import { NxsColumnPickerComponent, type NxsPickableColumn } from './column-picker.component';

const column = (key: string, label: string, visible = true): NxsPickableColumn => ({
  key,
  label,
  visible,
});

/**
 * Column labels arrive already translated, so plain strings stand in for them here; the panel's
 * own chrome comes from the application's catalogue (`preview.ts`). The panel hangs from the
 * top-right corner of its nearest positioned ancestor, so each story renders it inside one.
 */
const meta: Meta<NxsColumnPickerComponent> = {
  title: 'Tables/Column picker',
  component: NxsColumnPickerComponent,
  args: {
    columns: [
      column('title', 'Title'),
      column('modified', 'Modified'),
      column('creator', 'Created by', false),
      column('size', 'Size', false),
    ],
    required: ['title'],
    defaults: ['title', 'modified'],
  },
  argTypes: {
    columns: { description: 'Every column the user may choose from, in display order. Required.' },
    required: { description: 'Keys that cannot be switched off.' },
    defaults: { description: 'The keys Reset returns to.' },
  },
  render: (args) => ({
    props: args,
    template: `
      <div style="position: relative; width: 420px; height: 360px">
        <nxs-column-picker [columns]="columns" [required]="required" [defaults]="defaults" />
      </div>
    `,
  }),
};

export default meta;

type Story = StoryObj<NxsColumnPickerComponent>;

/** The title column is required, so its checkbox is checked and disabled. */
export const SomeColumnsHidden: Story = {};

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
