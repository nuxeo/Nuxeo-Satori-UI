import type { Provider } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { provideNativeDateAdapter } from '@angular/material/core';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { delay, of, throwError, type Observable } from 'rxjs';
import { action } from 'storybook/actions';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import {
  DirectoryService,
  DocumentDetailService,
  type AuditEntry,
  type AuditLogList,
  type AuditLogQuery,
} from '@nuxeo-satori/platform/nuxeo-client';

import { NxsDocumentHistoryComponent } from './document-history.component';

/** Logs each call in the Actions panel under `name`, then lets the fake answer it. */
function logged<A extends unknown[], R>(
  name: string,
  method: (...args: A) => R,
): (...args: A) => R {
  return (...args) => {
    action(name)(...args);
    return method(...args);
  };
}

const HOUR = 3_600_000;
const EVENTS: readonly [string, string, string][] = [
  ['documentCreated', 'asmith', ''],
  ['documentModified', 'asmith', ''],
  ['documentCheckedIn', 'asmith', '0.1'],
  ['documentLocked', 'jdoe', ''],
  ['documentModified', 'jdoe', 'Fixed the payment terms'],
  ['documentUnlocked', 'jdoe', ''],
  ['documentCheckedIn', 'jdoe', '1.0'],
  ['download', 'Administrator', ''],
];

/** An audit trail held in memory, filtered and paged the way the `@audit` adapter does it. */
function auditTrail(): AuditEntry[] {
  return EVENTS.map(([eventId, principalName, comment], index) => ({
    id: index + 1,
    category: 'eventDocumentCategory',
    principalName,
    comment,
    docLifeCycle: 'project',
    docPath: '/default-domain/workspaces/legal/Supplier contract',
    docType: 'File',
    docUUID: 'contract',
    eventId,
    repositoryId: 'default',
    eventDate: new Date(Date.now() - (EVENTS.length - index) * 5 * HOUR).toISOString(),
    logDate: new Date(Date.now() - (EVENTS.length - index) * 5 * HOUR).toISOString(),
    extended: {},
  }));
}

function serverSide(
  _uid: string,
  pageSize: number,
  pageIndex: number,
  query: AuditLogQuery,
): Observable<AuditLogList> {
  let entries = auditTrail().filter(
    (e) =>
      (!query.principalName || e.principalName === query.principalName) &&
      (!query.eventIds?.length || query.eventIds.includes(e.eventId)) &&
      (!query.eventCategory || e.category === query.eventCategory) &&
      (!query.startDate || new Date(e.eventDate) >= query.startDate) &&
      (!query.endDate || new Date(e.eventDate) < query.endDate),
  );
  const by = query.sortBy ?? 'eventDate';
  const order = query.sortOrder === 'asc' ? 1 : -1;
  entries = [...entries].sort((a, b) => (a[by] < b[by] ? -order : a[by] > b[by] ? order : 0));
  return of({
    entries: entries.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize),
    resultsCount: entries.length,
  } as AuditLogList).pipe(delay(250));
}

const withHistory = (getAuditLog: typeof serverSide = serverSide) => {
  const detail: Pick<DocumentDetailService, 'getAuditLog'> = {
    getAuditLog: logged('getAuditLog', getAuditLog) as DocumentDetailService['getAuditLog'],
  };
  const directories: Pick<DirectoryService, 'getEventTypes' | 'getEventCategories'> = {
    getEventTypes: () =>
      of([
        { id: 'documentCreated', displayLabel: 'Document created' },
        { id: 'documentModified', displayLabel: 'Document modified' },
        { id: 'documentCheckedIn', displayLabel: 'Document checked in' },
        { id: 'documentLocked', displayLabel: 'Document locked' },
        { id: 'documentUnlocked', displayLabel: 'Document unlocked' },
        { id: 'download', displayLabel: 'Download' },
      ]),
    getEventCategories: () => of([{ id: 'eventDocumentCategory', displayLabel: 'Document' }]),
  };
  const providers: Provider[] = [
    provideNativeDateAdapter(),
    { provide: DocumentDetailService, useValue: detail },
    { provide: DirectoryService, useValue: directories },
  ];
  return applicationConfig({ providers });
};

/**
 * A document's history: who did what and when, filtered and sorted on the server, a page at a
 * time — Web UI's audit search for one document.
 */
const meta: Meta<NxsDocumentHistoryComponent> = {
  title: 'Documents/Document history',
  component: NxsDocumentHistoryComponent,
  tags: ['autodocs'],
  render: (args) => ({
    props: args,
    template: `
      <div style="padding: 16px; background: var(--mat-sys-surface)">
        <nxs-document-history [documentUid]="documentUid" [pageSize]="pageSize" [headingLevel]="headingLevel" />
      </div>
    `,
  }),
  args: { documentUid: 'contract', pageSize: 5, headingLevel: 3 },
  argTypes: {
    documentUid: { control: 'text', description: 'The document whose history this is. Required.' },
    pageSize: {
      control: { type: 'select' },
      options: [5, 10, 20, 50],
      description: 'Entries per page; the user can change it.',
    },
    headingLevel: {
      control: { type: 'select' },
      options: [1, 2, 3, 4, 5, 6],
      description: 'The heading level of the empty and error states.',
    },
  },
};

export default meta;

type Story = StoryObj<NxsDocumentHistoryComponent>;

/** Eight entries, five a page, newest first. Choose an action to filter on the server. */
export const History: Story = {
  decorators: [withHistory()],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() =>
      expect(canvas.getByRole('table', { name: 'Document history' })).toBeVisible(),
    );
    await userEvent.type(canvas.getByRole('textbox', { name: 'Username' }), 'jdoe');
    await waitFor(() => expect(canvas.getAllByRole('row')).toHaveLength(5));
  },
};

/** No entry matches the filters. */
export const NoMatch: Story = {
  decorators: [
    withHistory((uid, size, index) => serverSide(uid, size, index, { eventIds: ['none'] })),
  ],
};

/** The server refuses (403): a refusal, with no Retry. */
export const Refused: Story = {
  decorators: [withHistory(() => throwError(() => new HttpErrorResponse({ status: 403 })))],
};

/** The server fails (500): an error with Retry. */
export const Failed: Story = {
  decorators: [withHistory(() => throwError(() => new HttpErrorResponse({ status: 500 })))],
};
