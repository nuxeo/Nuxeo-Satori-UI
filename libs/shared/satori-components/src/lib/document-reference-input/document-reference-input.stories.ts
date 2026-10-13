import type { Provider } from '@angular/core';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { delay, of } from 'rxjs';
import { expect, userEvent, within } from 'storybook/test';

import { NuxeoApiBase, type NuxeoDocument } from '@nuxeo-satori/platform/nuxeo-client';

import { NxsDocumentReferenceInputComponent } from './document-reference-input.component';

const DOCUMENTS = [
  {
    uid: 'c1',
    title: 'Supplier contract 2026',
    type: 'File',
    path: '/default-domain/workspaces/Legal/Supplier contract 2026',
  },
  {
    uid: 'c2',
    title: 'Contract renewal notes',
    type: 'Note',
    path: '/default-domain/workspaces/Legal/Contract renewal notes',
  },
  {
    uid: 'p1',
    title: 'Contracts',
    type: 'Folder',
    path: '/default-domain/workspaces/Legal/Contracts',
  },
] as NuxeoDocument[];

/** The repository, searched from memory after 150 ms: titles containing the typed term. */
const repository: Provider = {
  provide: NuxeoApiBase,
  useValue: {
    nxqlSearch: (query: string) => {
      const term = /LIKE '(.*)\*'/.exec(query)?.[1]?.toLowerCase() ?? '';
      return of({
        entries: DOCUMENTS.filter((doc) => doc.title.toLowerCase().includes(term)),
      }).pipe(delay(150));
    },
  },
};

/**
 * Finds a document as the user types and returns a reference to the one chosen, as Web UI's
 * `nuxeo-document-suggestion` does: a full-text search from three characters. These stories search
 * three documents held in memory by title.
 */
const meta: Meta<NxsDocumentReferenceInputComponent> = {
  title: 'Pickers/Document reference input',
  component: NxsDocumentReferenceInputComponent,
  tags: ['autodocs'],
  args: {
    label: 'Related contract',
    documentTypes: [],
    hint: '',
    required: false,
    disabled: false,
    value: null,
  },
  argTypes: {
    label: { control: 'text', description: 'The field’s label, already translated. Required.' },
    documentTypes: {
      control: 'object',
      description: 'Offer only documents of these types. Every type when empty.',
    },
    hint: { control: 'text', description: 'Help under the field, already translated.' },
    required: { control: 'boolean' },
    disabled: { control: 'boolean' },
    value: { control: false, description: 'The document chosen, or null. Two-way.' },
  },
  decorators: [applicationConfig({ providers: [repository] })],
  render: (args) => ({
    props: args,
    template: `<nxs-document-reference-input
  [label]="label"
  [documentTypes]="documentTypes"
  [hint]="hint"
  [required]="required"
  [disabled]="disabled"
  [(value)]="value"
/>
<output class="story-value">{{ value?.uid ?? '—' }}</output>`,
  }),
};

export default meta;

type Story = StoryObj<NxsDocumentReferenceInputComponent>;

/** Type `con`: each match is listed with its type icon and path. */
export const Default: Story = {};

/** Typing `supp` finds the supplier contract; choosing it sets the value to a reference. */
export const ChoosingADocument: Story = {
  play: async ({ canvasElement }) => {
    const field = within(canvasElement).getByRole('combobox', { name: 'Related contract' });
    await userEvent.type(field, 'supp');
    await userEvent.click(
      await within(document.body).findByRole('option', { name: /Supplier contract 2026/ }),
    );
    await expect(field).toHaveValue('Supplier contract 2026');
    await expect(canvasElement.querySelector('output')).toHaveTextContent('c1');
  },
};

export const WithAValue: Story = {
  args: {
    value: {
      uid: 'c2',
      title: 'Contract renewal notes',
      type: 'Note',
      path: '/default-domain/workspaces/Legal/Contract renewal notes',
    },
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
    value: {
      uid: 'p1',
      title: 'Contracts',
      type: 'Folder',
      path: '/default-domain/workspaces/Legal/Contracts',
    },
  },
};
