import type { Meta, StoryObj } from '@storybook/angular';

import { NxsIconComponent } from './icon.component';

const componentDescription = `
One icon, named by its Material Icons ligature — \`folder\`, \`description\`, \`collections_bookmark\`.

It is decorative unless given a \`label\`. An icon beside text that already says the same thing is
hidden from assistive technology; an icon that stands alone is announced as an image with that name.
Its size comes from the \`--nxs-icon-size\` custom property (24px by default) and its colour from
\`color\`. Both are inherited, so a host sets them on the icon or on any ancestor.

**Inputs**

- \`name\` — \`string\`, **required**. The Material Icons ligature.
- \`label\` — \`string\`, optional, default \`''\`. What the icon means, already translated. Blank
  makes it decorative.

It emits nothing and calls nothing. The glyphs come from Google's Material Icons font, which the page
loads. In these stories the label is plain text standing in for what a host translates.
`;

const meta: Meta<NxsIconComponent> = {
  title: 'Primitives/Icon',
  component: NxsIconComponent,
  tags: ['autodocs'],
  args: { name: 'folder', label: '' },
  parameters: {
    docs: { description: { component: componentDescription } },
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
