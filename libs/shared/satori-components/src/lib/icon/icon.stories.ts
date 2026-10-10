import type { Meta, StoryObj } from '@storybook/angular';

import { NxsIconComponent } from './icon.component';

/** The `label` below stands in for what a caller binds through its own translate pipe. */
const meta: Meta<NxsIconComponent> = {
  title: 'Primitives/Icon',
  component: NxsIconComponent,
  args: { name: 'folder', label: '' },
  argTypes: {
    name: { control: 'text', description: 'A Material Icons ligature. Required.' },
    label: {
      control: 'text',
      description: 'What the icon means, already translated. Blank makes it decorative.',
    },
  },
};

export default meta;

type Story = StoryObj<NxsIconComponent>;

/** Hidden from assistive technology, so only beside text that says the same thing. */
export const Decorative: Story = {};

/** Standing alone, the icon is an image named by its label. */
export const Named: Story = { args: { name: 'folder_shared', label: 'Shared folder' } };

/** `--nxs-icon-size` and `color` are inherited, so a host sets them on the icon or any ancestor. */
export const SizedAndColoured: Story = {
  args: { name: 'collections_bookmark' },
  render: (args) => ({
    props: args,
    template: `
      <span style="--nxs-icon-size: 48px; color: var(--mat-sys-primary)">
        <nxs-icon [name]="name" [label]="label" />
      </span>
    `,
  }),
};
