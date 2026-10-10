import type { Meta, StoryObj } from '@storybook/angular';

import { NxsDomainHintComponent } from './domain-hint.component';

/**
 * The note's text comes from the application's catalogue (`preview.ts`). A host places the hint
 * unconditionally and passes what it is showing; the hint decides whether to render.
 */
const meta: Meta<NxsDomainHintComponent> = {
  title: 'States/Domain hint',
  component: NxsDomainHintComponent,
  args: { documentType: 'Domain', path: '/default-domain' },
  argTypes: {
    documentType: { control: 'text', description: 'The type of the document being shown.' },
    path: { control: 'text', description: 'The repository path being shown.' },
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
