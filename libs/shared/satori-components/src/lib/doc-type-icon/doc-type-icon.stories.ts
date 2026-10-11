import type { Meta, StoryObj } from '@storybook/angular';

import { NxsDocTypeIconComponent } from './doc-type-icon.component';

const TYPES = ['File', 'Note', 'Picture', 'Video', 'Folder', 'Workspace', 'Domain', 'Collection'];

const meta: Meta<NxsDocTypeIconComponent> = {
  title: 'Primitives/Document type icon',
  component: NxsDocTypeIconComponent,
  tags: ['autodocs'],
  args: { type: 'Folder', label: '' },
};

export default meta;

type Story = StoryObj<NxsDocTypeIconComponent>;

export const Folder: Story = {};

/** Standing alone, it is named by its label. */
export const Named: Story = { args: { type: 'Picture', label: 'Picture' } };

/** A type the table does not know gets the generic file icon rather than nothing. */
export const UnknownType: Story = { args: { type: 'InvoiceDocument' } };

/** Beside each type's name, as a listing shows it; the name is the text, so the icon is decorative. */
export const AcrossTypes: Story = {
  parameters: { controls: { disable: true } },
  render: () => ({
    template: `<ul style="display: grid; gap: 8px; margin: 0; padding: 0; list-style: none">
${TYPES.map(
  (type) => `  <li style="display: flex; align-items: center; gap: 8px">
    <nxs-doc-type-icon type="${type}" />
    <span>${type}</span>
  </li>`,
).join('\n')}
</ul>`,
  }),
};
