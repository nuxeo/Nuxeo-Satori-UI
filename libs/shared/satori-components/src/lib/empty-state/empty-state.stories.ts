import { MatButtonModule } from '@angular/material/button';
import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';

import type { NxsHeadingLevel } from '../heading-level';
import { NxsEmptyStateComponent } from './empty-state.component';

/**
 * Compodoc records `NxsHeadingLevel` as `"1" | … | "6"`, so the control Storybook infers from it
 * sets a string: no `@case` matches it, and Update story writes it here as a type error.
 */
const HEADING_LEVELS: readonly NxsHeadingLevel[] = [1, 2, 3, 4, 5, 6];

const meta: Meta<NxsEmptyStateComponent> = {
  title: 'States/Empty state',
  component: NxsEmptyStateComponent,
  tags: ['autodocs'],
  args: {
    heading: 'This folder is empty',
    message: '',
    icon: '',
  },
  argTypes: { headingLevel: { control: 'select', options: HEADING_LEVELS } },
};

export default meta;

type Story = StoryObj<NxsEmptyStateComponent>;

export const HeadingOnly: Story = {};

export const WithMessageAndIcon: Story = {
  args: {
    heading: 'No results',
    message: 'Try a different search term, or clear the filters.',
    icon: 'search',
  },
};

/** Actions are projected, so the button and what it does stay the caller's. */
export const WithProjectedAction: Story = {
  parameters: { controls: { disable: true } },
  decorators: [moduleMetadata({ imports: [MatButtonModule] })],
  render: () => ({
    template: `<nxs-empty-state
  heading="This folder is empty"
  message="Upload a file or create a folder to get started."
  icon="folder_open"
>
  <button mat-flat-button type="button">Create folder</button>
</nxs-empty-state>`,
  }),
};

/** Inside a section whose heading is a level two, the empty state's heading is a level three. */
export const InsideASection: Story = {
  args: { heading: 'No comments yet', headingLevel: 3, icon: 'comment' },
};
