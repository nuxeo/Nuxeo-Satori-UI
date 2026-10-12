import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';

import type { NxsHeadingLevel } from '../heading-level';
import { NxsFolderHeaderComponent } from './folder-header.component';

/**
 * Compodoc records `NxsHeadingLevel` as `"1" | … | "6"`, so the control Storybook infers from it
 * sets a string: no `@case` matches it, and Update story writes it here as a type error.
 */
const HEADING_LEVELS: readonly NxsHeadingLevel[] = [1, 2, 3, 4, 5, 6];

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
  argTypes: { headingLevel: { control: 'select', options: HEADING_LEVELS } },
  decorators: [moduleMetadata({ imports: [MatButtonModule, MatIconModule] })],
  parameters: { layout: 'padded' },
  render: (args) => ({
    props: args,
    template: `<nxs-folder-header
  [heading]="heading"
  [headingLevel]="headingLevel"
  [subheading]="subheading"
  [documentType]="documentType"
>
  <button mat-stroked-button type="button">Share</button>
  <button mat-icon-button type="button" aria-label="More actions">
    <mat-icon>more_vert</mat-icon>
  </button>
</nxs-folder-header>`,
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
    template: `<nxs-folder-header
  [heading]="heading"
  [headingLevel]="headingLevel"
  [subheading]="subheading"
  [documentType]="documentType"
>
  <span nxsFolderHeaderDetail>Domain / Workspaces / Contracts</span>
  <button mat-stroked-button type="button">Share</button>
</nxs-folder-header>`,
  }),
};

/** While the container loads, the heading is left blank rather than announced empty. */
export const Loading: Story = { args: { heading: '', subheading: '', documentType: '' } };
