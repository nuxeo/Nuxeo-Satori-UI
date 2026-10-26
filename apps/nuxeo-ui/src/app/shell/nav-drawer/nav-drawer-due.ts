import type { TaskDueDistance } from '@nuxeo/satori-platform/nuxeo-client';

const DUE_KEYS = {
  due: {
    one: 'shell.task-due.in-days-one',
    many: 'shell.task-due.in-days-many',
    hours: 'shell.task-due.in-hours-many',
    underTwoHours: 'shell.task-due.in-less-than-an-hour',
  },
  overdue: {
    one: 'shell.task-due.by-days-one',
    many: 'shell.task-due.by-days-many',
    hours: 'shell.task-due.by-hours-many',
    underTwoHours: 'shell.task-due.by-less-than-an-hour',
  },
} as const;

/**
 * Catalogue key for the drawer's due fragment, which follows a separate "Due" or "Overdue" word:
 * "in 3 days", "by 1 day", "in less than an hour".
 */
export function drawerDueKey(distance: TaskDueDistance): string {
  const keys = distance.due ? DUE_KEYS.due : DUE_KEYS.overdue;
  switch (distance.unit) {
    case 'days':
      return distance.count === 1 ? keys.one : keys.many;
    case 'hours':
      return keys.hours;
    case 'under-two-hours':
      return keys.underTwoHours;
  }
}
