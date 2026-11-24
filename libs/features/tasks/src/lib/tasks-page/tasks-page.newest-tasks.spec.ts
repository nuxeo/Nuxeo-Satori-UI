import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  CURRENT_USERNAME,
  DocumentService,
  NUXEO_API_ORIGIN,
  type NuxeoTask,
} from '@nuxeo/satori-platform/nuxeo-client';
import { testTranslateModule } from '@agentic-ui/testing/i18n';

import { TasksPageComponent } from './tasks-page.component';

/** jsdom has no `ResizeObserver`, which a component this template renders may construct. */
class ResizeObserverStub {
  observe(): void {
    /* no-op */
  }
  unobserve(): void {
    /* no-op */
  }
  disconnect(): void {
    /* no-op */
  }
}

const priorResizeObserver = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
beforeAll(() => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
});
afterAll(() => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = priorResizeObserver;
});

/** Open tasks, task `i` created `i` minutes after the first and due in the same order. */
function openTasks(count: number): NuxeoTask[] {
  const start = Date.parse('2026-11-01T08:00:00.000Z');
  return Array.from({ length: count }, (_, i) => ({
    id: `task-${i}`,
    name: 'wf.serialDocumentReview.chooseParticipants.title',
    directive: '',
    workflowInstanceId: `wf-${i}`,
    workflowModelName: 'SerialDocumentReview',
    workflowTitle: 'Serial document review',
    created: new Date(start + i * 60_000).toISOString(),
    dueDate: new Date(start + 86_400_000 + i * 60_000).toISOString(),
    state: 'opened',
    nodeName: 'chooseParticipants',
    targetDocumentIds: [{ uid: `doc-${i}`, title: `Doc ${i}` }],
    actors: [{ id: 'jsmith' }],
    delegatedActors: [],
    comments: [],
    variables: {},
    taskInfo: { taskActions: [] },
  }));
}

/**
 * Answers every task-list read the way Nuxeo 2025.10 does: ordered by `nt:dueDate` ascending
 * whatever the request asks, `offset` and `pageSize` slicing that order, `resultsCount` the whole
 * total. Measured with 64 open tasks and `pageSize=50`.
 */
function answerTaskListReads(http: HttpTestingController, all: NuxeoTask[]): void {
  const byDue = [...all].sort((a, b) => Date.parse(a.dueDate) - Date.parse(b.dueDate));
  const taskList = (r: { url: string }) => r.url === '/nuxeo/api/v1/task';
  for (let reads = http.match(taskList); reads.length > 0; reads = http.match(taskList)) {
    for (const read of reads) {
      const offset = Number(read.request.params.get('offset') ?? 0);
      const pageSize = Number(read.request.params.get('pageSize') ?? 0) || byDue.length;
      const entries = byDue.slice(offset, offset + pageSize);
      read.flush({
        'entity-type': 'tasks',
        entries,
        resultsCount: byDue.length,
        currentPageOffset: offset,
        isNextPageAvailable: offset + entries.length < byDue.length,
      });
    }
  }
}

/**
 * The tasks page, over the real `TaskService`, for a user with more open tasks than its page of
 * 50. Nuxeo sends the 50 due soonest first, and here those are the oldest, so a page that showed
 * Nuxeo's first page would list none of the newest 14.
 */
describe('TasksPageComponent with more open tasks than fit', () => {
  it('lists the newest 50, newest first, and opens the newest', async () => {
    const navigate = vi.fn(() => Promise.resolve(true));
    TestBed.configureTestingModule({
      imports: [testTranslateModule(), TasksPageComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: NUXEO_API_ORIGIN, useValue: '' },
        {
          provide: DocumentService,
          useValue: {
            getById: (uid: string) =>
              of({ uid, title: uid, type: 'Note', path: `/${uid}`, properties: {} }),
          },
        },
        { provide: Router, useValue: { navigate, url: '/tasks' } },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: new BehaviorSubject(convertToParamMap({})),
            snapshot: { paramMap: convertToParamMap({}) },
          },
        },
        { provide: CURRENT_USERNAME, useValue: signal('jsmith') },
      ],
    });
    const fixture = TestBed.createComponent(TasksPageComponent);
    fixture.detectChanges();

    answerTaskListReads(TestBed.inject(HttpTestingController), openTasks(64));
    await fixture.whenStable();

    const page = fixture.componentInstance;
    const expected = Array.from({ length: 50 }, (_, i) => `task-${63 - i}`);
    expect(page.tasks().map((t) => t.id)).toEqual(expected);
    expect(page.selectedTask()?.id).toBe('task-63');
    expect(navigate).toHaveBeenCalledWith(['/tasks', 'task-63'], { replaceUrl: true });
  });
});
