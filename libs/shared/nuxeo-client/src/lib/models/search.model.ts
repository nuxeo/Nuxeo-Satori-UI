import type { AggregateResult } from './asset.model';

export interface SearchAggregations {
  dc_modified_agg?: AggregateResult;
  dc_creator_agg?: AggregateResult;
  collection_agg?: AggregateResult;
  dc_nature_agg?: AggregateResult;
  dc_coverage_agg?: AggregateResult;
  dc_subjects_agg?: AggregateResult;
  common_size_agg?: AggregateResult;
}

export interface SearchResponse {
  items: SearchResultItem[];
  aggregations: SearchAggregations;
  /** Every match across every page; negative when the server did not count them. */
  totalSize: number;
  /** Whether the server has a page after this one. */
  hasNextPage: boolean;
}

export interface SearchResultItem {
  id: string;
  title: string;
  type: string;
  path?: string;
  isFavorite?: boolean;
  modifiedDate: string;
  sizeInBytes?: number;
  lastContributor: string;
  createdDate?: string;
  author: string;
  authorKey: string;
  state?: string;
  version?: string;
  nature?: string;
  coverage?: string;
  subjects?: string;
  flags?: string;
  collection: string;
  collectionKey: string;
  tags: string[];
  icon: string;
}
