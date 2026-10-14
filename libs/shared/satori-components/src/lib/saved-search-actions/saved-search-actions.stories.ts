import type { Provider } from '@angular/core';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { of } from 'rxjs';
import { fn } from 'storybook/test';

import { DocumentDetailService, type NuxeoDocument } from '@nuxeo-satori/platform/nuxeo-client';

import { NxsSavedSearchActionsComponent } from './saved-search-actions.component';

/** `getDocumentPermissions` answering with the saved search holding `permissions`. */
const permissions = (granted: string[]): Provider => ({
  provide: DocumentDetailService,
  useValue: {
    getDocumentPermissions: () =>
      of({ contextParameters: { permissions: granted } } as unknown as NuxeoDocument),
  },
});

/**
 * The actions on the search being shown, as Web UI's `nuxeo-saved-search-actions` offers them: Save
 * as whenever there is something to save, and Save, Rename, Share and Delete on a saved search the
 * user may change — the server's `WriteProperties` permission on it. The permission read is answered
 * from memory here.
 */
const meta: Meta<NxsSavedSearchActionsComponent> = {
  title: 'Search/Saved search actions',
  component: NxsSavedSearchActionsComponent,
  tags: ['autodocs'],
  args: {
    savedSearchId: '',
    dirty: false,
    hasFilters: true,
    saveAs: fn(),
    save: fn(),
    rename: fn(),
    share: fn(),
    remove: fn(),
  },
  argTypes: {
    savedSearchId: { control: 'text', description: 'The saved search open now; empty for none.' },
    dirty: {
      control: 'boolean',
      description: "Whether the filters differ from the saved search's.",
    },
    hasFilters: { control: 'boolean', description: 'Whether any filter is set.' },
    saveAs: { control: false, description: 'Save the filters as a new saved search.' },
    save: { control: false, description: 'Save the filters into the open saved search.' },
    rename: { control: false, description: 'Rename the open saved search.' },
    share: { control: false, description: 'Share the open saved search.' },
    remove: { control: false, description: 'Delete the open saved search.' },
  },
  decorators: [applicationConfig({ providers: [permissions(['Read', 'WriteProperties'])] })],
};

export default meta;

type Story = StoryObj<NxsSavedSearchActionsComponent>;

/** Filters set, no saved search open: only Save as. */
export const UnsavedFilters: Story = {};

/** A saved search the user owns, with its filters changed: Save as, Save and the menu. */
export const ChangedSavedSearch: Story = { args: { savedSearchId: 'ss-1', dirty: true } };

/** The same search, unchanged: there is nothing to Save, so Save is not offered. */
export const UnchangedSavedSearch: Story = { args: { savedSearchId: 'ss-1', dirty: false } };

/**
 * A search shared with the user read-only: they can save a copy with Save as, and nothing else —
 * the server would refuse the change.
 */
export const SharedReadOnly: Story = {
  args: { savedSearchId: 'ss-2', dirty: true },
  decorators: [applicationConfig({ providers: [permissions(['Read', 'ReadProperties'])] })],
};

/** No filter and no saved search: nothing to save, so nothing is shown. */
export const NothingToSave: Story = { args: { hasFilters: false } };
