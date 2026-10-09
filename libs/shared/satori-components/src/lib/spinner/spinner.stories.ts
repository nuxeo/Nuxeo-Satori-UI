import type { Meta, StoryObj } from '@storybook/angular';

import { NxsSpinnerComponent } from './spinner.component';

const componentDescription = `
A loading indicator for a region waiting on data — a list, a tab, a panel or a dialog body. It spins
until the host removes it and shows no progress value.

It is either named or decorative, never neither. Given a \`label\`, it is announced to assistive
technology as a progress bar with that name. Without one it is hidden from assistive technology, so
use it bare only beside visible text that already says what is loading. Do not put it inside a
button, where it changes the button's width; rotate the button's icon instead.

**Inputs**

- \`label\` — \`string\`, optional, default \`''\`. What is loading, already translated. Blank makes
  the spinner decorative.
- \`diameter\` — \`number\`, optional, default \`32\`. Its size in pixels. A static attribute such as
  \`diameter="36"\` works too.

Everything it shows comes from those two inputs: it emits nothing and calls nothing. In these stories
the label is plain text standing in for what a host translates.
`;

const meta: Meta<NxsSpinnerComponent> = {
  title: 'States/Spinner',
  component: NxsSpinnerComponent,
  tags: ['autodocs'],
  args: { label: 'Loading documents', diameter: 32 },
  argTypes: {
    diameter: { control: { type: 'number', min: 16, max: 96 } },
  },
  parameters: {
    docs: { description: { component: componentDescription } },
  },
};

export default meta;

type Story = StoryObj<NxsSpinnerComponent>;

/** A progress bar named by its label. */
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
