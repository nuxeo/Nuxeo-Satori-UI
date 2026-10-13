import type { NuxeoDocument } from '@nuxeo-satori/platform/nuxeo-client';
import type { Meta, StoryObj } from '@storybook/angular';
import { fn } from 'storybook/test';

import { NxsPropertiesPanelComponent, type NxsVocabularyLabel } from './properties-panel.component';

const FILE: NuxeoDocument = {
  uid: 'story-file',
  path: '/default-domain/workspaces/Finance/Quarterly report',
  type: 'File',
  title: 'Quarterly report',
  state: 'project',
  facets: ['Versionable', 'NXTag', 'Commentable', 'Publishable'],
  lastModified: '2026-05-03T10:00:00.000Z',
  properties: {
    'dc:created': '2026-04-01T09:00:00.000Z',
    'dc:modified': '2026-05-03T10:00:00.000Z',
    'dc:creator': {
      'entity-type': 'user',
      id: 'jdoe',
      properties: { firstName: 'Jane', lastName: 'Doe' },
    },
    'dc:contributors': ['jdoe', 'asmith'],
    'dc:description': 'Revenue and cost figures for the first quarter.',
    'dc:nature': { 'entity-type': 'directoryEntry', properties: { id: 'report', label: 'Report' } },
    'dc:coverage': 'europe/France',
    'dc:subjects': ['art/cinema'],
    'nxtag:tags': ['finance', 'q1'],
    'file:content': {
      name: 'quarterly-report.pdf',
      'mime-type': 'application/pdf',
      length: '48213',
    },
  },
  contextParameters: {
    collections: [{ uid: 'c-1', title: 'Board pack', type: 'Collection' }],
  },
};

const VOCABULARY: Readonly<Record<string, string>> = {
  'l10ncoverage:europe/France': 'Europe / France',
  'l10nsubjects:art/cinema': 'Art / Cinema',
};

const LABELS: NxsVocabularyLabel = (directory, id) => VOCABULARY[`${directory}:${id}`] ?? id;

/**
 * The Properties view of a document page's side panel: lifecycle state, version, dates and people,
 * then the Dublin Core properties, tags and collections. Values are always labels or names.
 */
const meta: Meta<NxsPropertiesPanelComponent> = {
  title: 'Documents/Properties panel',
  component: NxsPropertiesPanelComponent,
  tags: ['autodocs'],
  render: (args) => ({
    props: args,
    template: `
      <div style="width: 340px; padding: 0 16px; background: var(--mat-sys-surface)">
        <nxs-properties-panel
          [document]="document"
          [vocabularyLabel]="vocabularyLabel"
          [processRunning]="processRunning"
          [versionLabel]="versionLabel"
          [publications]="publications"
          [format]="format"
          [headingLevel]="headingLevel"
          (publicationsSelected)="publicationsSelected()"
        />
      </div>
    `,
  }),
  args: {
    document: FILE,
    vocabularyLabel: LABELS,
    processRunning: false,
    versionLabel: '1.0+',
    publications: 2,
    format: '',
    headingLevel: 4,
    publicationsSelected: fn(),
  },
  argTypes: {
    document: { control: 'object', description: 'The document shown. Required.' },
    vocabularyLabel: {
      control: false,
      description:
        'Turns a nature, coverage or subject ID into its label. Without it the ID shows.',
    },
    processRunning: { control: 'boolean', description: 'A workflow is running on the document.' },
    versionLabel: {
      control: 'text',
      description: 'The version text. A projected `[nxsVersion]` control replaces it.',
    },
    publications: {
      control: 'number',
      description: 'How many times the document is published. `null` hides the row.',
    },
    format: { control: 'text', description: 'A note’s text format. Blank hides the row.' },
    headingLevel: {
      control: 'select',
      options: [2, 3, 4, 5, 6],
      description: 'The level of the section headings.',
    },
    publicationsSelected: { control: false, description: 'The publication count was pressed.' },
  },
};

export default meta;

type Story = StoryObj<NxsPropertiesPanelComponent>;

/** A file with a creator, contributors, Dublin Core properties, tags and a collection. */
export const FileProperties: Story = {};

/**
 * Directory entries, users and blobs that arrive as objects rather than IDs. The panel shows their
 * labels and names — never `[object Object]`, which is what ADF's properties sidebar printed.
 */
export const ResolvedEntries: Story = {
  args: {
    vocabularyLabel: null,
    document: {
      ...FILE,
      properties: {
        ...FILE.properties,
        'dc:coverage': {
          'entity-type': 'directoryEntry',
          properties: { id: 'europe/Italy', label: 'Italy' },
        },
        'dc:subjects': [
          {
            'entity-type': 'directoryEntry',
            properties: { id: 'sciences/astronomy', label: 'Astronomy' },
          },
        ],
        'dc:contributors': [
          {
            'entity-type': 'user',
            id: 'asmith',
            properties: { firstName: 'Ann', lastName: 'Smith' },
          },
        ],
      },
    },
  },
};

/** A folder: no tags facet, no file, no description — only the rows that have something to show. */
export const FolderWithoutTags: Story = {
  args: {
    versionLabel: '',
    publications: null,
    document: {
      uid: 'story-folder',
      path: '/default-domain/workspaces/Finance',
      type: 'Folder',
      title: 'Finance',
      state: 'project',
      facets: ['Folderish'],
      lastModified: '2026-01-12T08:00:00.000Z',
      properties: { 'dc:created': '2026-01-12T08:00:00.000Z', 'dc:creator': 'Administrator' },
    },
  },
};

/** A note under review: the process row is shown and the format is given. */
export const NoteInReview: Story = {
  args: {
    processRunning: true,
    format: 'Markdown',
    document: { ...FILE, type: 'Note', title: 'Release notes' },
  },
};
