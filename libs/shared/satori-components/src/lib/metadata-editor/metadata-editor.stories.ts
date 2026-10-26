import {
  DirectoryService,
  type DirectoryEntry,
  type L10nDirectoryEntry,
} from '@nuxeo/satori-platform/nuxeo-client';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { of } from 'rxjs';
import { fn } from 'storybook/test';

import { NxsMetadataEditorComponent } from './metadata-editor.component';
import type { NxsEditorSection, NxsEditorValues } from './metadata-editor.model';

const entry = (id: string, label: string): DirectoryEntry => ({
  id,
  label,
  displayLabel: label,
  ordering: 0,
  obsolete: 0,
  directoryName: 'nature',
});

const l10n = (id: string, label: string, parent = ''): L10nDirectoryEntry => ({
  id,
  directoryName: 'l10n',
  properties: { id, parent, ordering: 0, obsolete: 0, label_en: label },
});

const VOCABULARIES: Readonly<Record<string, readonly L10nDirectoryEntry[]>> = {
  l10nsubjects: [
    l10n('art', 'Art'),
    l10n('art/cinema', 'Cinema', 'art'),
    l10n('art/music', 'Music', 'art'),
    l10n('sciences', 'Sciences'),
    l10n('sciences/astronomy', 'Astronomy', 'sciences'),
  ],
  l10ncoverage: [
    l10n('europe', 'Europe'),
    l10n('europe/France', 'France', 'europe'),
    l10n('europe/Italy', 'Italy', 'europe'),
  ],
};

const directories: Pick<DirectoryService, 'getEntries' | 'getAllL10nEntries'> = {
  getEntries: () =>
    of([entry('report', 'Report'), entry('invoice', 'Invoice'), entry('memo', 'Memo')]),
  getAllL10nEntries: (name: string) => of([...(VOCABULARIES[name] ?? [])]),
};

const FILE_VALUES: NxsEditorValues = {
  'dc:title': 'Quarterly report',
  'dc:description': 'Revenue and cost figures for the first quarter.',
  'dc:nature': 'report',
  'dc:subjects': ['art/cinema'],
  'dc:coverage': 'europe/France',
  'dc:expired': '2027-01-31T00:00:00.000Z',
};

const POLICY_VALUES: NxsEditorValues = {
  ...FILE_VALUES,
  'pol:number': 'AB-1042',
  'pol:premium': 1200,
  'pol:active': true,
  'pol:codes': ['HOME', 'AUTO'],
  'pol:holder': { name: 'Ada Lovelace', email: 'ada@example.com' },
  'pol:contacts': [{ name: 'Bob Brown', phone: '+44 20 7946 0000' }],
  'pol:scan': { name: 'signed-policy.pdf', 'mime-type': 'application/pdf', length: '48213' },
};

/** A customer type's section, with what Nuxeo reports of its schema's constraints. */
const POLICY: NxsEditorSection = {
  id: 'policy',
  heading: 'Policy',
  fields: [
    {
      xpath: 'pol:number',
      label: 'Policy number',
      definition: { type: 'string', required: true, constraints: { pattern: '[A-Z]{2}-\\d+' } },
    },
    {
      xpath: 'pol:premium',
      label: 'Premium',
      definition: { type: 'long', constraints: { minimum: 0, minimumInclusive: false } },
    },
    { xpath: 'pol:active', label: 'Active', definition: { type: 'boolean' } },
    {
      xpath: 'pol:codes',
      label: 'Product codes',
      definition: { type: 'string[]', constraints: { maxLength: 8 } },
    },
    {
      xpath: 'pol:holder',
      label: 'Holder',
      definition: {
        type: 'complex',
        fields: { name: { type: 'string' }, email: { type: 'string' } },
      },
    },
    {
      xpath: 'pol:contacts',
      label: 'Contacts',
      definition: {
        type: 'complex[]',
        fields: { name: { type: 'string', required: true }, phone: { type: 'string' } },
      },
    },
    { xpath: 'pol:scan', label: 'Signed copy', definition: { type: 'blob' } },
  ],
};

const CLAIMS: NxsEditorSection = {
  id: 'claims',
  heading: 'Claims',
  fields: [
    {
      xpath: 'cl:reference',
      label: 'Claim reference',
      definition: { type: 'string', required: true },
    },
    { xpath: 'cl:opened', label: 'Opened on', definition: { type: 'date' } },
  ],
};

/**
 * The form that edits a document's properties: the Dublin Core fields, then the type's own sections
 * with a control per field type and the schema's constraints checked as the user types.
 */
const meta: Meta<NxsMetadataEditorComponent> = {
  title: 'Documents/Metadata editor',
  component: NxsMetadataEditorComponent,
  tags: ['autodocs'],
  decorators: [
    applicationConfig({ providers: [{ provide: DirectoryService, useValue: directories }] }),
  ],
  render: (args) => ({
    props: args,
    template: `
      <div style="max-width: 560px; padding: 16px; background: var(--mat-sys-surface)">
        <nxs-metadata-editor
          #editor
          [sections]="sections"
          [display]="display"
          [values]="values"
          [dublinCore]="dublinCore"
          [disabled]="disabled"
          [headingLevel]="headingLevel"
          [tabsLabel]="tabsLabel"
          (validChange)="validChange($event)"
        />
        <p style="margin-top: 16px">
          <button type="button" (click)="editor.validate()">Validate as Save would</button>
        </p>
      </div>
    `,
  }),
  args: {
    sections: [],
    display: 'sections',
    values: FILE_VALUES,
    dublinCore: true,
    disabled: false,
    headingLevel: 3,
    tabsLabel: '',
    validChange: fn(),
  },
  argTypes: {
    sections: {
      control: 'object',
      description:
        'The type’s sections beyond Dublin Core, from its layout. Each field carries its schema type.',
    },
    display: {
      control: 'inline-radio',
      options: ['sections', 'tabs'],
      description: 'The type’s sections one after another under headings, or as tabs.',
    },
    values: {
      control: 'object',
      description: 'The current property values, by xpath. A new object resets the form.',
    },
    dublinCore: { control: 'boolean', description: 'Show the Dublin Core fields.' },
    disabled: { control: 'boolean', description: 'While saving: every control is read-only.' },
    headingLevel: {
      control: 'select',
      options: [2, 3, 4, 5, 6],
      description: 'The level of the section headings.',
    },
    tabsLabel: {
      control: 'text',
      description:
        'The tab strip’s accessible name in tabs display. Blank uses “Metadata sections”.',
    },
    validChange: { control: false, description: 'Every value passes its constraints, or not.' },
  },
};

export default meta;

type Story = StoryObj<NxsMetadataEditorComponent>;

/** Editing a File: the Dublin Core fields, vocabulary values shown by label. */
export const EditFile: Story = {};

/** A customer type: text with a pattern, a bounded number, a checkbox, a list, groups and a file. */
export const CustomerType: Story = {
  args: { sections: [POLICY], values: POLICY_VALUES },
};

/** The same type with its sections as tabs. */
export const AsTabs: Story = {
  args: { sections: [POLICY, CLAIMS], display: 'tabs', values: POLICY_VALUES },
};

/** Creating a document: nothing filled in yet. Validate to see the errors and the summary. */
export const Create: Story = {
  args: { sections: [POLICY], values: {} },
};

/** While the save request is in flight. */
export const Saving: Story = {
  args: { sections: [POLICY], values: POLICY_VALUES, disabled: true },
};
