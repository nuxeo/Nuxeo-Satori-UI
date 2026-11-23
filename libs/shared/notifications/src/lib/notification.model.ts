import type { NotificationEvent } from './notification-settings';

/** An open workflow task assigned to the reader. */
export interface TaskNotification {
  readonly kind: 'task';
  /** `task:<task id>`, unique across both kinds. */
  readonly key: string;
  readonly taskId: string;
  /** When the task was created, as Nuxeo wrote it: an instant. */
  readonly at: string;
  /** The step's directive, or its name, written out. */
  readonly title: string;
  /** The title of the record the task is about, if it has one. */
  readonly record: string | null;
}

/** A change someone else made to a record the reader follows. */
export interface ChangeNotification {
  readonly kind: 'change';
  /** `change:<audit entry id>`. */
  readonly key: string;
  readonly auditId: number;
  /** When it happened, as the audit wrote it: an instant. */
  readonly at: string;
  /** Who made it: the audit's principal. */
  readonly who: string;
  readonly event: NotificationEvent;
  /** For a lifecycle transition, the state it reached. */
  readonly state: string | null;
  readonly uid: string;
  readonly title: string;
}

export type NotificationItem = TaskNotification | ChangeNotification;

/** A record the reader follows, as the followed-records query returns it. */
export interface FollowedRecord {
  readonly uid: string;
  readonly title: string;
  /** `dc:modified`: what moves when the record is edited, commented on or follows a transition. */
  readonly modified: string;
}
