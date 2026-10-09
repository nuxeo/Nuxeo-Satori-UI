import type { Meta, StoryObj } from '@storybook/angular';

import { NxsDomainHintComponent } from './domain-hint.component';

const componentDescription = `
The note shown where content cannot be created directly — inside a Domain, or at the repository
root. It tells the user to open Sections, Templates or Workspaces and create content there instead.

A host places it unconditionally and passes what it is showing; the hint decides whether to appear,
and renders nothing anywhere else. The rule — a document of type \`Domain\`, or the path \`/\` — is
the one the platform's Create and Import checks use to refuse those locations, and the note is the
same translated sentence those checks show, from the application's catalogue.

**Inputs**

- \`documentType\` — \`string | null | undefined\`, optional, default \`null\`. The type of the
  document being shown.
- \`path\` — \`string | null | undefined\`, optional, default \`null\`. The repository path being
  shown.

It emits nothing and calls nothing.
`;

const meta: Meta<NxsDomainHintComponent> = {
  title: 'States/Domain hint',
  component: NxsDomainHintComponent,
  tags: ['autodocs'],
  args: { documentType: 'Domain', path: '/default-domain' },
  argTypes: {
    documentType: { control: 'text' },
    path: { control: 'text' },
  },
  parameters: {
    layout: 'padded',
    docs: { description: { component: componentDescription } },
  },
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
