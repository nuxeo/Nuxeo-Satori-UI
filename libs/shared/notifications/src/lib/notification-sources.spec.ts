import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  type AuditEntry,
  NUXEO_API_ORIGIN,
  NUXEO_BACKGROUND_REQUEST,
} from '@nuxeo/satori-platform/nuxeo-client';
import { firstValueFrom } from 'rxjs';

import { NotificationSources, timestampLiteral } from './notification-sources';

const A = '8caaa911-2838-45ca-a6f7-87ce8dd95f66';
const B = '081a33bc-485a-4c7b-ac49-4f70a63fff87';

function entry(
  id: number,
  uid: string,
  eventDate: string,
  over: Partial<AuditEntry> = {},
): AuditEntry {
  return {
    id,
    category: 'eventDocumentCategory',
    principalName: 'jsmith',
    comment: '',
    docLifeCycle: 'project',
    docPath: `/default-domain/workspaces/${uid}`,
    docType: 'File',
    docUUID: uid,
    eventId: 'documentModified',
    repositoryId: 'default',
    eventDate,
    logDate: eventDate,
    extended: {},
    ...over,
  };
}

describe('NotificationSources', () => {
  let sources: NotificationSources;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: NUXEO_API_ORIGIN, useValue: '' },
      ],
    });
    sources = TestBed.inject(NotificationSources);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('tasks', () => {
    it('reads the open tasks as the app does, marked background, newest first', async () => {
      const read = firstValueFrom(sources.tasks('jsmith'));
      const req = http.expectOne((r) => r.url === '/nuxeo/api/v1/task');
      expect(req.request.params.get('userId')).toBe('jsmith');
      // Nuxeo answers oldest first and ignores sortBy, so more are read and sorted here.
      expect(req.request.params.get('pageSize')).toBe('100');
      expect(req.request.headers.get('X-NXfetch.task')).toBe('targetDocumentIds,actors');
      expect(req.request.context.get(NUXEO_BACKGROUND_REQUEST)).toBe(true);
      req.flush({
        entries: [
          {
            id: 't-old',
            name: 'wf.serialDocumentReview.DocumentValidation',
            directive: '',
            created: '2026-11-03T08:19:19.039Z',
            targetDocumentIds: [{ uid: A, title: 'Claim 42' }],
          },
          {
            id: 't-new',
            name: 'wf.parallelDocumentReview.chooseParticipants.title',
            directive: 'wf.parallelDocumentReview.chooseParticipants.title',
            created: '2026-11-20T08:00:00.000Z',
            targetDocumentIds: [],
          },
        ],
      });

      expect(await read).toEqual([
        {
          kind: 'task',
          key: 'task:t-new',
          taskId: 't-new',
          at: '2026-11-20T08:00:00.000Z',
          title: 'Choose Participants',
          record: null,
        },
        {
          kind: 'task',
          key: 'task:t-old',
          taskId: 't-old',
          at: '2026-11-03T08:19:19.039Z',
          title: 'Document Validation',
          record: 'Claim 42',
        },
      ]);
    });

    it('keeps the newest twenty of what it read', async () => {
      const read = firstValueFrom(sources.tasks('jsmith'));
      http
        .expectOne((r) => r.url === '/nuxeo/api/v1/task')
        .flush({
          // Oldest first, as Nuxeo answers.
          entries: Array.from({ length: 30 }, (_, i) => ({
            id: `t${i}`,
            name: 'Review',
            created: new Date(Date.UTC(2026, 10, 1 + i)).toISOString(),
            targetDocumentIds: [{ uid: A, title: 'Claim 42' }],
          })),
        });
      const tasks = await read;
      expect(tasks).toHaveLength(20);
      expect(tasks[0]?.taskId).toBe('t29');
      expect(tasks[19]?.taskId).toBe('t10');
    });

    it('marks the read of a target it fetches for its title as background too', async () => {
      const read = firstValueFrom(sources.tasks('jsmith'));
      http
        .expectOne((r) => r.url === '/nuxeo/api/v1/task')
        .flush({
          entries: [
            {
              id: 't1',
              name: 'Review',
              created: '2026-11-20T08:00:00.000Z',
              targetDocumentIds: [{ id: A }],
            },
          ],
        });
      const doc = http.expectOne(`/nuxeo/api/v1/id/${A}`);
      expect(doc.request.context.get(NUXEO_BACKGROUND_REQUEST)).toBe(true);
      doc.flush({ uid: A, title: 'Claim 42' });
      expect((await read)[0]?.record).toBe('Claim 42');
    });
  });

  describe('followed', () => {
    it('asks the repository for the records the user subscribed to, values as parameters', async () => {
      const since = new Date('2026-11-16T12:00:00.000Z');
      const read = firstValueFrom(sources.followed("o'brien", since, 2));
      const req = http.expectOne('/nuxeo/api/v1/automation/Repository.Query');
      expect(req.request.method).toBe('POST');
      expect(req.request.context.get(NUXEO_BACKGROUND_REQUEST)).toBe(true);
      expect(req.request.headers.get('properties')).toBe('dublincore');
      const params = req.request.body.params;
      expect(params.query).toBe(
        'SELECT * FROM Document WHERE notif:notifications/*/subscribers/* = ? ' +
          'AND ecm:isTrashed = 0 AND ecm:isVersion = 0 AND ecm:isProxy = 0 ' +
          "AND dc:modified > TIMESTAMP '2026-11-16T12:00:00.000Z'",
      );
      // The user never reaches the query's text, so a quote in a user id cannot change it.
      expect(params.query).not.toContain('brien');
      expect(params.queryParams).toEqual(["user:o'brien"]);
      expect(params.pageSize).toBe(20);
      expect(params.currentPageIndex).toBe(2);
      expect([params.sortBy, params.sortOrder]).toEqual(['dc:modified', 'DESC']);
      req.flush({
        entries: [
          { uid: A, title: 'Claim 42', properties: { 'dc:modified': '2026-11-23T17:59:27.138Z' } },
          { uid: B, title: '', lastModified: '2026-11-22T10:00:00.000Z', properties: {} },
          { uid: '', title: 'No uid', properties: { 'dc:modified': '2026-11-22T10:00:00.000Z' } },
        ],
        isNextPageAvailable: true,
      });
      expect(await read).toEqual({
        records: [
          { uid: A, title: 'Claim 42', modified: '2026-11-23T17:59:27.138Z' },
          { uid: B, title: B, modified: '2026-11-22T10:00:00.000Z' },
        ],
        more: true,
      });
    });
  });

  describe('timestampLiteral', () => {
    it('writes an instant as an NXQL TIMESTAMP literal', () => {
      expect(timestampLiteral(new Date('2026-11-16T12:00:00.000Z'))).toBe(
        "TIMESTAMP '2026-11-16T12:00:00.000Z'",
      );
    });

    it('refuses what does not write as a plain instant, so nothing else reaches a query', () => {
      expect(() => timestampLiteral(new Date(Number.NaN))).toThrow();
      // Past the year 9999 `toISOString()` writes `+010000-…`, which the check refuses.
      expect(() => timestampLiteral(new Date('+010000-01-01T00:00:00.000Z'))).toThrow(
        'Not an instant',
      );
    });
  });

  describe('changes', () => {
    const since = new Date('2026-11-23T17:00:00.000Z');

    it('asks nothing when no record changed', async () => {
      expect(await firstValueFrom(sources.changes([], true))).toEqual({
        entries: [],
        read: new Set(),
        refused: false,
      });
    });

    it("reads an administrator's records in one audit query, every value a parameter", async () => {
      const later = new Date('2026-11-23T17:50:00.000Z');
      const read = firstValueFrom(
        sources.changes(
          [
            { uid: A, since },
            { uid: B, since: later },
          ],
          true,
        ),
      );
      const req = http.expectOne('/nuxeo/api/v1/automation/Audit.QueryWithPageProvider');
      expect(req.request.context.get(NUXEO_BACKGROUND_REQUEST)).toBe(true);
      const params = req.request.body.params;
      expect(params.query).toBe(
        'SELECT * FROM LogEntry WHERE docUUID IN (?, ?) AND eventId IN (?, ?) ' +
          "AND eventDate >= TIMESTAMP '2026-11-23T17:00:00.000Z'",
      );
      // The reader's own entries are read too: they say whether the audit caught up with a change.
      expect(params.queryParams).toEqual([A, B, 'documentModified', 'lifecycle_transition_event']);
      expect(params.currentPageIndex).toBe(0);
      expect([params.sortBy, params.sortOrder]).toEqual(['eventDate', 'DESC']);
      req.flush({
        entries: [
          entry(3, B, '2026-11-23T17:55:00.000Z'),
          // Before B's own lower bound: the one query read from A's, the earlier, and B drops it.
          entry(2, B, '2026-11-23T17:10:00.000Z'),
          entry(1, A, '2026-11-23T17:10:00.000Z'),
        ],
      });
      const result = await read;
      expect(result.entries.map((e) => e.id)).toEqual([3, 1]);
      expect(result.read).toEqual(new Set([A, B]));
      expect(result.refused).toBe(false);
    });

    for (const status of [404, 403]) {
      it(`reads record by record when the audit query answers ${status}, and says it was refused`, async () => {
        const read = firstValueFrom(sources.changes([{ uid: A, since }], true));
        http
          .expectOne('/nuxeo/api/v1/automation/Audit.QueryWithPageProvider')
          .flush({}, { status, statusText: 'Refused' });
        const one = http.expectOne((r) => r.url === `/nuxeo/api/v1/id/${A}/@audit`);
        one.flush({ entries: [entry(7, A, '2026-11-23T17:30:00.000Z')] });
        const result = await read;
        expect(result.refused).toBe(true);
        expect(result.entries.map((e) => e.id)).toEqual([7]);
      });
    }

    it('fails when the audit query fails otherwise, rather than hiding the error', async () => {
      const read = firstValueFrom(sources.changes([{ uid: A, since }], true));
      http
        .expectOne('/nuxeo/api/v1/automation/Audit.QueryWithPageProvider')
        .flush({}, { status: 500, statusText: 'Server Error' });
      await expect(read).rejects.toMatchObject({ status: 500 });
    });

    it('reads each record with @audit for anyone else, from its own lower bound, marked background', async () => {
      const read = firstValueFrom(
        sources.changes(
          [
            { uid: A, since },
            { uid: B, since: new Date('2026-11-20T00:00:00.000Z') },
          ],
          false,
        ),
      );
      const reqs = http.match((r) => r.url.endsWith('/@audit'));
      expect(reqs.map((r) => r.request.url)).toEqual([
        `/nuxeo/api/v1/id/${A}/@audit`,
        `/nuxeo/api/v1/id/${B}/@audit`,
      ]);
      for (const req of reqs) {
        expect(req.request.context.get(NUXEO_BACKGROUND_REQUEST)).toBe(true);
        expect(req.request.params.getAll('eventId')).toEqual([
          'documentModified',
          'lifecycle_transition_event',
        ]);
        expect(req.request.params.get('sortBy')).toBe('eventDate');
        expect(req.request.params.get('sortOrder')).toBe('desc');
      }
      expect(reqs[0]?.request.params.get('startEventDate')).toBe('2026-11-23T17:00:00.000Z');
      expect(reqs[1]?.request.params.get('startEventDate')).toBe('2026-11-20T00:00:00.000Z');
      reqs[0]?.flush({ entries: [entry(1, A, '2026-11-23T17:10:00.000Z')] });
      reqs[1]?.flush({ entries: [entry(2, B, '2026-11-21T00:00:00.000Z')] });
      const result = await read;
      expect(result.entries.map((e) => e.id).sort()).toEqual([1, 2]);
      expect(result.read).toEqual(new Set([A, B]));
      expect(http.match((r) => r.url.includes('Audit.Query'))).toEqual([]);
    });

    it('leaves a record whose read failed out of what was read, and keeps the others', async () => {
      const read = firstValueFrom(
        sources.changes(
          [
            { uid: A, since },
            { uid: B, since },
          ],
          false,
        ),
      );
      const [a, b] = http.match((r) => r.url.endsWith('/@audit'));
      a?.flush({}, { status: 403, statusText: 'Forbidden' });
      b?.flush({ entries: [entry(2, B, '2026-11-23T17:10:00.000Z')] });
      const result = await read;
      expect(result.read).toEqual(new Set([B]));
      expect(result.entries.map((e) => e.id)).toEqual([2]);
    });

    it('fails when every read failed', async () => {
      const read = firstValueFrom(sources.changes([{ uid: A, since }], false));
      http
        .expectOne((r) => r.url.endsWith('/@audit'))
        .flush({}, { status: 503, statusText: 'Unavailable' });
      await expect(read).rejects.toMatchObject({ status: 503 });
    });

    it('reads at most four records at a time', () => {
      const uids = Array.from({ length: 6 }, (_, i) => `00000000-0000-0000-0000-00000000000${i}`);
      const sub = sources
        .changes(
          uids.map((uid) => ({ uid, since })),
          false,
        )
        .subscribe();
      const first = http.match((r) => r.url.endsWith('/@audit'));
      expect(first).toHaveLength(4);
      first[0]?.flush({ entries: [] });
      expect(http.match((r) => r.url.endsWith('/@audit'))).toHaveLength(1);
      sub.unsubscribe();
    });

    it('reads the next page of the audit query while there is one, up to four pages', async () => {
      const read = firstValueFrom(sources.changes([{ uid: A, since }], true));
      for (let page = 0; page < 4; page++) {
        const req = http.expectOne('/nuxeo/api/v1/automation/Audit.QueryWithPageProvider');
        expect(req.request.body.params.currentPageIndex).toBe(page);
        req.flush({
          entries: [entry(100 - page, A, '2026-11-23T17:30:00.000Z')],
          isNextPageAvailable: true,
        });
      }
      // A fifth page exists, and is not read.
      http.expectNone('/nuxeo/api/v1/automation/Audit.QueryWithPageProvider');
      expect((await read).entries.map((e) => e.id)).toEqual([100, 99, 98, 97]);
    });

    it("reads the next page of a record's @audit while there is one", async () => {
      const read = firstValueFrom(sources.changes([{ uid: A, since }], false));
      const first = http.expectOne((r) => r.url.endsWith('/@audit'));
      expect(first.request.params.get('currentPageIndex')).toBe('0');
      first.flush({
        entries: [entry(2, A, '2026-11-23T17:40:00.000Z')],
        isNextPageAvailable: true,
      });
      const second = http.expectOne((r) => r.url.endsWith('/@audit'));
      expect(second.request.params.get('currentPageIndex')).toBe('1');
      second.flush({
        entries: [entry(1, A, '2026-11-23T17:20:00.000Z')],
        isNextPageAvailable: false,
      });
      expect((await read).entries.map((e) => e.id)).toEqual([2, 1]);
    });
  });
});
