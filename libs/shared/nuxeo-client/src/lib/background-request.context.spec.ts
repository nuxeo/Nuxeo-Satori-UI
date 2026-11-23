import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { NUXEO_BACKGROUND_REQUEST, backgroundRequestContext } from './background-request.context';
import { NUXEO_API_ORIGIN } from './nuxeo-api.config';
import { DocumentDetailService } from './services/document-detail.service';
import { NuxeoApiBase } from './services/nuxeo-api-base';
import { TaskService } from './services/task.service';

/**
 * The idle timer counts every successful Nuxeo response as activity unless the request carries
 * `NUXEO_BACKGROUND_REQUEST`. These are the reads the notification bell sends on a timer, so each
 * must pass the context it is given to every request it makes, and send none when given none.
 */
describe('backgroundRequestContext', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: NUXEO_API_ORIGIN, useValue: '' },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('carries the token, which is false on any other request', () => {
    expect(backgroundRequestContext().get(NUXEO_BACKGROUND_REQUEST)).toBe(true);
    TestBed.inject(NuxeoApiBase).get('/nuxeo/api/v1/me').subscribe();
    expect(http.expectOne('/nuxeo/api/v1/me').request.context.get(NUXEO_BACKGROUND_REQUEST)).toBe(
      false,
    );
  });

  it('reaches the request through NuxeoApiBase.get and .post', () => {
    const api = TestBed.inject(NuxeoApiBase);
    api.get('/nuxeo/api/v1/a', undefined, undefined, backgroundRequestContext()).subscribe();
    api.post('/nuxeo/api/v1/b', {}, undefined, backgroundRequestContext()).subscribe();
    for (const url of ['/nuxeo/api/v1/a', '/nuxeo/api/v1/b']) {
      expect(http.expectOne(url).request.context.get(NUXEO_BACKGROUND_REQUEST)).toBe(true);
    }
  });

  it('reaches both of TaskService.getUserTasks’ requests: the list and a target read for its title', () => {
    TestBed.inject(TaskService).getUserTasks('jsmith', 20, backgroundRequestContext()).subscribe();
    const list = http.expectOne((r) => r.url === '/nuxeo/api/v1/task');
    expect(list.request.context.get(NUXEO_BACKGROUND_REQUEST)).toBe(true);
    list.flush({ entries: [{ id: 't1', name: 'Review', targetDocumentIds: [{ id: 'doc-1' }] }] });
    const target = http.expectOne('/nuxeo/api/v1/id/doc-1');
    expect(target.request.context.get(NUXEO_BACKGROUND_REQUEST)).toBe(true);
    target.flush({ uid: 'doc-1', title: 'Claim 42' });
  });

  it('leaves the tasks page’s own read of tasks as user activity', () => {
    TestBed.inject(TaskService).getUserTasks('jsmith', 50).subscribe();
    const list = http.expectOne((r) => r.url === '/nuxeo/api/v1/task');
    expect(list.request.context.get(NUXEO_BACKGROUND_REQUEST)).toBe(false);
    list.flush({ entries: [] });
  });

  it('reaches DocumentDetailService.getAuditLog’s request', () => {
    TestBed.inject(DocumentDetailService)
      .getAuditLog('doc-1', 10, 0, {}, backgroundRequestContext())
      .subscribe();
    const req = http.expectOne((r) => r.url === '/nuxeo/api/v1/id/doc-1/@audit');
    expect(req.request.context.get(NUXEO_BACKGROUND_REQUEST)).toBe(true);
    req.flush({ entries: [] });
  });
});
