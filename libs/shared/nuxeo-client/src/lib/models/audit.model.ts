import { NuxeoPaginatedList } from './paginated.model';

export interface AuditEntry {
  id: number;
  category: string;
  principalName: string;
  comment: string;
  docLifeCycle: string;
  docPath: string;
  docType: string;
  docUUID: string;
  eventId: string;
  repositoryId: string;
  eventDate: string;
  logDate: string;
  extended: Record<string, unknown>;
}

export type AuditLogList = NuxeoPaginatedList<AuditEntry>;

/** The columns the `@audit` adapter sorts on. */
export type AuditLogSortField = 'eventId' | 'eventDate' | 'principalName' | 'category';

/**
 * What the `@audit` adapter filters and sorts on, server-side — the parameters Web UI's
 * `nuxeo-audit-search` sends. Every field is optional; an absent one does not filter.
 */
export interface AuditLogQuery {
  /** The user who performed the action. */
  readonly principalName?: string;
  /** Event IDs, any of which matches — `documentModified`, `documentLocked`. */
  readonly eventIds?: readonly string[];
  /** One event category — `eventDocumentCategory`. */
  readonly eventCategory?: string;
  /** The earliest event, inclusive. */
  readonly startDate?: Date;
  /** The first instant after the last event wanted: the adapter's end is exclusive. */
  readonly endDate?: Date;
  readonly sortBy?: AuditLogSortField;
  readonly sortOrder?: 'asc' | 'desc';
}
