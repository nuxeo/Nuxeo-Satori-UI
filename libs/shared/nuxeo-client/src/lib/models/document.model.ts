import { NuxeoPaginatedList } from './paginated.model';
import { NuxeoAcl } from './acl.model';

export interface NuxeoDocument {
  uid: string;
  title: string;
  type: string;
  path: string;
  lastModified: string;
  properties: Record<string, unknown>;
  parentRef?: string;
  lockOwner?: string | null;
  lockCreated?: string | null;
  state?: string;
  isTrashed?: boolean;
  isCheckedOut?: boolean;
  /** True on a version snapshot, false on the live document. */
  isVersion?: boolean;
  /** True on a proxy — a published copy or a live proxy — rather than the document itself. */
  isProxy?: boolean;
  /**
   * The **live** document this version was cut from.
   *
   * Not the same as `parentRef`: Nuxeo reports a version's `parentRef` as the live
   * document's *folder*, so `parentRef` alone cannot get you back to the document a
   * version belongs to.
   */
  versionableId?: string;
  isLatestVersion?: boolean;
  isLatestMajorVersion?: boolean;
  facets?: string[];
  contextParameters?: {
    acls?: NuxeoAcl[];
    favorites?: { isFavorite: boolean };
    subscribedNotifications?: string[];
    [key: string]: unknown;
  };
}

export type NuxeoDocumentList = NuxeoPaginatedList<NuxeoDocument>;
