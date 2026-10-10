import type { Meta, StoryObj } from '@storybook/angular';

import { NxsSpinnerComponent } from './spinner.component';

/** The `label` below stands in for what a caller binds through its own translate pipe. */
const meta: Meta<NxsSpinnerComponent> = {
  title: 'States/Spinner',
  component: NxsSpinnerComponent,
  args: { label: 'Loading documents', diameter: 32 },
  argTypes: {
    label: {
      control: 'text',
      description: 'What is loading, already translated. Blank makes the spinner decorative.',
    },
    diameter: { control: { type: 'number', min: 16, max: 96 }, description: 'In pixels.' },
  },
};

export default meta;

type Story = StoryObj<NxsSpinnerComponent>;

/** A progressbar named by its label. */
export const Named: Story = {};

/** Decorative: hidden from assistive technology, so only beside text that says what is loading. */
export const BesideVisibleText: Story = {
  args: { label: '' },
  render: (args) => ({
    props: args,
    template: `
      <p style="display: flex; align-items: center; gap: 12px; margin: 0">
        <nxs-spinner [label]="label" [diameter]="24" />
        <span>Checking Nuxeo Drive…</span>
      </p>
    `,
  }),
};

export const Large: Story = { args: { diameter: 64 } };
