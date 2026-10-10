import type { Meta, StoryObj } from '@storybook/angular';

import { NxsDocTypeIconComponent } from './doc-type-icon.component';

/**
 * The type-to-icon table is `docTypeIcon()` in `nuxeo-client`. The `label` below stands in for what
 * a caller binds through its own translate pipe.
 */
const meta: Meta<NxsDocTypeIconComponent> = {
  title: 'Primitives/Document type icon',
  component: NxsDocTypeIconComponent,
  args: { type: 'Folder', label: '' },
  argTypes: {
    type: { control: 'text', description: "The document's type, as Nuxeo names it. Required." },
    label: {
      control: 'text',
      description: 'What the icon means, already translated. Blank makes it decorative.',
    },
  },
};

export default meta;

type Story = StoryObj<NxsDocTypeIconComponent>;

export const Folder: Story = {};

/** A type the table does not know gets the generic file icon rather than nothing. */
export const UnknownType: Story = { args: { type: 'InvoiceDocument' } };

/** Beside each type's name, as a listing shows it; the name is the text, so the icon is decorative. */
export const AcrossTypes: Story = {
  render: (args) => ({
    props: {
      ...args,
      types: ['File', 'Note', 'Picture', 'Video', 'Folder', 'Workspace', 'Domain', 'Collection'],
    },
    template: `
      <ul style="display: grid; gap: 8px; margin: 0; padding: 0; list-style: none">
        @for (type of types; track type) {
          <li style="display: flex; align-items: center; gap: 8px">
            <nxs-doc-type-icon [type]="type" />
            <span>{{ type }}</span>
          </li>
        }
      </ul>
    `,
  }),
};
