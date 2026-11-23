import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';

import {
  NOTIFICATION_SEEN_KEY_PREFIX,
  NOTIFICATION_SEEN_LIMIT,
  NotificationReadState,
} from './notification-read-state';

describe('NotificationReadState', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  function make(): NotificationReadState {
    TestBed.resetTestingModule();
    return TestBed.inject(NotificationReadState);
  }

  it('keeps what each user has seen, by key, in localStorage', () => {
    const state = make();
    state.setSeen('jsmith', ['task:t1', 'change:7']);
    expect(localStorage.getItem(`${NOTIFICATION_SEEN_KEY_PREFIX}jsmith`)).toBe(
      '["task:t1","change:7"]',
    );
    expect(state.seen('jsmith')).toEqual(new Set(['task:t1', 'change:7']));
    expect(state.seen('someone-else')).toBeNull();
    expect(state.key('jsmith')).toBe(`${NOTIFICATION_SEEN_KEY_PREFIX}jsmith`);
  });

  it('keeps the most recent keys when there are more than it holds', () => {
    const state = make();
    const keys = Array.from({ length: NOTIFICATION_SEEN_LIMIT + 10 }, (_, i) => `change:${i}`);
    state.setSeen('jsmith', keys);
    const seen = state.seen('jsmith');
    expect(seen?.size).toBe(NOTIFICATION_SEEN_LIMIT);
    expect(seen?.has('change:9')).toBe(false);
    expect(seen?.has(`change:${NOTIFICATION_SEEN_LIMIT + 9}`)).toBe(true);
  });

  it('reads a value that is not a list of keys as nothing seen', () => {
    for (const raw of ['not json', '{"keys":[]}', '"task:t1"']) {
      localStorage.setItem(`${NOTIFICATION_SEEN_KEY_PREFIX}jsmith`, raw);
      expect(make().seen('jsmith'), raw).toBeNull();
    }
    localStorage.setItem(`${NOTIFICATION_SEEN_KEY_PREFIX}jsmith`, '["task:t1", 3, null]');
    expect(make().seen('jsmith')).toEqual(new Set(['task:t1']));
  });

  it('gives nothing, and throws nothing, where storage refuses to be read or written', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    const state = make();
    expect(state.seen('jsmith')).toBeNull();
    expect(() => state.setSeen('jsmith', ['task:t1'])).not.toThrow();
  });

  it('works with no window at all', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: DOCUMENT, useValue: { defaultView: null } }],
    });
    const state = TestBed.inject(NotificationReadState);
    expect(state.seen('jsmith')).toBeNull();
    expect(() => state.setSeen('jsmith', ['task:t1'])).not.toThrow();
  });
});
