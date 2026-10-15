import type { Provider } from '@angular/core';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { delay, of } from 'rxjs';
import { expect, userEvent, within } from 'storybook/test';

import { NuxeoApiBase, type NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';

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

/** The repository, from memory after 150 ms: a uid looked up, or titles containing the term. */
const repository: Provider = {
  provide: NuxeoApiBase,
  useValue: {
    nxqlSearch: (query: string) => {
      const uid = /ecm:uuid = '([^']*)'/.exec(query)?.[1];
      const term = /LIKE '(.*)\*'/.exec(query)?.[1]?.toLowerCase() ?? '';
      const entries = DOCUMENTS.filter((doc) =>
        uid === undefined ? doc.title.toLowerCase().includes(term) : doc.uid === uid,
      );
      return of({ entries }).pipe(delay(150));
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
    idProperty: 'uid',
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
    idProperty: {
      control: 'select',
      options: ['uid', 'path'],
      description: 'What the value holds: the uid, or the path.',
    },
    hint: { control: 'text', description: 'Help under the field, already translated.' },
    required: { control: 'boolean' },
    disabled: { control: 'boolean' },
    value: { control: false, description: 'The uid (or path) of the document chosen. Two-way.' },
    documentChange: { control: false, description: 'The document chosen, or null when cleared.' },
  },
  decorators: [applicationConfig({ providers: [repository] })],
  render: (args) => ({
    props: args,
    template: `<nxs-document-reference-input
  [label]="label"
  [documentTypes]="documentTypes"
  [idProperty]="idProperty"
  [hint]="hint"
  [required]="required"
  [disabled]="disabled"
  [(value)]="value"
/>
<output class="story-value">{{ value ?? '—' }}</output>`,
  }),
};

export default meta;

type Story = StoryObj<NxsDocumentReferenceInputComponent>;

/** Type `con`: each match is listed with its type icon and path. */
export const Default: Story = {};

/** Typing `supp` finds the supplier contract; choosing it sets the value to its uid. */
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

/** A uid the form holds: shown at once, then by its title once looked up. */
export const WithAValue: Story = { args: { value: 'c2' } };

/** A uid that names no readable document is kept and shown as it is. */
export const AnUnknownDocument: Story = { args: { value: 'a1b2c3d4-gone' } };

export const Disabled: Story = { args: { disabled: true, value: 'p1' } };
