import type { Meta, StoryObj } from '@storybook/angular';

import { NxsAvatarComponent } from './avatar.component';

const meta: Meta<NxsAvatarComponent> = {
  title: 'Primitives/Avatar',
  component: NxsAvatarComponent,
  args: { initials: 'NK', color: 'blue', size: '36', label: 'Narasimha Koppula' },
  argTypes: {
    color: {
      control: 'select',
      options: ['purple', 'blue', 'pink', 'teal', 'yellow', 'green', 'red', 'orange'],
    },
    size: { control: 'select', options: ['24', '28', '36', '64', '80', '128'] },
    label: { description: 'The accessible name. Blank makes the avatar decorative.' },
  },
};

export default meta;

type Story = StoryObj<NxsAvatarComponent>;

export const Default: Story = {};

export const Large: Story = { args: { size: '80', color: 'purple' } };

/** Every colour, each on a theme container role in this Material implementation. */
export const Colours: Story = {
  render: (args) => ({
    props: {
      ...args,
      colours: ['purple', 'blue', 'pink', 'teal', 'yellow', 'green', 'red', 'orange'],
    },
    template: `
      <div style="display: flex; gap: 8px">
        @for (colour of colours; track colour) {
          <nxs-avatar [initials]="initials" [color]="colour" [size]="size" [label]="colour" />
        }
      </div>
    `,
  }),
};
