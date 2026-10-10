import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';

import { NxsFolderHeaderComponent } from './folder-header.component';

/**
 * The strings below stand in for what a caller binds through its own translate pipe. Actions are
 * projected, so the buttons and what they do stay the caller's.
 */
const meta: Meta<NxsFolderHeaderComponent> = {
  title: 'Panels/Folder header',
  component: NxsFolderHeaderComponent,
  args: {
    heading: 'Claims 2026',
    headingLevel: 1,
    subheading: 'Folder',
    documentType: 'Folder',
  },
  argTypes: {
    heading: { control: 'text', description: "The container's title. Blank renders no heading." },
    headingLevel: {
      control: { type: 'select' },
      options: [1, 2, 3, 4, 5, 6],
      description: "The title's level in the page outline.",
    },
    subheading: { control: 'text', description: 'A second line under the title.' },
    documentType: {
      control: 'text',
      description: "The container's Nuxeo type, which picks the icon. Blank renders no icon.",
    },
  },
  decorators: [moduleMetadata({ imports: [MatButtonModule, MatIconModule] })],
  parameters: { layout: 'padded' },
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
