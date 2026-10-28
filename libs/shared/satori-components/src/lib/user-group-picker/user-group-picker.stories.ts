import type { Provider } from '@angular/core';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { delay, of, throwError, type Observable } from 'rxjs';
import { expect, fireEvent, userEvent, waitFor, within } from 'storybook/test';

import {
  DocumentDetailService,
  UserService,
  type NuxeoGroup,
  type NuxeoUser,
  type UserGroupSuggestion,
} from '@nuxeo/satori-platform/nuxeo-client';

import { NxsUserGroupPickerComponent, type NxsPrincipal } from './user-group-picker.component';

const PEOPLE: readonly UserGroupSuggestion[] = [
  {
    id: 'jsmith',
    displayLabel: 'Jane Smith',
    type: 'USER_TYPE',
    prefixed_id: 'user:jsmith',
    email: 'jane.smith@example.com',
  },
  { id: 'jsmythe', displayLabel: 'John Smythe', type: 'USER_TYPE', prefixed_id: 'user:jsmythe' },
  {
    id: 'claims-team',
    displayLabel: 'Claims team',
    type: 'GROUP_TYPE',
    prefixed_id: 'group:claims-team',
  },
];

const matching = (term: string) =>
  PEOPLE.filter((entry) =>
    `${entry.id} ${entry.displayLabel}`.toLowerCase().includes(term.toLowerCase()),
  );

/** The directory, answered from memory after `ms`, or refused. */
const directory = (answer: 'found' | 'refused' = 'found', ms = 150): Provider[] => {
  const reply = <T>(value: () => T): Observable<T> =>
    answer === 'refused' ? throwError(() => ({ status: 500 })) : of(value()).pipe(delay(ms));
  return [
    {
      provide: DocumentDetailService,
      useValue: { searchUsersGroups: (term: string) => reply(() => matching(term)) },
    },
    {
      provide: UserService,
      useValue: {
        searchUsers: (term: string) =>
          reply(() =>
            matching(term)
              .filter((entry) => entry.type === 'USER_TYPE')
              .map((entry) => {
                const [firstName, lastName] = entry.displayLabel.split(' ');
                return {
                  id: entry.id,
                  properties: { firstName, lastName, email: entry.email ?? '' },
                } as NuxeoUser;
              }),
          ),
        searchGroups: (term: string) =>
          reply(() =>
            matching(term)
              .filter((entry) => entry.type === 'GROUP_TYPE')
              .map(
                (entry) => ({ groupname: entry.id, grouplabel: entry.displayLabel }) as NuxeoGroup,
              ),
          ),
      },
    },
  ];
};

/**
 * Finds a user or a group as the user types and returns the one chosen, as Web UI's
 * `nuxeo-user-suggestion` does: from three characters, 300 ms after the last key. These stories
 * answer from an in-memory directory of three principals — Jane Smith, John Smythe and the Claims
 * team — after 150 ms.
 */
const meta: Meta<NxsUserGroupPickerComponent> = {
  title: 'Pickers/User and group picker',
  component: NxsUserGroupPickerComponent,
  tags: ['autodocs'],
  args: {
    label: 'Grant to',
    search: 'users-and-groups',
    minChars: 3,
    hint: '',
    required: false,
    disabled: false,
    multiple: false,
    value: null,
  },
  argTypes: {
    label: { control: 'text', description: 'The field’s label, already translated. Required.' },
    search: {
      control: 'select',
      options: ['users-and-groups', 'users', 'groups'],
      description: 'Whom to search.',
    },
    minChars: {
      control: { type: 'number', min: 1, max: 5, step: 1 },
      description: 'Characters typed before the server is asked. 3 by default, as in Web UI.',
    },
    hint: { control: 'text', description: 'Help under the field, already translated.' },
    required: { control: 'boolean' },
    disabled: { control: 'boolean' },
    multiple: {
      control: 'boolean',
      description: 'Choose several entries as removable chips; value is an ordered array.',
    },
    value: { control: false, description: 'The principal chosen, or null. Two-way.' },
  },
  decorators: [applicationConfig({ providers: directory() })],
  render: (args) => ({
    props: {
      ...args,
      showValue: (value: NxsPrincipal | readonly NxsPrincipal[] | null) =>
        Array.isArray(value)
          ? value.map((entry) => entry.prefixedId).join(', ')
          : ((value as NxsPrincipal | null)?.prefixedId ?? '—'),
    },
    template: `<nxs-user-group-picker
  [label]="label"
  [multiple]="multiple"
  [search]="search"
  [minChars]="minChars"
  [hint]="hint"
  [required]="required"
  [disabled]="disabled"
  [(value)]="value"
/>
<output class="story-value">{{ showValue(value) }}</output>`,
  }),
};

export default meta;

type Story = StoryObj<NxsUserGroupPickerComponent>;

/** Type `smi`: Jane Smith, then John Smythe and the Claims team as you type more or less. */
export const Default: Story = {};

/** Typing `smi` lists the matches; choosing one fills the field and sets `value`, shown below it. */
export const ChoosingAPrincipal: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const field = canvas.getByRole('combobox', { name: 'Grant to' });
    await userEvent.type(field, 'smi');
    const option = await within(document.body).findByRole('option', { name: /Jane Smith/ });
    await userEvent.click(option);
    await expect(field).toHaveValue('Jane Smith');
    await expect(canvasElement.querySelector('output')).toHaveTextContent('user:jsmith');
  },
};

/** Groups only, through the group directory. */
export const GroupsOnly: Story = { args: { label: 'Assign to group', search: 'groups' } };

export const WithAValue: Story = {
  args: {
    value: {
      id: 'claims-team',
      label: 'Claims team',
      kind: 'group',
      prefixedId: 'group:claims-team',
    },
  },
};

/** Two characters are not enough: the hint says how many the search needs, and nothing is sent. */
export const TooFewCharacters: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole('combobox', { name: 'Grant to' }), 'sm');
    await expect(await canvas.findByText('Type at least 3 characters')).toBeVisible();
  },
};

/** The server refuses: the list says so and the field keeps working. */
export const ServerError: Story = {
  decorators: [applicationConfig({ providers: directory('refused') })],
  play: async ({ canvasElement }) => {
    await userEvent.type(within(canvasElement).getByRole('combobox', { name: 'Grant to' }), 'smi');
    const status = await within(document.body).findByRole('option', {
      name: 'Search failed. Try again.',
    });
    await waitFor(() => expect(status).toBeVisible());
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
    value: { id: 'jsmith', label: 'Jane Smith', kind: 'user', prefixedId: 'user:jsmith' },
  },
};

/** Pick several principals, remove one by its name, then use the keyboard to remove the last. */
export const Multiple: Story = {
  args: { multiple: true, value: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const field = canvas.getByRole('combobox', { name: 'Grant to' });
    await userEvent.type(field, 'smi');
    await userEvent.click(await within(document.body).findByRole('option', { name: /Jane Smith/ }));
    await expect(field).toHaveValue('');
    await userEvent.type(field, 'cla');
    await userEvent.click(
      await within(document.body).findByRole('option', { name: /Claims team/ }),
    );
    await expect(canvasElement.querySelector('output')).toHaveTextContent(
      'user:jsmith, group:claims-team',
    );
    await userEvent.click(canvas.getByRole('button', { name: 'Remove Jane Smith' }));
    await expect(canvasElement.querySelector('output')).toHaveTextContent('group:claims-team');
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
 * What has focus: `input`, or a chip's principal and which of its two parts — `cell`, its gridcell,
 * or `remove`, its remove button. Anything else in the chip is `other`, so it cannot pass as either.
 */
function focusOf(field: HTMLElement): string {
  const active = document.activeElement as HTMLElement | null;
  if (active === field) return 'input';
  const chip = active?.closest('mat-chip-row')?.getAttribute('data-principal');
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
    const field = within(canvasElement).getByRole('combobox', { name: 'Grant to' });
    const value = () => canvasElement.querySelector('output')?.textContent?.trim();
    const focus = (expected: string) => waitFor(() => expect(focusOf(field)).toBe(expected));
    field.focus();
    for (const [term, name] of [
      ['smi', /Jane Smith/],
      ['smy', /John Smythe/],
      ['cla', /Claims team/],
    ] as const) {
      await userEvent.type(field, term, { skipClick: true });
      await within(document.body).findByRole('option', { name });
      press('ArrowDown', field);
      press('Enter', field);
      await waitFor(() => expect(field).toHaveValue(''));
    }
    await waitFor(() => expect(value()).toBe('user:jsmith, user:jsmythe, group:claims-team'));
    await focus('input');

    await userEvent.type(field, 'x', { skipClick: true });
    press('Backspace', field);
    await focus('input');
    await expect(canvasElement.querySelectorAll('mat-chip-row')).toHaveLength(3);
    await userEvent.clear(field);

    press('Backspace', field);
    await focus('group:claims-team cell');
    press('ArrowLeft');
    await focus('user:jsmythe remove');
    press('ArrowLeft');
    await focus('user:jsmythe cell');
    press('ArrowUp');
    await focus('user:jsmith cell');
    press('ArrowDown');
    await focus('user:jsmythe cell');

    press('Delete');
    await waitFor(() => expect(value()).toBe('user:jsmith, group:claims-team'));
    await focus('group:claims-team cell');
    press('Backspace');
    await waitFor(() => expect(value()).toBe('user:jsmith'));
    await focus('user:jsmith cell');
    press('ArrowRight');
    await focus('user:jsmith remove');
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

export const MultipleDisabled: Story = {
  args: {
    multiple: true,
    disabled: true,
    value: [{ id: 'jsmith', label: 'Jane Smith', kind: 'user', prefixedId: 'user:jsmith' }],
  },
};
