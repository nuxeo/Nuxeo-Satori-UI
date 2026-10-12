import type { Meta, StoryObj } from '@storybook/angular';

import { NxsDomainHintComponent } from './domain-hint.component';

const meta: Meta<NxsDomainHintComponent> = {
  title: 'States/Domain hint',
  component: NxsDomainHintComponent,
  tags: ['autodocs'],
  args: { documentType: 'Domain', path: '/default-domain' },
  argTypes: {
    documentType: { control: 'text' },
    path: { control: 'text' },
  },
  parameters: { layout: 'padded' },
};

export default meta;

type Story = StoryObj<NxsDomainHintComponent>;

/** Inside a Domain, where content cannot be created directly. */
export const InsideADomain: Story = {};

export const AtTheRepositoryRoot: Story = { args: { documentType: 'Root', path: '/' } };

/** Anywhere else the hint renders nothing. */
export const InsideAWorkspace: Story = {
  args: { documentType: 'Workspace', path: '/default-domain/workspaces/claims' },
};
