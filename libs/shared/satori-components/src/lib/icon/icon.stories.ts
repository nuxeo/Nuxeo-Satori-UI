import type { Meta, StoryObj } from '@storybook/angular';

import { NxsIconComponent } from './icon.component';

const meta: Meta<NxsIconComponent> = {
  title: 'Primitives/Icon',
  component: NxsIconComponent,
  tags: ['autodocs'],
  args: { name: 'folder', label: '' },
};

export default meta;

type Story = StoryObj<NxsIconComponent>;

/** Hidden from assistive technology, so only beside text that says the same thing. */
export const Decorative: Story = {};

/** Standing alone, the icon is an image named by its label. */
export const Named: Story = { args: { name: 'folder_shared', label: 'Shared folder' } };

/** `--nxs-icon-size` and `color` are inherited, so a host sets them on the icon or any ancestor. */
export const SizedAndColoured: Story = {
  parameters: { controls: { disable: true } },
  render: () => ({
    template: `<span style="--nxs-icon-size: 48px; color: var(--mat-sys-primary)">
  <nxs-icon name="collections_bookmark" />
</span>`,
  }),
};

/** Beside a visible label, the icon is decorative and the text is what is read. */
export const BesideText: Story = {
  parameters: { controls: { disable: true } },
  render: () => ({
    template: `<span style="display: inline-flex; align-items: center; gap: 8px">
  <nxs-icon name="description" />
  <span>Contract.pdf</span>
</span>`,
  }),
};
