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

/** Material reads these keys by `keyCode`, which `userEvent.keyboard` leaves at zero. */
const KEY_CODES = {
  ArrowDown: 40,
  ArrowLeft: 37,
  ArrowRight: 39,
  ArrowUp: 38,
  Backspace: 8,
  Delete: 46,
  Enter: 13,
} as const;

function press(key: keyof typeof KEY_CODES, target = document.activeElement as HTMLElement): void {
  fireEvent.keyDown(target, { key, code: key, keyCode: KEY_CODES[key] });
}

/**
 * What has focus: `input`, or a chip's document id and which of its two parts — `cell`, its gridcell,
 * or `remove`, its remove button. Anything else in the chip is `other`, so it cannot pass as either.
 */
function focusOf(field: HTMLElement): string {
  const active = document.activeElement as HTMLElement | null;
  if (active === field) return 'input';
  const chip = active?.closest('mat-chip-row')?.getAttribute('data-document');
  if (!active || !chip) return 'elsewhere';
  if (active.closest('.mat-mdc-chip-remove')) return `${chip} remove`;
  return `${chip} ${active.getAttribute('role') === 'gridcell' ? 'cell' : 'other'}`;
}

/**
 * Everything without the mouse, starting with focus in the input. ↓ and Enter choose; Backspace in
 * the empty input reaches the last chip, and does not reach the chips while text is typed; ← and →
 * step through each chip and its remove button, ↑ and ↓ between chips; Backspace or Delete removes
 * the focused chip, Enter on its remove button too; focus then moves to the chip that takes its
 * place, and to the input once none is left. The field is required: emptying it from the keyboard
 * shows no error while focus is still in it, and the error once focus leaves.
 */
export const MultipleFromTheKeyboard: Story = {
  args: { multiple: true, required: true, value: [] },
  play: async ({ canvasElement }) => {
    const field = within(canvasElement).getByRole('combobox', { name: 'Related contract' });
    const value = () => canvasElement.querySelector('output')?.textContent?.trim();
    const focus = (expected: string) => waitFor(() => expect(focusOf(field)).toBe(expected));
    field.focus();
    for (const [term, name] of [
      ['supp', /Supplier contract 2026/],
      ['renew', /Contract renewal notes/],
      ['contracts', /^Contracts/],
    ] as const) {
      await userEvent.type(field, term, { skipClick: true });
      await within(document.body).findByRole('option', { name });
      press('ArrowDown', field);
      press('Enter', field);
      await waitFor(() => expect(field).toHaveValue(''));
    }
    await waitFor(() => expect(value()).toBe('c1,c2,p1'));
    await focus('input');

    await userEvent.type(field, 'x', { skipClick: true });
    press('Backspace', field);
    await focus('input');
    await expect(canvasElement.querySelectorAll('mat-chip-row')).toHaveLength(3);
    await userEvent.clear(field);

    press('Backspace', field);
    await focus('p1 cell');
    press('ArrowLeft');
    await focus('c2 remove');
    press('ArrowLeft');
    await focus('c2 cell');
    press('ArrowUp');
    await focus('c1 cell');
    press('ArrowDown');
    await focus('c2 cell');

    press('Delete');
    await waitFor(() => expect(value()).toBe('c1,p1'));
    await focus('p1 cell');
    press('Backspace');
    await waitFor(() => expect(value()).toBe('c1'));
    await focus('c1 cell');
    press('ArrowRight');
    await focus('c1 remove');
    press('Enter');
    await waitFor(() => expect(value()).toBe(''));
    await focus('input');

    // Each removal above took focus off a chip for nowhere; none of it was leaving the field.
    await new Promise((settled) => setTimeout(settled, 100));
    await expect(canvasElement.querySelector('mat-error')).toBeNull();
    field.blur();
    await waitFor(() =>
      expect(canvasElement.querySelector('mat-error')).toHaveTextContent('Required'),
    );
  },
};

export const MultipleStoredReferences: Story = {
  args: { multiple: true, value: ['c1', 'a1b2c3d4-gone'] },
};
export const MultiplePaths: Story = { args: { multiple: true, idProperty: 'path', value: [] } };
export const MultipleDisabled: Story = {
  args: { multiple: true, disabled: true, value: ['c1', 'c2'] },
};
