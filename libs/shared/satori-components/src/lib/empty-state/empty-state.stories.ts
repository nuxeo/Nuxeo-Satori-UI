import { MatButtonModule } from '@angular/material/button';
import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';

import { NxsEmptyStateComponent } from './empty-state.component';

const componentDescription = `
The "nothing here" message for a list, panel or result set: a heading, an optional second line, an
optional icon, and whatever actions the host places inside it.

Text arrives already translated — the library ships no translations of its own — so a host binds its
own keys, for example \`[heading]="'browse.empty' | translate"\`. Buttons such as "Create folder" or
"Clear filters" are projected as content, so they and what they do stay the host's. The component is a
status region, so assistive technology announces it when it appears.

**Inputs**

- \`heading\` — \`string\`, **required**. What is empty, in one line.
- \`headingLevel\` — \`1\` to \`6\`, optional, default \`2\`. The heading's level in the page outline,
  rendered as the native \`<h1>\`–\`<h6>\`. Set it one below the heading of the section it empties.
- \`message\` — \`string\`, optional, default \`''\`. A second line, usually what to do next. Not shown
  when blank.
- \`icon\` — \`string\`, optional, default \`''\`. A Material Icons ligature such as \`search_off\`.
  Decorative, so hidden from assistive technology.

It emits nothing and calls nothing; projected buttons raise their own events. In these stories the
text is plain strings standing in for what a host translates.
`;

const meta: Meta<NxsEmptyStateComponent> = {
  title: 'States/Empty state',
  component: NxsEmptyStateComponent,
  tags: ['autodocs'],
  args: {
    heading: 'This folder is empty',
    message: '',
    icon: '',
  },
  parameters: {
    docs: { description: { component: componentDescription } },
  },
};

export default meta;

type Story = StoryObj<NxsEmptyStateComponent>;

export const HeadingOnly: Story = {};

export const WithMessageAndIcon: Story = {
  args: {
    heading: 'No results',
    message: 'Try a different search term, or clear the filters.',
    icon: 'search_off',
  },
};

/** Actions are projected, so the button and what it does stay the caller's. */
export const WithProjectedAction: Story = {
  args: {
    heading: 'This folder is empty',
    message: 'Upload a file or create a folder to get started.',
    icon: 'folder_open',
  },
  decorators: [moduleMetadata({ imports: [MatButtonModule] })],
  render: (args) => ({
    props: args,
    template: `
      <nxs-empty-state [heading]="heading" [message]="message" [icon]="icon">
        <button mat-flat-button type="button">Create folder</button>
      </nxs-empty-state>
    `,
  }),
};
