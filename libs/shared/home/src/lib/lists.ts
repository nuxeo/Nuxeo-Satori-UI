/**
 * What a list card shows of each task or record (docs/business-apps/app-definition-v2.md,
 * section 10): a title that opens it, a line under the title, and the date it is listed by.
 *
 * Kept apart from the page, as `figures.ts` is, so that what a task or a record becomes is checked
 * without drawing a page.
 */
import {
  documentNavigationUrl,
  type NuxeoDocument,
  type NuxeoTask,
} from '@nuxeo/satori-platform/nuxeo-client';

/** A router link, as `routerLink` takes it. */
export type RouterTarget = string | readonly unknown[];

/** One task or record of a list card. */
export interface ListItem {
  readonly id: string;
  /** What the link says. Never blank: an untitled task or record shows its id. */
  readonly title: string;
  /** What is said under the title, each on its own: a task's record and workflow, a record's type. */
  readonly details: readonly string[];
  /** The date it is listed by, as the server writes it: a task's creation, a record's last change. */
  readonly date: string | null;
  readonly link: RouterTarget;
}

/**
 * A Nuxeo key made readable, as the drawer and the tasks page write a task's name:
 * `wf.serialDocumentReview.DocumentValidation` is "Document Validation", and
 * `wf.parallelDocumentReview.chooseParticipants.title` is "Choose Participants".
 */
export function readable(key: string): string {
  return key
    .replace(/^wf\.\w+\./, '')
    .replace(/\.(title|directive)$/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\./g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

const blank = (value: unknown): value is undefined | null | '' =>
  typeof value !== 'string' || value.trim() === '';

/**
 * A task as a list of tasks shows it: its name, the record it is about and its workflow, the day
 * it was created, and a link to it on the tasks page.
 */
export function taskItem(task: NuxeoTask, link: (id: string) => RouterTarget): ListItem {
  const name = blank(task.name) ? '' : readable(task.name);
  const workflow = blank(task.workflowTitle)
    ? blank(task.workflowModelName)
      ? ''
      : readable(task.workflowModelName)
    : readable(task.workflowTitle);
  const record = blank(task.targetDocTitle) ? '' : task.targetDocTitle.trim();
  return {
    id: task.id,
    title: name || task.id,
    details: [record, workflow].filter((part) => part !== ''),
    date: blank(task.created) ? null : task.created,
    link: link(task.id),
  };
}

/** A record as a list of recent records shows it: its title, its type, its last change, its page. */
export function recordItem(record: NuxeoDocument): ListItem {
  return {
    id: record.uid,
    title: blank(record.title) ? record.uid : record.title.trim(),
    details: blank(record.type) ? [] : [record.type],
    date: blank(record.lastModified) ? null : record.lastModified,
    link: documentNavigationUrl(record),
  };
}
