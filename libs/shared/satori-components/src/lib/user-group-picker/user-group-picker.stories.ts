import type { Provider } from '@angular/core';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { delay, of, throwError, type Observable } from 'rxjs';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import {
  DocumentDetailService,
  UserService,
  type NuxeoGroup,
  type NuxeoUser,
  type UserGroupSuggestion,
} from '@nuxeo-satori/platform/nuxeo-client';

import { NxsUserGroupPickerComponent } from './user-group-picker.component';

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
    value: { control: false, description: 'The principal chosen, or null. Two-way.' },
  },
  decorators: [applicationConfig({ providers: directory() })],
  render: (args) => ({
    props: args,
    template: `<nxs-user-group-picker
  [label]="label"
  [search]="search"
  [minChars]="minChars"
  [hint]="hint"
  [required]="required"
  [disabled]="disabled"
  [(value)]="value"
/>
<output class="story-value">{{ value?.prefixedId ?? '—' }}</output>`,
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
    await expect(canvasElement.querySelector('output')).toHaveTextContent('user:seeded-failure');
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
