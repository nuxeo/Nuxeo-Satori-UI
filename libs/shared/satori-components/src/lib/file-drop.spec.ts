import { NxsFileDropTracker, dragHasFiles } from './file-drop';

function drag(types: string[] | null, files: File[] = []): DragEvent {
  const event = new Event('dragover', { cancelable: true }) as DragEvent;
  Object.defineProperty(event, 'dataTransfer', {
    value: types === null ? null : { types, files, dropEffect: 'none' },
  });
  return event;
}

describe('dragHasFiles', () => {
  it.each([
    ['files from the computer', ['Files'], true],
    ['files listed after other types', ['text/uri-list', 'Files'], true],
    ['text', ['text/plain'], false],
    ['a link', ['text/uri-list', 'text/html'], false],
    ['a type that only contains the word', ['application/x-Files-list'], false],
    ['nothing at all', [], false],
    ['no data transfer', null, false],
  ])('%s', (_case, types, expected) => {
    expect(dragHasFiles(drag(types))).toBe(expected);
  });
});

describe('NxsFileDropTracker', () => {
  let accepting: boolean;
  let tracker: NxsFileDropTracker;

  beforeEach(() => {
    accepting = true;
    tracker = new NxsFileDropTracker(() => accepting);
  });

  it('stays over the target while the pointer crosses its children', () => {
    tracker.enter(drag(['Files']));
    tracker.enter(drag(['Files']));
    tracker.leave(drag(['Files']));
    expect(tracker.over()).toBe(true);
    tracker.leave(drag(['Files']));
    expect(tracker.over()).toBe(false);
    tracker.leave(drag(['Files']));
    expect(tracker.over()).toBe(false);
  });

  it('lets files be dropped, as a copy, by cancelling dragover', () => {
    const event = drag(['Files']);
    tracker.overTarget(event);
    expect(event.defaultPrevented).toBe(true);
    expect(event.dataTransfer?.dropEffect).toBe('copy');
  });

  it('leaves a drag of text to the browser', () => {
    const over = drag(['text/plain']);
    tracker.enter(over);
    tracker.overTarget(over);
    expect(over.defaultPrevented).toBe(false);
    expect(over.dataTransfer?.dropEffect).toBe('none');
    expect(tracker.over()).toBe(false);
    expect(tracker.drop(drag(['text/plain']))).toEqual([]);
  });

  it('takes nothing while the target does not accept files', () => {
    accepting = false;
    const event = drag(['Files'], [new File(['a'], 'a.txt')]);
    tracker.enter(event);
    tracker.overTarget(event);
    expect(event.defaultPrevented).toBe(false);
    expect(tracker.over()).toBe(false);
    expect(tracker.drop(event)).toEqual([]);
  });

  it('hands over the dropped files and clears the highlight', () => {
    const files = [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')];
    tracker.enter(drag(['Files']));
    tracker.enter(drag(['Files']));
    const event = drag(['Files'], files);
    expect(tracker.drop(event)).toEqual(files);
    expect(event.defaultPrevented).toBe(true);
    expect(tracker.over()).toBe(false);
    // The next drag starts from nothing, not from the two entries before the drop.
    tracker.enter(drag(['Files']));
    tracker.leave(drag(['Files']));
    expect(tracker.over()).toBe(false);
  });
});
