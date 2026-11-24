/**
 * The dashboard's tasks widget, over the real `TaskService`, for a user with more open tasks than
 * its 10. Nuxeo answers its task list by `nt:dueDate` ascending and ignores `sortBy`, and here the
 * tasks due soonest are the oldest, so a widget that showed Nuxeo's first page would list none of
 * the newest.
 */
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import {
  CollectionService,
  DocumentDetailService,
  DocumentService,
  type NuxeoTask,
} from '@nuxeo/satori-platform/nuxeo-client';
import { AiFeatureFlagService, AiGatewayService } from '@agentic-ui/shared/ai-client';

import { AuthService } from '../auth/auth.service';
import { testTranslateModule } from '../i18n/translate-testing';
import { DashboardPageComponent } from './dashboard-page.component';

globalThis.ResizeObserver ??= class implements ResizeObserver {
  observe(): void {
    /* no-op */
  }
  unobserve(): void {
    /* no-op */
  }
  disconnect(): void {
    /* no-op */
  }
};

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

describe('DashboardPageComponent tasks widget with more open tasks than fit', () => {
  let fixture: ComponentFixture<DashboardPageComponent>;

  beforeEach(async () => {
    const docService = jasmine.createSpyObj('DocumentService', [
      'getRecentlyEdited',
      'getRecentlyViewed',
    ]);
    docService.getRecentlyEdited.and.returnValue(of({ entries: [], totalSize: 0 }));
    docService.getRecentlyViewed.and.returnValue(of({ entries: [], totalSize: 0 }));

    const collectionService = jasmine.createSpyObj('CollectionService', ['getFavorites']);
    collectionService.getFavorites.and.returnValue(of({ entries: [], totalSize: 0 }));

    const detailService = jasmine.createSpyObj('DocumentDetailService', ['fetchThumbnail']);
    detailService.fetchThumbnail.and.returnValue(of(null));

    const aiGateway = jasmine.createSpyObj('AiGatewayService', ['getInsights']);
    aiGateway.getInsights.and.returnValue(of({ insights: [] }));

    await TestBed.configureTestingModule({
      imports: [testTranslateModule(), DashboardPageComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MatDialog, useValue: jasmine.createSpyObj('MatDialog', ['open']) },
        { provide: DocumentService, useValue: docService },
        { provide: CollectionService, useValue: collectionService },
        { provide: DocumentDetailService, useValue: detailService },
        { provide: AiGatewayService, useValue: aiGateway },
        { provide: AiFeatureFlagService, useValue: { aiEnabled: signal(false) } },
        { provide: AuthService, useValue: { username: signal('jsmith') } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardPageComponent);
  });

  it('lists the newest 10, newest first', async () => {
    fixture.detectChanges();

    answerTaskListReads(TestBed.inject(HttpTestingController), openTasks(25));
    await fixture.whenStable();
    fixture.detectChanges();

    const titles = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.task-card .task-doc-title'),
      (title) => title.textContent?.trim(),
    );
    expect(titles).toEqual(Array.from({ length: 10 }, (_, i) => `Doc ${24 - i}`));
  });
});
