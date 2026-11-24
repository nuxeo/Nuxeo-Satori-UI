/**
 * The drawer's tasks panel, over the real `TaskService`, for a user with more open tasks than its
 * page of 50. Nuxeo answers its task list by `nt:dueDate` ascending and ignores `sortBy`, and here
 * the tasks due soonest are the oldest, so a panel that showed Nuxeo's first page would list none
 * of the newest 14.
 */
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { CURRENT_USERNAME, type NuxeoTask } from '@nuxeo/satori-platform/nuxeo-client';

import { testTranslateModule } from '../../i18n/translate-testing';
import type { AppNavItem } from '../../platform-nav-items';
import { NavDrawerComponent } from './nav-drawer.component';

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

describe('NavDrawer tasks panel with more open tasks than fit', () => {
  let fixture: ComponentFixture<NavDrawerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NavDrawerComponent, testTranslateModule()],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: CURRENT_USERNAME, useValue: signal('jsmith') },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(NavDrawerComponent);
  });

  it('lists the newest 50, newest first', async () => {
    fixture.componentRef.setInput('activeItem', {
      id: 'app.navbar.tasks',
      label: 'Tasks',
    } as AppNavItem);
    fixture.detectChanges();

    answerTaskListReads(TestBed.inject(HttpTestingController), openTasks(64));
    await fixture.whenStable();
    fixture.detectChanges();

    const docLines = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.task-item .task-doc-line'),
      (line) => line.textContent?.trim(),
    );
    expect(docLines.length).withContext('rows in the panel').toBe(50);
    expect(docLines.slice(0, 3)).toEqual(['Doc 63', 'Doc 62', 'Doc 61']);
    expect(docLines[49]).toBe('Doc 14');
  });
});
