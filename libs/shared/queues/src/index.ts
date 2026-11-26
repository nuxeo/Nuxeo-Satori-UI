/**
 * The queue engine: an app's `queues/<id>.json` drawn as a list of records with facets, row and
 * bulk actions, shown by a rule (docs/business-apps/app-definition-v2.md, section 4).
 */
export { QueuePageComponent } from './lib/queue-page/queue-page';
export {
  QUEUE_LOAD_TIMEOUT_MS,
  QueueService,
  isQueueId,
  queueFileUrl,
  queueLink,
  type QueueLoad,
} from './lib/queue.service';
export {
  readQueue,
  type QueueFacet,
  type QueueFile,
  type QueueRegistered,
  type QueueSearch,
  type ReadQueue,
} from './lib/queue-file';
export {
  DEFAULT_TERMS_SIZE,
  facetBuckets,
  type FacetBucket,
  type FacetBuckets,
} from './lib/facets';
