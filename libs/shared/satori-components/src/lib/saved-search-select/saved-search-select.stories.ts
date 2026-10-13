import type { Provider } from '@angular/core';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { delay, of, type Observable } from 'rxjs';
import { fn } from 'storybook/test';

import { SearchService, type SavedSearchOption } from '@nuxeo-satori/platform/nuxeo-client';

import { NxsSavedSearchSelectComponent } from './saved-search-select.component';

const SEARCHES: SavedSearchOption[] = [
  { id: 'ss-1', title: 'Contracts this month' },
  { id: 'ss-2', title: 'Board papers (shared by jdoe)' },
  { id: 'ss-3', title: 'Large files' },
];

/** `SearchService.getSavedSearches`, answered from memory. */
const savedSearches = (answer: () => Observable<SavedSearchOption[]>): Provider => ({
  provide: SearchService,
  useValue: { getSavedSearches: answer },
});

/**
 * The saved searches the user can open — their own and those shared with them, as the server lists
 * them for `pageProvider`. The list is read when the box is first focused. These stories answer from
 * memory instead of Nuxeo.
 */
const meta: Meta<NxsSavedSearchSelectComponent> = {
  title: 'Search/Saved search select',
  component: NxsSavedSearchSelectComponent,
  tags: ['autodocs'],
  args: {
    selectedId: '',
    selectedTitle: '',
    pageProvider: 'default_search',
    refresh: 0,
    selectedChange: fn(),
  },
  argTypes: {
    selectedId: { control: 'text', description: 'The saved search open now; empty for none.' },
    selectedTitle: { control: 'text', description: 'Its title, shown in the box.' },
    pageProvider: { control: 'text', description: 'The page provider whose searches are listed.' },
    refresh: {
      control: { type: 'number', min: 0, step: 1 },
      description: 'Change it to read the list again.',
    },
    selectedChange: { control: false, description: 'The user chose a saved search.' },
  },
  decorators: [applicationConfig({ providers: [savedSearches(() => of(SEARCHES))] })],
  render: (args) => ({
    props: args,
    template: `<div style="width: min(280px, 100%); min-height: 240px">
  <nxs-saved-search-select
    [selectedId]="selectedId"
    [selectedTitle]="selectedTitle"
    [pageProvider]="pageProvider"
    [refresh]="refresh"
    (selectedChange)="selectedChange($event)"
  />
</div>`,
  }),
};

export default meta;

type Story = StoryObj<NxsSavedSearchSelectComponent>;

/** None open: the box shows its placeholder. Focus it to list the saved searches. */
export const NoneOpen: Story = {};

/** One open: its title is in the box. Typing narrows the list. */
export const OneOpen: Story = {
  args: { selectedId: 'ss-2', selectedTitle: 'Board papers (shared by jdoe)' },
};

/** The user has no saved search and none is shared with them. */
export const NoSavedSearches: Story = {
  decorators: [applicationConfig({ providers: [savedSearches(() => of([]))] })],
};

/** A slow server: the list says it is loading. */
export const Loading: Story = {
  decorators: [
    applicationConfig({ providers: [savedSearches(() => of(SEARCHES).pipe(delay(60_000)))] }),
  ],
};
