import type { Meta, StoryObj } from '@storybook/angular';

import { NxsDocTypeIconComponent } from './doc-type-icon.component';

const componentDescription = `
The icon for a Nuxeo document type — \`Folder\`, \`File\`, \`Picture\`, \`Collection\` and so on.

The type-to-icon table is \`docTypeIcon()\` from \`@nuxeo-satori/platform/nuxeo-client\`, so every
place that shows a type shows the same icon, and a type the table does not know gets the generic file
icon rather than nothing. It renders an \`nxs-icon\`, so \`--nxs-icon-size\` and \`color\` set on it
or on an ancestor apply. It is decorative unless given a \`label\`, because it almost always sits
beside the type's name or the document's title.

**Inputs**

- \`type\` — \`string\`, **required**. The document's type, as Nuxeo names it.
- \`label\` — \`string\`, optional, default \`''\`. What the icon means, already translated. Blank
  makes it decorative.

It emits nothing and sends no request: the table is part of the library, not a server lookup. In these
stories the label is plain text standing in for what a host translates.
`;

const meta: Meta<NxsDocTypeIconComponent> = {
  title: 'Primitives/Document type icon',
  component: NxsDocTypeIconComponent,
  tags: ['autodocs'],
  args: { type: 'Folder', label: '' },
  parameters: {
    docs: { description: { component: componentDescription } },
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
