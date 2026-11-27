import type { NuxeoDocument, NuxeoTask } from '@nuxeo/satori-platform/nuxeo-client';

import { readable, recordItem, taskItem } from './lists';

const link = (id: string) => ['/tasks', id];

describe('readable', () => {
  it.each([
    ['wf.serialDocumentReview.DocumentValidation', 'Document Validation'],
    ['wf.parallelDocumentReview.chooseParticipants.title', 'Choose Participants'],
    ['wf.serialDocumentReview.AcceptReject.directive', 'Accept Reject'],
    ['wf.serialDocumentReview.SerialDocumentReview', 'Serial Document Review'],
    ['SerialDocumentReview', 'Serial Document Review'],
    ['contractReview', 'Contract Review'],
  ])('writes %s as "%s"', (key, text) => {
    expect(readable(key)).toBe(text);
  });
});

describe('taskItem', () => {
  const task = (keys: Partial<NuxeoTask>): NuxeoTask =>
    ({
      id: 't1',
      name: 'wf.serialDocumentReview.DocumentValidation',
      workflowModelName: 'SerialDocumentReview',
      workflowTitle: 'wf.serialDocumentReview.SerialDocumentReview',
      created: '2026-11-03T08:19:19.039Z',
      targetDocTitle: 'Supply agreement',
      ...keys,
    }) as NuxeoTask;

  it("shows a task's name, its record and workflow, the day it was created, and links to it", () => {
    expect(taskItem(task({}), link)).toEqual({
      id: 't1',
      title: 'Document Validation',
      detail: 'Supply agreement · Serial Document Review',
      date: '2026-11-03T08:19:19.039Z',
      link: ['/tasks', 't1'],
    });
  });

  it('names the workflow by its model where it has no title, and leaves out a record it lacks', () => {
    expect(taskItem(task({ workflowTitle: '', targetDocTitle: undefined }), link).detail).toBe(
      'Serial Document Review',
    );
    expect(
      taskItem(task({ workflowTitle: '', workflowModelName: '', targetDocTitle: ' ' }), link)
        .detail,
    ).toBeNull();
  });

  it('shows an unnamed task by its id, and no date for one it cannot read', () => {
    const item = taskItem(task({ name: '', created: '' }), link);
    expect([item.title, item.date]).toEqual(['t1', null]);
  });
});

describe('recordItem', () => {
  const record = (keys: Partial<NuxeoDocument>): NuxeoDocument =>
    ({
      uid: 'c-1',
      title: 'Supply agreement',
      type: 'Contract',
      path: '/default-domain/workspaces/contracts/c-1',
      facets: [],
      lastModified: '2026-11-20T10:00:00.000Z',
      properties: {},
      ...keys,
    }) as NuxeoDocument;

  it('shows a record by its title and type, with its last change, opening its record page', () => {
    expect(recordItem(record({}))).toEqual({
      id: 'c-1',
      title: 'Supply agreement',
      detail: 'Contract',
      date: '2026-11-20T10:00:00.000Z',
      link: '/doc/c-1',
    });
  });

  it('opens a folder where the app opens folders, as Recently viewed does', () => {
    expect(recordItem(record({ facets: ['Folderish'], type: 'Folder' })).link).not.toBe('/doc/c-1');
  });

  it('shows an untitled record by its id', () => {
    expect(recordItem(record({ title: '  ' })).title).toBe('c-1');
  });
});
