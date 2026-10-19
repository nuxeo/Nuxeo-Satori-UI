import type { Provider } from '@angular/core';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { delay, of } from 'rxjs';
import { expect, fireEvent, userEvent, waitFor, within } from 'storybook/test';

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
    multiple: false,
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
    multiple: {
      control: 'boolean',
      description: 'Choose several entries as removable chips; value is an ordered array.',
    },
    value: { control: false, description: 'The uid (or path) of the document chosen. Two-way.' },
    documentChange: { control: false, description: 'The document chosen, or null when cleared.' },
  },
  decorators: [applicationConfig({ providers: [repository] })],
  render: (args) => ({
    props: args,
    template: `<nxs-document-reference-input
  [label]="label"
  [multiple]="multiple"
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

/** Multiple references keep their ids in order; each choice is a removable chip. */
export const Multiple: Story = {
  args: { multiple: true, value: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const field = canvas.getByRole('combobox', { name: 'Related contract' });
    await userEvent.type(field, 'supp');
    await userEvent.click(
      await within(document.body).findByRole('option', { name: /Supplier contract 2026/ }),
    );
    await expect(field).toHaveValue('');
    await userEvent.type(field, 'renew');
    await userEvent.click(
      await within(document.body).findByRole('option', { name: /Contract renewal notes/ }),
    );
    await expect(canvasElement.querySelector('output')).toHaveTextContent('c1,c2');
    await userEvent.click(canvas.getByRole('button', { name: 'Remove Supplier contract 2026' }));
    await expect(canvasElement.querySelector('output')).toHaveTextContent('c2');
    await userEvent.click(field);
    // Material 20 reads keyCode; userEvent.keyboard supplies zero for synthetic events.
    fireEvent.keyDown(field, { key: 'Backspace', code: 'Backspace', keyCode: 8 });
    await waitFor(() => expect(document.activeElement).toHaveAttribute('role', 'gridcell'));
    fireEvent.keyDown(document.activeElement as HTMLElement, {
      key: 'Backspace',
      code: 'Backspace',
      keyCode: 8,
    });
    await waitFor(() => expect(canvasElement.querySelectorAll('mat-chip-row')).toHaveLength(0));
  },
};

export const MultipleStoredReferences: Story = {
  args: { multiple: true, value: ['c1', 'a1b2c3d4-gone'] },
};
export const MultiplePaths: Story = { args: { multiple: true, idProperty: 'path', value: [] } };
export const MultipleDisabled: Story = {
  args: { multiple: true, disabled: true, value: ['c1', 'c2'] },
};
