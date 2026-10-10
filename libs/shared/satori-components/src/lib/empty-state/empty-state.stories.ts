import { MatButtonModule } from '@angular/material/button';
import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';

import { NxsEmptyStateComponent } from './empty-state.component';

/**
 * The strings below stand in for what a caller binds through its own translate pipe: the
 * library ships no catalogue, so every text input arrives already translated.
 */
const meta: Meta<NxsEmptyStateComponent> = {
  title: 'States/Empty state',
  component: NxsEmptyStateComponent,
  args: {
    heading: 'This folder is empty',
    message: '',
    icon: '',
  },
  argTypes: {
    heading: { control: 'text', description: 'What is empty, in one line. Required.' },
    message: { control: 'text', description: 'What to do next. Not rendered when blank.' },
    icon: {
      control: 'text',
      description: 'A Material icon ligature, hidden from assistive technology.',
    },
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
