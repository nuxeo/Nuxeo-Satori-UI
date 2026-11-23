import { TestBed } from '@angular/core/testing';

import { DocumentChangesService } from './document-changes.service';

describe('DocumentChangesService', () => {
  it('is one instance for the whole app', () => {
    expect(TestBed.inject(DocumentChangesService)).toBe(TestBed.inject(DocumentChangesService));
  });

  it('tells every follower of each change before notify returns', () => {
    const changes = TestBed.inject(DocumentChangesService);
    const heard: string[] = [];
    changes.changes.subscribe(() => heard.push('browse'));
    changes.changes.subscribe(() => heard.push('related records'));

    changes.notify();
    expect(heard).toEqual(['browse', 'related records']);

    changes.notify();
    expect(heard).toHaveLength(4);
  });

  it('tells a follower nothing of a change before it followed, nor after it stopped', () => {
    const changes = TestBed.inject(DocumentChangesService);
    changes.notify();
    let heard = 0;
    const following = changes.changes.subscribe(() => (heard += 1));
    expect(heard).toBe(0);

    changes.notify();
    following.unsubscribe();
    changes.notify();
    expect(heard).toBe(1);
  });
});
