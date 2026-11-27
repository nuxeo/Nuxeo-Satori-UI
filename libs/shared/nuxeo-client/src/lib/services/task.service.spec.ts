import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { NUXEO_BACKGROUND_REQUEST, backgroundRequestContext } from '../background-request.context';
import { NuxeoTask } from '../models/task.model';
import { NUXEO_API_ORIGIN } from '../nuxeo-api.config';
import { TaskService } from './task.service';

const TASK_URL = '/nuxeo/api/v1/task';

/** A task created on day `day` of November 2026 and due on `due`, with a target that has a title. */
function task(id: string, day: number, due = '2026-12-01T00:00:00.000Z'): NuxeoTask {
  return {
    id,
    name: `wf.serialDocumentReview.chooseParticipants.title`,
    created: `2026-11-${String(day).padStart(2, '0')}T08:00:00.000Z`,
    dueDate: due,
    targetDocumentIds: [{ uid: `doc-${id}`, title: `Doc ${id}` }],
  } as NuxeoTask;
}

/**
 * The paging fields of a real `GET /api/v1/task?userId=…` response from Nuxeo 2025.10, measured
 * with 64 open tasks and `pageSize=50`: `resultsCount` is the whole total, not the page's.
 */
function page(entries: NuxeoTask[], resultsCount: number, offset = 0) {
  return {
    'entity-type': 'tasks',
    entries,
    resultsCount,
    pageSize: entries.length,
    maxPageSize: 1000,
    currentPageSize: entries.length,
    currentPageOffset: offset,
    isNextPageAvailable: offset + entries.length < resultsCount,
  };
}

/**
 * Nuxeo orders its task list by `nt:dueDate` ascending and ignores `sortBy`, so these responses
 * are in due-date order, which is not creation order: what the service returns must not depend
 * on the order they arrive in.
 */
describe('TaskService.getUserTasks — the newest open tasks', () => {
  let service: TaskService;
  let http: HttpTestingController;
  let result: NuxeoTask[] | undefined;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: NUXEO_API_ORIGIN, useValue: '' },
      ],
    });
    service = TestBed.inject(TaskService);
    http = TestBed.inject(HttpTestingController);
    result = undefined;
  });

  afterEach(() => http.verify());

  const ids = () => result?.map((t) => t.id);

  it('reads one page while the tasks fit, and returns them newest first', () => {
    service.getUserTasks('jsmith', 50).subscribe((tasks) => (result = tasks));

    const list = http.expectOne((r) => r.url === TASK_URL);
    expect(list.request.params.get('userId')).toBe('jsmith');
    expect(list.request.params.get('pageSize')).toBe('50');
    expect(list.request.params.has('offset')).toBe(false);
    // Due soonest first, as Nuxeo sends them: the newest is due last.
    list.flush(page([task('b', 2), task('c', 3), task('a', 1), task('d', 4)], 4));

    expect(ids()).toEqual(['d', 'c', 'b', 'a']);
  });

  it('reads the rest after the first page when Nuxeo has more, and keeps the newest of all', () => {
    service.getUserTasks('jsmith', 3).subscribe((tasks) => (result = tasks));

    http
      .expectOne((r) => r.url === TASK_URL && !r.params.has('offset'))
      .flush(page([task('old-1', 1), task('mid', 5), task('old-2', 2)], 5));

    const rest = http.expectOne((r) => r.url === TASK_URL && r.params.has('offset'));
    expect(rest.request.params.get('offset')).toBe('3');
    expect(rest.request.params.get('pageSize')).toBe('2');
    expect(rest.request.params.get('userId')).toBe('jsmith');
    expect(rest.request.headers.get('X-NXfetch.task')).toBe('targetDocumentIds,actors');
    // The two newest are due latest, so they are on no first page of any size below 5.
    rest.flush(page([task('newest', 9), task('newer', 8)], 5, 3));

    expect(ids()).toEqual(['newest', 'newer', 'mid']);
  });

  it('reads at most 1000 more after the first page', () => {
    service.getUserTasks('jsmith', 10).subscribe();

    const firstPage = Array.from({ length: 10 }, (_, i) => task(`t${i}`, 1));
    http
      .expectOne((r) => r.url === TASK_URL && !r.params.has('offset'))
      .flush(page(firstPage, 5000));

    const rest = http.expectOne((r) => r.url === TASK_URL && r.params.has('offset'));
    expect(rest.request.params.get('offset')).toBe('10');
    expect(rest.request.params.get('pageSize')).toBe('1000');
    rest.flush(page([], 5000, 10));
  });

  it('reads the rest, at most 1000, when Nuxeo says there is more but not how many', () => {
    service.getUserTasks('jsmith', 2).subscribe();

    const noCount: Record<string, unknown> = { ...page([task('a', 1), task('b', 2)], 3) };
    delete noCount['resultsCount'];
    http.expectOne((r) => r.url === TASK_URL && !r.params.has('offset')).flush(noCount);

    const rest = http.expectOne((r) => r.url === TASK_URL && r.params.has('offset'));
    expect(rest.request.params.get('pageSize')).toBe('1000');
    rest.flush(page([task('c', 3)], 3, 2));
  });

  it('keeps once a task that arrives in both reads', () => {
    service.getUserTasks('jsmith', 2).subscribe((tasks) => (result = tasks));

    http
      .expectOne((r) => r.url === TASK_URL && !r.params.has('offset'))
      .flush(page([task('a', 1), task('b', 7)], 3));
    // A task was created between the reads with an earlier due date, so `b` moved to the third
    // place and is read again.
    http
      .expectOne((r) => r.url === TASK_URL && r.params.has('offset'))
      .flush(page([task('b', 7)], 4, 2));

    expect(ids()).toEqual(['b', 'a']);
  });

  it('reads a title only for the tasks it keeps', () => {
    service.getUserTasks('jsmith', 1).subscribe((tasks) => (result = tasks));

    const untitled = (t: NuxeoTask): NuxeoTask => ({
      ...t,
      targetDocumentIds: [{ id: `doc-${t.id}` }],
    });
    http
      .expectOne((r) => r.url === TASK_URL && !r.params.has('offset'))
      .flush(page([untitled(task('older', 1))], 2));
    http
      .expectOne((r) => r.url === TASK_URL && r.params.has('offset'))
      .flush(page([untitled(task('newer', 2))], 2, 1));

    http.expectNone('/nuxeo/api/v1/id/doc-older');
    http.expectOne('/nuxeo/api/v1/id/doc-newer').flush({ uid: 'doc-newer', title: 'Claim 42' });

    expect(result?.map((t) => [t.id, t.targetDocTitle])).toEqual([['newer', 'Claim 42']]);
  });

  it('passes the context to the second read as well', () => {
    service.getUserTasks('jsmith', 1, backgroundRequestContext()).subscribe();

    const first = http.expectOne((r) => r.url === TASK_URL && !r.params.has('offset'));
    expect(first.request.context.get(NUXEO_BACKGROUND_REQUEST)).toBe(true);
    first.flush(page([task('a', 1)], 2));

    const rest = http.expectOne((r) => r.url === TASK_URL && r.params.has('offset'));
    expect(rest.request.context.get(NUXEO_BACKGROUND_REQUEST)).toBe(true);
    rest.flush(page([task('b', 2)], 2, 1));
  });

  it('fails when the second read fails, rather than passing off the soonest due as the newest', () => {
    let failed = false;
    service.getUserTasks('jsmith', 1).subscribe({ error: () => (failed = true) });

    http
      .expectOne((r) => r.url === TASK_URL && !r.params.has('offset'))
      .flush(page([task('a', 1)], 2));
    http
      .expectOne((r) => r.url === TASK_URL && r.params.has('offset'))
      .flush('boom', { status: 500, statusText: 'Server Error' });

    expect(failed).toBe(true);
  });

  it('sorts a task whose date it cannot read last', () => {
    service.getUserTasks('jsmith', 50).subscribe((tasks) => (result = tasks));

    http
      .expectOne((r) => r.url === TASK_URL)
      .flush(page([{ ...task('undated', 1), created: '' }, task('a', 1), task('b', 2)], 3));

    expect(ids()).toEqual(['b', 'a', 'undated']);
  });

  it('keeps every task for a page size of 0, which Nuxeo answers with all of them', () => {
    service.getUserTasks('jsmith', 0).subscribe((tasks) => (result = tasks));

    const all = http.expectOne((r) => r.url === TASK_URL);
    expect(all.request.params.get('pageSize')).toBe('0');
    all.flush(page([task('a', 1), task('c', 3), task('b', 2)], 3));

    expect(ids()).toEqual(['c', 'b', 'a']);
  });

  describe('of one workflow model', () => {
    const of = (id: string, day: number, workflowModelName: string): NuxeoTask => ({
      ...task(id, day),
      workflowModelName,
    });

    it('asks Nuxeo for its tasks alone, and keeps the newest of the unpaged list it answers', () => {
      service
        .getUserTasks('jsmith', 2, undefined, 'SerialDocumentReview')
        .subscribe((tasks) => (result = tasks));

      const list = http.expectOne((r) => r.url === TASK_URL);
      expect(list.request.params.get('userId')).toBe('jsmith');
      expect(list.request.params.get('workflowModelName')).toBe('SerialDocumentReview');
      // As measured on Nuxeo 2025.10: with `workflowModelName` the list is every such task, with no
      // paging fields at all, whatever the page size.
      list.flush({
        'entity-type': 'tasks',
        entries: [
          of('a', 1, 'SerialDocumentReview'),
          of('c', 3, 'SerialDocumentReview'),
          of('b', 2, 'SerialDocumentReview'),
        ],
      });

      expect(ids()).toEqual(['c', 'b']);
    });

    it("leaves out another workflow's task, whatever the server sends", () => {
      service
        .getUserTasks('jsmith', 5, undefined, 'SerialDocumentReview')
        .subscribe((tasks) => (result = tasks));

      // A server that ignored the filter would send them all.
      http
        .expectOne((r) => r.url === TASK_URL)
        .flush(
          page(
            [of('serial', 1, 'SerialDocumentReview'), of('parallel', 2, 'ParallelDocumentReview')],
            2,
          ),
        );

      expect(ids()).toEqual(['serial']);
    });

    it('asks for every workflow when it names none, as before', () => {
      service.getUserTasks('jsmith', 5).subscribe((tasks) => (result = tasks));

      const list = http.expectOne((r) => r.url === TASK_URL);
      expect(list.request.params.has('workflowModelName')).toBe(false);
      list.flush(page([of('serial', 1, 'SerialDocumentReview'), of('parallel', 2, 'Parallel')], 2));

      expect(ids()).toEqual(['parallel', 'serial']);
    });
  });
});
