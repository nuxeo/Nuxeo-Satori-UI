import type { Provider } from '@angular/core';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { delay, of, throwError } from 'rxjs';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import {
  DirectoryService,
  type DirectoryEntry,
  type L10nDirectoryEntry,
} from '@nuxeo/satori-platform/nuxeo-client';

import { NxsVocabularySelectComponent } from './vocabulary-select.component';

const nature = (id: string, label: string): DirectoryEntry => ({
  id,
  label,
  displayLabel: label,
  ordering: 0,
  obsolete: 0,
  directoryName: 'nature',
});
const NATURE = [
  nature('invoice', 'Invoice'),
  nature('contract', 'Contract'),
  nature('memo', 'Memo'),
  nature('report', 'Report'),
];

const coverage = (id: string, parent: string, label: string): L10nDirectoryEntry => ({
  id,
  directoryName: 'l10ncoverage',
  properties: { id, parent, ordering: 0, obsolete: 0, label_en: label },
});
/** As the server holds `l10ncoverage`: bare ids, each child naming its parent. */
const COVERAGE = [
  coverage('europe', '', 'Europe'),
  coverage('africa', '', 'Africa'),
  coverage('antarctica', '', 'Antarctica'),
  coverage('France', 'europe', 'France'),
  coverage('Spain', 'europe', 'Spain'),
  coverage('Kenya', 'africa', 'Kenya'),
  coverage('Morocco', 'africa', 'Morocco'),
];

/** `nature` and `l10ncoverage`, answered from memory after 150 ms, or refused. */
const vocabularies = (answer: 'found' | 'refused' = 'found'): Provider => ({
  provide: DirectoryService,
  useValue: {
    getEntries: () =>
      answer === 'refused' ? throwError(() => ({ status: 500 })) : of(NATURE).pipe(delay(150)),
    getAllL10nEntries: () =>
      answer === 'refused' ? throwError(() => ({ status: 500 })) : of(COVERAGE).pipe(delay(150)),
  },
});

/**
 * Chooses one entry, or several, from a Nuxeo vocabulary, as Web UI's
 * `nuxeo-directory-suggestion` does. These stories answer from memory: `nature` with four
 * entries, and the hierarchical `l10ncoverage` with three continents and four countries, stored as
 * Web UI stores them: `europe/France`.
 */
const meta: Meta<NxsVocabularySelectComponent> = {
  title: 'Pickers/Vocabulary select',
  component: NxsVocabularySelectComponent,
  tags: ['autodocs'],
  args: {
    directory: 'nature',
    label: 'Nature',
    multiple: false,
    hint: '',
    required: false,
    disabled: false,
    value: null,
  },
  argTypes: {
    directory: {
      control: 'select',
      options: ['nature', 'l10ncoverage'],
      description: 'The directory to choose from. Required.',
    },
    label: { control: 'text', description: 'The field’s label, already translated. Required.' },
    multiple: { control: 'boolean', description: 'Choose several; the value is then a list.' },
    hint: { control: 'text', description: 'Help under the field, already translated.' },
    required: { control: 'boolean' },
    disabled: { control: 'boolean' },
    value: { control: false, description: 'The id chosen, or a list of ids. Two-way.' },
  },
  decorators: [applicationConfig({ providers: [vocabularies()] })],
  render: (args) => ({
    props: args,
    template: `<nxs-vocabulary-select
  [directory]="directory"
  [label]="label"
  [multiple]="multiple"
  [hint]="hint"
  [required]="required"
  [disabled]="disabled"
  [(value)]="value"
/>
<output class="story-value">{{ value ?? '—' }}</output>`,
  }),
};

export default meta;

type Story = StoryObj<NxsVocabularySelectComponent>;

/** Focus the field: the whole vocabulary is listed, and typing narrows it. */
export const Default: Story = {};

/** Typing `con` narrows Nature to Contract; choosing it sets the value to its id. */
export const ChoosingAnEntry: Story = {
  play: async ({ canvasElement }) => {
    const field = within(canvasElement).getByRole('combobox', { name: 'Nature' });
    await userEvent.type(field, 'con');
    await userEvent.click(await within(document.body).findByRole('option', { name: 'Contract' }));
    await expect(field).toHaveValue('Contract');
    await expect(canvasElement.querySelector('output')).toHaveTextContent('contract');
  },
};

/** A hierarchical vocabulary, several entries: countries under their continent, each a chip. */
export const SeveralFromAHierarchy: Story = {
  args: {
    directory: 'l10ncoverage',
    label: 'Coverage',
    multiple: true,
    value: ['europe/France', 'africa/Kenya'],
  },
};

/** An id the vocabulary no longer has is kept, and shown as it is. */
export const ARetiredEntry: Story = { args: { value: 'fax' } };

/** The vocabulary could not be loaded: the list says so, and focusing again tries again. */
export const LoadFailed: Story = {
  decorators: [applicationConfig({ providers: [vocabularies('refused')] })],
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('combobox', { name: 'Nature' }));
    const status = await within(document.body).findByRole('option', {
      name: 'Could not load the list. Open it again to try again.',
    });
    // The panel fades in; wait for it rather than judging its first frame.
    await waitFor(() => expect(status).toBeVisible());
  },
};

export const Disabled: Story = { args: { disabled: true, value: 'invoice' } };
