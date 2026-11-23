import { HttpContext, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, Subject, catchError, forkJoin, map, of, switchMap } from 'rxjs';

import { NuxeoTask, NuxeoTaskList } from '../models/task.model';
import { NuxeoDocument } from '../models/document.model';
import { NuxeoApiBase } from './nuxeo-api-base';

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
   * The user's open tasks, with each target's title.
   *
   * @param context passed to every request this makes, the task list and any target it reads for
   *   a title: `backgroundRequestContext()` for a read the application sends on its own
   */
  getUserTasks(userId: string, pageSize = 10, context?: HttpContext): Observable<NuxeoTask[]> {
    const params = new HttpParams().set('userId', userId).set('pageSize', pageSize);

    return this.api
      .get<NuxeoTaskList>('/nuxeo/api/v1/task', params, this.taskFetchHeaders, context)
      .pipe(
        map((res) => res.entries),
        switchMap((tasks) => {
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
        }),
      );
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
