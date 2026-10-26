import type { Provider } from '@angular/core';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { delay, of, throwError, type Observable } from 'rxjs';
import { fn } from 'storybook/test';

import {
  SearchService,
  type SearchAggregations,
  type SearchCollectionOption,
} from '@nuxeo/satori-platform/nuxeo-client';

import { NxsSearchFiltersComponent } from './search-filters.component';
import { NXS_EMPTY_SEARCH_FILTERS, type NxsSearchFilters } from './search-filters.model';

const COLLECTIONS: SearchCollectionOption[] = [
  { id: 'col-claims', title: 'Claims 2026', itemCount: 42 },
  { id: 'col-board', title: 'Board papers', itemCount: 7 },
];
const TAGS = ['annual-report', 'archive', 'audit'];

/** `SearchService`'s two lookups, answered from memory. */
const lookups = (collections: () => Observable<SearchCollectionOption[]>): Provider => ({
  provide: SearchService,
  useValue: {
    getUserCollections: collections,
    getTagSuggestions: (term: string) =>
      of(TAGS.filter((tag) => tag.startsWith(term.toLowerCase()))),
  },
});

/** What `default_search` answers for a query over a few hundred documents. */
const AGGREGATIONS: SearchAggregations = {
  dc_modified_agg: {
    buckets: [
      { key: 'last24h', docCount: 12 },
      { key: 'lastWeek', docCount: 30 },
      { key: 'lastMonth', docCount: 154 },
      { key: 'lastYear', docCount: 61 },
      { key: 'priorToLastYear', docCount: 0 },
    ],
  },
  dc_creator_agg: {
    buckets: [
      { key: 'Administrator', docCount: 201 },
      { key: 'jdoe', docCount: 48 },
      { key: 'asmith', docCount: 8 },
    ],
  },
  dc_nature_agg: {
    buckets: [
      { key: 'contract', docCount: 40 },
      { key: 'report', docCount: 22 },
    ],
  },
  dc_subjects_agg: {
    buckets: [
      { key: 'art', docCount: 10 },
      { key: 'art/cinema', docCount: 4 },
    ],
  },
  dc_coverage_agg: { buckets: [{ key: 'europe/France', docCount: 3 }] },
  common_size_agg: {
    buckets: [
      { key: 'tiny', docCount: 151 },
      { key: 'small', docCount: 11 },
      { key: 'medium', docCount: 3 },
      { key: 'big', docCount: 0 },
      { key: 'huge', docCount: 0 },
    ],
  },
};

const SELECTED: NxsSearchFilters = {
  ...NXS_EMPTY_SEARCH_FILTERS,
  fulltext: 'contract',
  modified: ['lastMonth'],
  authors: ['jdoe', 'asmith'],
  tags: ['archive'],
  nature: ['contract'],
  coverage: ['asia/Japan'],
};

/**
 * Web UI's search form: full text, modification date, authors, collections, tags, nature, subjects,
 * coverage and size. It edits `filters`; the host runs the query and passes the server's
 * `aggregations` back for the counts. Collections and tag suggestions come from in-memory fakes
 * here, not from Nuxeo.
 */
const meta: Meta<NxsSearchFiltersComponent> = {
  title: 'Search/Search filters',
  component: NxsSearchFiltersComponent,
  tags: ['autodocs'],
  args: {
    filters: NXS_EMPTY_SEARCH_FILTERS,
    aggregations: AGGREGATIONS,
    filtersReset: fn(),
    saveAs: fn(),
  },
  argTypes: {
    filters: {
      control: 'object',
      description: 'The filters shown; two-way. Every change the user makes is written back.',
    },
    aggregations: {
      control: 'object',
      description: "The server's aggregates for the query: each choice's count.",
    },
    filtersReset: { control: false, description: 'Reset was pressed; the filters are now empty.' },
    saveAs: { control: false, description: 'Save as was pressed.' },
  },
  decorators: [applicationConfig({ providers: [lookups(() => of(COLLECTIONS))] })],
  // `filtersChange` is the two-way binding's event, which Storybook's arg types leave out.
  render: (args) => ({
    props: { ...args, filtersChange: fn().mockName('filtersChange') },
    template: `<div style="width: min(320px, 100%); height: 640px; display: flex">
  <nxs-search-filters
    style="flex: 1"
    [(filters)]="filters"
    [aggregations]="aggregations"
    (filtersChange)="filtersChange($event)"
    (filtersReset)="filtersReset()"
    (saveAs)="saveAs()"
  />
</div>`,
  }),
};

export default meta;

type Story = StoryObj<NxsSearchFiltersComponent>;

/** Nothing chosen yet: Reset and Save as are disabled, and Modification Date is open. */
export const NothingChosen: Story = {};

/**
 * A query with choices made: two authors and a tag as chips, and the groups with a selection open.
 * Asia/Japan is selected but the server returned no bucket for it, so it is listed without a count
 * and can still be cleared.
 */
export const WithChoices: Story = { args: { filters: SELECTED } };

/** The server returned no aggregates: each terms group says there is nothing to choose. */
export const NoAggregates: Story = { args: { aggregations: {} } };

/** Opening Collections while the user's collections are read. */
export const CollectionsLoading: Story = {
  decorators: [
    applicationConfig({ providers: [lookups(() => of(COLLECTIONS).pipe(delay(60_000)))] }),
  ],
};

/** The user's collections could not be read: the list says so. */
export const CollectionsFailed: Story = {
  decorators: [
    applicationConfig({ providers: [lookups(() => throwError(() => ({ status: 500 })))] }),
  ],
};
