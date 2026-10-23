import type { Meta, StoryObj } from '@storybook/angular';

import { NxsSpinnerComponent } from './spinner.component';

const meta: Meta<NxsSpinnerComponent> = {
  title: 'States/Spinner',
  component: NxsSpinnerComponent,
  tags: ['autodocs'],
  args: { label: 'Loading documents', diameter: 32 },
  argTypes: {
    diameter: { control: { type: 'number', min: 16, max: 96 } },
  },
};

export default meta;

type Story = StoryObj<NxsSpinnerComponent>;

/** A progress bar named by its label. */
export const Named: Story = {};

/** Decorative: hidden from assistive technology, so only beside text that says what is loading. */
export const BesideVisibleText: Story = {
  parameters: { controls: { disable: true } },
  render: () => ({
    template: `<p style="display: flex; align-items: center; gap: 12px; margin: 0">
  <nxs-spinner diameter="24" />
  <span>Checking Nuxeo Drive…</span>
</p>`,
  }),
};

export const Large: Story = { args: { diameter: 64 } };
