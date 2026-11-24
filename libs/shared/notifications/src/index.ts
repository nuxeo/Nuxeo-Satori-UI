/**
 * The notification centre: the header's bell, with the signed-in user's open tasks and recent
 * changes to the records they follow, read from tasks, subscriptions and the audit. In the app
 * only: Nuxeo has no notification API, and the read state stays in the browser.
 */
export { NotificationBellComponent } from './lib/notification-bell/notification-bell';
export { NotificationCenter } from './lib/notification-center';
export {
  NotificationPoller,
  type NotificationPollerDocument,
  type NotificationPollerOptions,
} from './lib/notification-poller';
export {
  NOTIFICATION_SEEN_KEY_PREFIX,
  NOTIFICATION_SEEN_LIMIT,
  NotificationReadState,
} from './lib/notification-read-state';
export {
  NotificationSources,
  timestampLiteral,
  type ChangesRead,
  type ChangesWanted,
  type FollowedPage,
} from './lib/notification-sources';
export {
  DEFAULT_NOTIFICATION_POLL_INTERVAL_MS,
  MAX_NOTIFICATION_POLL_INTERVAL_MS,
  MAX_NOTIFICATION_RETRY_DELAY_MS,
  MIN_NOTIFICATION_POLL_INTERVAL_MS,
  NOTIFICATIONS_FEATURE_TOGGLE,
  NOTIFICATION_CHANGE_LIMIT,
  NOTIFICATION_EVENTS,
  NOTIFICATION_FOLLOWED_LIMIT,
  NOTIFICATION_FOLLOWED_PAGES,
  NOTIFICATION_NOW,
  NOTIFICATION_TASK_LIMIT,
  NOTIFICATION_TASK_READ_LIMIT,
  NOTIFICATION_TIME_ZONE,
  NOTIFICATION_WINDOW_MS,
  type NotificationEvent,
  isNotificationEvent,
  notificationPollInterval,
  notificationRetryDelay,
} from './lib/notification-settings';
export type {
  ChangeNotification,
  FollowedRecord,
  NotificationItem,
  TaskNotification,
} from './lib/notification.model';
