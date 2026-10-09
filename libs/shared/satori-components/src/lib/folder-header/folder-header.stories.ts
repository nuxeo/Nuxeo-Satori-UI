import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';

import { NxsFolderHeaderComponent } from './folder-header.component';

const componentDescription = `
The header above a folder's or other container's contents: its type icon, its title as the page
heading, an optional second line, and the container's actions on the right.

The actions are projected as they are, so the host keeps its own buttons, menus and handlers.
Anything marked with the \`nxsFolderHeaderDetail\` attribute — a breadcrumb trail, say — is projected
under the title instead. On a narrow screen the actions drop below the title. While the container is
loading, leave \`heading\` blank: the header then renders no heading rather than an empty one.

**Inputs**

- \`heading\` — \`string\`, optional, default \`''\`. The container's title. Blank renders no heading.
- \`headingLevel\` — \`1\` to \`6\`, optional, default \`1\`. The title's level in the page outline,
  rendered as the native \`<h1>\`–\`<h6>\`. The header is usually the page's own heading; lower it
  where it sits inside a section that already has one.
- \`subheading\` — \`string\`, optional, default \`''\`. A second line under the title, usually the
  type's name, already translated.
- \`documentType\` — \`string\`, optional, default \`''\`. The container's Nuxeo type, which picks
  the icon. Blank renders no icon.

It emits nothing and calls nothing; projected buttons raise their own events. In these stories the
text is plain strings standing in for what a host translates, and the buttons do nothing.
`;

const meta: Meta<NxsFolderHeaderComponent> = {
  title: 'Panels/Folder header',
  component: NxsFolderHeaderComponent,
  tags: ['autodocs'],
  args: {
    heading: 'Claims 2026',
    headingLevel: 1,
    subheading: 'Folder',
    documentType: 'Folder',
  },
  decorators: [moduleMetadata({ imports: [MatButtonModule, MatIconModule] })],
  parameters: {
    layout: 'padded',
    docs: { description: { component: componentDescription } },
  },
  render: (args) => ({
    props: args,
    template: `
      <nxs-folder-header
        [heading]="heading"
        [headingLevel]="headingLevel"
        [subheading]="subheading"
        [documentType]="documentType"
      >
        <button mat-stroked-button type="button">Share</button>
        <button mat-icon-button type="button" aria-label="More actions">
          <mat-icon>more_vert</mat-icon>
        </button>
      </nxs-folder-header>
    `,
  }),
};

export default meta;

type Story = StoryObj<NxsFolderHeaderComponent>;

export const WithActions: Story = {};

/** Anything marked `nxsFolderHeaderDetail` is projected under the title, such as a trail. */
export const WithDetail: Story = {
  args: { heading: 'Contracts', subheading: '', documentType: 'Workspace' },
  render: (args) => ({
    props: args,
    template: `
      <nxs-folder-header
        [heading]="heading"
        [headingLevel]="headingLevel"
        [subheading]="subheading"
        [documentType]="documentType"
      >
        <span nxsFolderHeaderDetail>Domain / Workspaces / Contracts</span>
        <button mat-stroked-button type="button">Share</button>
      </nxs-folder-header>
    `,
  }),
};

/** While the container loads, the heading is left blank rather than announced empty. */
export const Loading: Story = { args: { heading: '', subheading: '', documentType: '' } };
