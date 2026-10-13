import type { NuxeoDocument } from '@nuxeo-satori/platform/nuxeo-client';

import { NxsUploadQueue } from './upload-queue';

const file = (name: string, size = 10): File => new File(['x'.repeat(size)], name);
const created = (uid: string) => ({ uid, title: uid }) as NuxeoDocument;

describe('NxsUploadQueue', () => {
  let queue: NxsUploadQueue;
  const states = () =>
    queue.items().map((item) => `${item.file.name}:${item.state}:${item.percent}`);

  beforeEach(() => {
    queue = new NxsUploadQueue();
    queue.stage([file('a.pdf'), file('b.pdf'), file('c.pdf')]);
  });

  it('stages files, in order, not yet uploading', () => {
    expect(states()).toEqual(['a.pdf:staged:0', 'b.pdf:staged:0', 'c.pdf:staged:0']);
    expect(queue.pending().map((f) => f.name)).toEqual(['a.pdf', 'b.pdf', 'c.pdf']);
    expect(queue.busy()).toBe(false);
  });

  it('follows one batch’s progress file by file', () => {
    queue.start();
    expect(queue.busy()).toBe(true);
    expect(states()).toEqual(['a.pdf:waiting:0', 'b.pdf:waiting:0', 'c.pdf:waiting:0']);

    // DocumentImportService reports the whole batch's percent and the file in hand.
    queue.progress({ percent: 17, fileIndex: 0, fileCount: 3 });
    expect(states()).toEqual(['a.pdf:uploading:51', 'b.pdf:waiting:0', 'c.pdf:waiting:0']);

    queue.progress({ percent: 50, fileIndex: 1, fileCount: 3 });
    expect(states()).toEqual(['a.pdf:uploading:100', 'b.pdf:uploading:50', 'c.pdf:waiting:0']);

    queue.complete([created('d-a'), created('d-b'), created('d-c')]);
    expect(states()).toEqual(['a.pdf:done:100', 'b.pdf:done:100', 'c.pdf:done:100']);
    expect(queue.done().map((item) => item.document?.uid)).toEqual(['d-a', 'd-b', 'd-c']);
    expect(queue.busy()).toBe(false);
  });

  it('on a failure keeps what was created, fails the file in hand and requeues the rest', () => {
    queue.start();
    queue.progress({ percent: 33.4, fileIndex: 0, fileCount: 3 });
    queue.progress({ percent: 40, fileIndex: 1, fileCount: 3 });
    queue.fail({ status: 403 });

    expect(states()).toEqual(['a.pdf:done:100', 'b.pdf:failed:20', 'c.pdf:staged:0']);
    expect(queue.failed()[0].error).toBe(403);
    // Another run uploads only what was not created.
    expect(queue.pending().map((f) => f.name)).toEqual(['b.pdf', 'c.pdf']);
  });

  it('fails the first file when the batch fails before any progress', () => {
    queue.start();
    queue.fail(new Error('network down'));
    expect(states()).toEqual(['a.pdf:failed:0', 'b.pdf:staged:0', 'c.pdf:staged:0']);
    expect(queue.failed()[0].error).toBe(500);
  });

  it('retries only the pending files, clearing their error', () => {
    queue.start();
    queue.fail({ status: 500 });
    queue.start();
    expect(states()).toEqual(['a.pdf:waiting:0', 'b.pdf:waiting:0', 'c.pdf:waiting:0']);
    expect(queue.items().every((item) => item.error === null)).toBe(true);
  });

  it('does not let a file be removed while its run is under way, and clears only when idle', () => {
    const [first] = queue.items();
    queue.start();
    queue.remove(first.id);
    queue.clear();
    expect(queue.items()).toHaveLength(3);

    queue.complete([]);
    queue.remove(first.id);
    expect(queue.items()).toHaveLength(2);
    queue.clearDone();
    expect(queue.items()).toHaveLength(0);
  });

  it('ignores progress with no run under way', () => {
    queue.progress({ percent: 50, fileIndex: 1, fileCount: 3 });
    expect(states()).toEqual(['a.pdf:staged:0', 'b.pdf:staged:0', 'c.pdf:staged:0']);
  });
});
