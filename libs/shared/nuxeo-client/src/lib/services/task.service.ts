import { HttpContext, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, Subject, catchError, forkJoin, map, of, switchMap } from 'rxjs';

import { NuxeoTask, NuxeoTaskList } from '../models/task.model';
import { NuxeoDocument } from '../models/document.model';
import { NuxeoApiBase } from './nuxeo-api-base';

/**
 * At most this many more open tasks are read, after the first page, to find a user's newest.
 * It is the most one page of Nuxeo's task list holds: the endpoint reports `maxPageSize: 1000`.
 */
const USER_TASK_SCAN_LIMIT = 1000;

/** Newest `created` first; an unreadable date sorts last, and the id breaks a tie. */
function newestFirst(a: NuxeoTask, b: NuxeoTask): number {
  const at = (task: NuxeoTask) => {
    const time = Date.parse(task.created);
    return Number.isNaN(time) ? -Infinity : time;
  };
  return at(b) - at(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

@Injectable({ providedIn: 'root' })
export class TaskService {
  private readonly api = inject(NuxeoApiBase);

  /** Emits whenever tasks are mutated (completed, delegated, reassigned, abandoned). */
  readonly tasksChanged$ = new Subject<void>();

  /** Notify all subscribers that the task list has changed. */
  notifyTasksChanged(): void {
    this.tasksChanged$.next();
  }

  /** Fetch headers to resolve task targets and actors. */
  private readonly taskFetchHeaders: Record<string, string> = {
    'X-NXfetch.task': 'targetDocumentIds,actors',
  };

  /**
   * The user's newest open tasks, at most `pageSize`, newest `created` first, with each target's
   * title.
   *
   * Nuxeo cannot be asked for them. Its task list (`RoutingTaskPageProvider`, Nuxeo 2025.10) is
   * ordered `nt:dueDate` ascending in the query it builds, and ignores `sortBy` and `sortOrder`, so
   * its first page holds the tasks due soonest and its last page those due latest, neither the
   * newest. The first page is read, and when Nuxeo has more (`isNextPageAvailable`) the rest is
   * read after it with `offset`, up to {@link USER_TASK_SCAN_LIMIT} more: one request while the
   * tasks fit, two when they do not. Titles are read only for the tasks kept.
   *
   * A user with more than `pageSize` + {@link USER_TASK_SCAN_LIMIT} open tasks gets the newest of the
   * ones due soonest, so a newer task due later than all of those is not among them.
   *
   * @param pageSize how many to return, and the size of the first read
   * @param context passed to every request this makes, the task list and any target it reads for
   *   a title: `backgroundRequestContext()` for a read the application sends on its own
   * @param workflowModelName only the tasks of this workflow model, such as
   *   `SerialDocumentReview`. Nuxeo's task list takes it as `workflowModelName`, and then returns
   *   every such task of the user in one unpaged list (Nuxeo 2025.10): they are sorted newest
   *   first here as any others, and a task of another workflow is left out here too, whatever the
   *   server returns.
   */
  getUserTasks(
    userId: string,
    pageSize = 10,
    context?: HttpContext,
    workflowModelName?: string,
  ): Observable<NuxeoTask[]> {
    const readPage = (size: number, offset: number) =>
      this.readUserTasks(userId, size, offset, context, workflowModelName);
    return readPage(pageSize, 0).pipe(
      switchMap((first) => {
        const read = first.entries.length;
        const remaining = Math.min(
          first.resultsCount !== undefined ? first.resultsCount - read : USER_TASK_SCAN_LIMIT,
          USER_TASK_SCAN_LIMIT,
        );
        if (first.isNextPageAvailable !== true || read === 0 || remaining <= 0) {
          return of(first.entries);
        }
        return readPage(remaining, read).pipe(map((rest) => [...first.entries, ...rest.entries]));
      }),
      map((tasks) => {
        // A task created or ended between the two reads shifts the second by one, so the same task
        // can arrive in both.
        const byId = new Map(
          tasks
            .filter(
              (task) =>
                workflowModelName === undefined || task.workflowModelName === workflowModelName,
            )
            .map((task) => [task.id, task]),
        );
        // `pageSize` 0 is Nuxeo's "every task": one read returns them all, and all are kept.
        return [...byId.values()].sort(newestFirst).slice(0, pageSize > 0 ? pageSize : undefined);
      }),
      switchMap((tasks) => this.withTargetTitles(tasks, context)),
    );
  }

  /** One read of the user's open tasks, in Nuxeo's order: `nt:dueDate` ascending. */
  private readUserTasks(
    userId: string,
    pageSize: number,
    offset: number,
    context?: HttpContext,
    workflowModelName?: string,
  ): Observable<NuxeoTaskList> {
    let params = new HttpParams().set('userId', userId).set('pageSize', pageSize);
    if (offset > 0) params = params.set('offset', offset);
    if (workflowModelName !== undefined)
      params = params.set('workflowModelName', workflowModelName);
    return this.api.get<NuxeoTaskList>(
      '/nuxeo/api/v1/task',
      params,
      this.taskFetchHeaders,
      context,
    );
  }

  /** Each task with its first target's title, read when the response did not carry it. */
  private withTargetTitles(tasks: NuxeoTask[], context?: HttpContext): Observable<NuxeoTask[]> {
    if (tasks.length === 0) return of([] as NuxeoTask[]);

    const enriched$ = tasks.map((task) => {
      const targetRef = task.targetDocumentIds?.[0];
      // Enriched response has uid+title, plain response has id
      if (targetRef?.title) {
        return of({ ...task, targetDocTitle: targetRef.title });
      }
      const docId = targetRef?.uid || targetRef?.id;
      if (!docId) return of(task);

      return this.api
        .get<NuxeoDocument>(`/nuxeo/api/v1/id/${docId}`, undefined, undefined, context)
        .pipe(
          map((doc) => ({ ...task, targetDocTitle: doc.title })),
          catchError(() => of(task)),
        );
    });

    return forkJoin(enriched$);
  }

  /** Get a specific task by ID (with enriched targets & actors). */
  getTask(taskId: string): Observable<NuxeoTask> {
    return this.api.get<NuxeoTask>(
      `/nuxeo/api/v1/task/${taskId}`,
      undefined,
      this.taskFetchHeaders,
    );
  }

  /** Get tasks for a document. */
  getDocumentTasks(docId: string, userId?: string): Observable<NuxeoTask[]> {
    let params = new HttpParams();
    if (userId) params = params.set('userId', userId);
    return this.api
      .get<NuxeoTaskList>(`/nuxeo/api/v1/id/${docId}/@task`, params, this.taskFetchHeaders)
      .pipe(map((res) => res.entries));
  }

  /**
   * Complete a task by executing an action (e.g., start_review, approve, reject, validate).
   * Variables are task-specific (comment, participants, end_date, etc.).
   */
  completeTask(
    taskId: string,
    action: string,
    variables: Record<string, unknown> = {},
    comment?: string,
  ): Observable<NuxeoTask> {
    const body: Record<string, unknown> = {
      'entity-type': 'task',
      id: taskId,
      variables,
    };
    if (comment !== undefined) {
      body['comment'] = comment;
    }
    return this.api.put<NuxeoTask>(`/nuxeo/api/v1/task/${taskId}/${action}`, body);
  }

  /** Reassign a task to other actors (replaces current actors). */
  reassignTask(taskId: string, actors: string[], comment?: string): Observable<void> {
    const body: Record<string, unknown> = {
      'entity-type': 'task',
      id: taskId,
      actors,
    };
    if (comment) body['comment'] = comment;
    return this.api.put<void>(`/nuxeo/api/v1/task/${taskId}/reassign`, body);
  }

  /** Delegate a task to additional actors (keeps original actors). */
  delegateTask(taskId: string, delegatedActors: string[], comment?: string): Observable<void> {
    const body: Record<string, unknown> = {
      'entity-type': 'task',
      id: taskId,
      delegatedActors,
    };
    if (comment) body['comment'] = comment;
    return this.api.put<void>(`/nuxeo/api/v1/task/${taskId}/delegate`, body);
  }
}
