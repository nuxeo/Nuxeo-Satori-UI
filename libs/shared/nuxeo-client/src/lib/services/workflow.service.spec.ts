import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import type { NuxeoWorkflow, NuxeoWorkflowModel } from '../models/workflow.model';
import { WorkflowService } from './workflow.service';

const API = '/nuxeo/api/v1';

const workflow = (id: string): NuxeoWorkflow => ({
  'entity-type': 'workflow',
  id,
  name: 'SerialDocumentReview',
  title: 'Serial document review',
  state: 'running',
  workflowModelName: 'SerialDocumentReview',
  initiator: 'jdoe',
  attachedDocumentIds: [{ id: 'doc-1' }],
  variables: {},
});

describe('WorkflowService', () => {
  let service: WorkflowService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withXhr()), provideHttpClientTesting()],
    });
    service = TestBed.inject(WorkflowService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('workflow models', () => {
    it('lists the models the server offers, unwrapped from the entity list', () => {
      let models: NuxeoWorkflowModel[] = [];
      service.getWorkflowModels().subscribe((m) => (models = m));

      const request = http.expectOne(`${API}/workflowModel`);
      expect(request.request.method).toBe('GET');
      request.flush({
        'entity-type': 'workflowModels',
        entries: [
          { 'entity-type': 'workflowModel', name: 'SerialDocumentReview', title: 'Serial' },
          { 'entity-type': 'workflowModel', name: 'ParallelDocumentReview', title: 'Parallel' },
        ],
      });

      expect(models.map((m) => m.name)).toEqual(['SerialDocumentReview', 'ParallelDocumentReview']);
    });

    it('reads one model, and its graph, by name', () => {
      service.getWorkflowModel('SerialDocumentReview').subscribe();
      service.getWorkflowModelGraph('SerialDocumentReview').subscribe();

      http.expectOne(`${API}/workflowModel/SerialDocumentReview`).flush({});
      const graph = http.expectOne(`${API}/workflowModel/SerialDocumentReview/graph`);
      expect(graph.request.method).toBe('GET');
      graph.flush({ nodes: [], transitions: [] });
    });
  });

  describe('starting a workflow', () => {
    it('posts a workflow entity naming the model, attached to the document it starts on', () => {
      let started: NuxeoWorkflow | undefined;
      service.startWorkflow('doc-1', 'SerialDocumentReview').subscribe((w) => (started = w));

      const request = http.expectOne(`${API}/id/doc-1/@workflow`);
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({
        'entity-type': 'workflow',
        workflowModelName: 'SerialDocumentReview',
        attachedDocumentIds: ['doc-1'],
      });
      request.flush(workflow('wf-1'));

      expect(started?.id).toBe('wf-1');
    });

    it('passes a refusal to the caller, such as a user without the right to start one', () => {
      let status: number | undefined;
      service
        .startWorkflow('doc-1', 'SerialDocumentReview')
        .subscribe({ error: (e) => (status = e.status) });

      http
        .expectOne(`${API}/id/doc-1/@workflow`)
        .flush('Forbidden', { status: 403, statusText: 'Forbidden' });

      expect(status).toBe(403);
    });
  });

  describe('workflow instances', () => {
    it('lists the workflows running on a document', () => {
      let running: NuxeoWorkflow[] = [];
      service.getDocumentWorkflows('doc-1').subscribe((w) => (running = w));

      const request = http.expectOne(`${API}/id/doc-1/@workflow`);
      expect(request.request.method).toBe('GET');
      request.flush({ 'entity-type': 'workflows', entries: [workflow('wf-1')] });

      expect(running.map((w) => w.id)).toEqual(['wf-1']);
    });

    it('lists the workflows the current user launched', () => {
      let mine: NuxeoWorkflow[] = [];
      service.getMyWorkflows().subscribe((w) => (mine = w));

      http
        .expectOne(`${API}/workflow`)
        .flush({ 'entity-type': 'workflows', entries: [workflow('wf-1'), workflow('wf-2')] });

      expect(mine.map((w) => w.id)).toEqual(['wf-1', 'wf-2']);
    });

    it('reads one instance and its graph by id', () => {
      let read: NuxeoWorkflow | undefined;
      service.getWorkflow('wf-1').subscribe((w) => (read = w));
      service.getWorkflowGraph('wf-1').subscribe();

      http.expectOne(`${API}/workflow/wf-1`).flush(workflow('wf-1'));
      http.expectOne(`${API}/workflow/wf-1/graph`).flush({ nodes: [] });

      expect(read?.state).toBe('running');
    });

    it('cancels an instance with a DELETE on it', () => {
      let done = false;
      service.cancelWorkflow('wf-1').subscribe({ complete: () => (done = true) });

      const request = http.expectOne(`${API}/workflow/wf-1`);
      expect(request.request.method).toBe('DELETE');
      request.flush(null, { status: 204, statusText: 'No Content' });

      expect(done).toBe(true);
    });

    it('passes a failed cancel to the caller, so the banner does not report it cancelled', () => {
      let status: number | undefined;
      service.cancelWorkflow('wf-1').subscribe({ error: (e) => (status = e.status) });

      http
        .expectOne(`${API}/workflow/wf-1`)
        .flush('gone', { status: 404, statusText: 'Not Found' });

      expect(status).toBe(404);
    });
  });
});
