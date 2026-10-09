import type { Meta, StoryObj } from '@storybook/angular';
import { fn } from 'storybook/test';

import { NxsColumnPickerComponent, type NxsPickableColumn } from './column-picker.component';

const column = (key: string, label: string, visible = true): NxsPickableColumn => ({
  key,
  label,
  visible,
});

const componentDescription = `
The panel a user opens from a table header to choose which columns are shown.

It is presentational: the host hands it the columns, closes it when it answers, and decides where the
choice is kept. Ticking and unticking is held back until **Done**, so **Escape** or a click on the
backdrop discards it, and **Reset** returns to the host's defaults. While open it is a modal dialog:
it takes focus, keeps **Tab** and **Shift+Tab** inside itself, and returns focus to whatever opened
it when it closes. It hangs from the top-right corner of its nearest positioned ancestor, so a host
renders it inside the table's wrapper.

Its title and buttons are translated from the application's catalogue; column names arrive already
translated.

**Inputs**

- \`columns\` — \`readonly NxsPickableColumn[]\`, **required**. Every column the user may choose
  from, in display order, each as \`{ key, label, visible }\`.
- \`required\` — \`readonly string[]\`, optional, default \`[]\`. Keys that cannot be switched off —
  usually the title column, so no row is left unlabelled. Their boxes show checked and disabled.
- \`defaults\` — \`readonly string[]\`, optional, default \`[]\`. The keys **Reset** returns to.

**Outputs**

- \`apply\` — \`readonly string[]\`, on **Done**: the chosen keys in the columns' order, required
  keys included.
- \`dismiss\` — \`void\`, on **Escape** or the backdrop: close without applying.

It calls no service. In these stories the column names are plain text, and both outputs are logged in
the **Actions** panel.
`;

const meta: Meta<NxsColumnPickerComponent> = {
  title: 'Tables/Column picker',
  component: NxsColumnPickerComponent,
  tags: ['autodocs'],
  args: {
    columns: [
      column('title', 'Title'),
      column('modified', 'Modified'),
      column('creator', 'Created by', false),
      column('size', 'Size', false),
    ],
    required: ['title'],
    defaults: ['title', 'modified'],
    apply: fn(),
    dismiss: fn(),
  },
  parameters: {
    docs: { description: { component: componentDescription } },
  },
  render: (args) => ({
    props: args,
    template: `
      <div style="position: relative; width: 420px; height: 360px">
        <nxs-column-picker
          [columns]="columns"
          [required]="required"
          [defaults]="defaults"
          (apply)="apply($event)"
          (dismiss)="dismiss()"
        />
      </div>
    `,
  }),
};

export default meta;

type Story = StoryObj<NxsColumnPickerComponent>;

/** The title column is required, so its checkbox is checked and disabled. */
export const SomeColumnsHidden: Story = {};

export const AllColumnsShown: Story = {
  args: {
    columns: [
      column('title', 'Title'),
      column('modified', 'Modified'),
      column('creator', 'Created by'),
      column('size', 'Size'),
    ],
  },
};

/** More columns than fit: the list scrolls inside the panel, and the actions stay in view. */
export const ManyColumns: Story = {
  args: {
    columns: [
      column('title', 'Title'),
      column('type', 'Type'),
      column('state', 'State'),
      column('version', 'Version'),
      column('modified', 'Modified'),
      column('lastContributor', 'Last contributor'),
      column('created', 'Created'),
      column('creator', 'Created by', false),
      column('size', 'Size', false),
      column('path', 'Path', false),
      column('tags', 'Tags', false),
      column('collections', 'Collections', false),
    ],
  },
};
