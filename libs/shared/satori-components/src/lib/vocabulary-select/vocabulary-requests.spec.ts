import { TestBed } from '@angular/core/testing';
import { defer, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DirectoryService,
  type DirectoryEntry,
  type L10nDirectoryEntry,
} from '@nuxeo/satori-platform/nuxeo-client';

import { NxsVocabularyRequests } from './vocabulary-requests';

const NATURE: DirectoryEntry[] = [
  {
    id: 'memo',
    label: 'Memo',
    displayLabel: 'Memo',
    ordering: 0,
    obsolete: 0,
    directoryName: 'nature',
  },
];
const COVERAGE: L10nDirectoryEntry[] = [
  {
    id: 'europe',
    directoryName: 'l10ncoverage',
    properties: { id: 'europe', parent: '', ordering: 0, obsolete: 0, label_en: 'Europe' },
  },
];

describe('NxsVocabularyRequests', () => {
  let sent: string[];
  let requests: NxsVocabularyRequests;
  let directories: {
    getEntries: ReturnType<typeof vi.fn>;
    getAllL10nEntries: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    sent = [];
    directories = {
      getEntries: vi.fn((directory: string) => defer(() => (sent.push(directory), of(NATURE)))),
      getAllL10nEntries: vi.fn((directory: string) =>
        defer(() => (sent.push(directory), of(COVERAGE))),
      ),
    };
    TestBed.configureTestingModule({
      providers: [NxsVocabularyRequests, { provide: DirectoryService, useValue: directories }],
    });
    requests = TestBed.inject(NxsVocabularyRequests);
  });

  it('sends one request per directory, however many fields read it', () => {
    const read: unknown[] = [];
    for (let field = 0; field < 3; field++) {
      requests.getEntries('nature').subscribe((entries) => read.push(entries));
      requests.getAllL10nEntries('l10ncoverage').subscribe((entries) => read.push(entries));
    }
    requests.getEntries('subtopic').subscribe();
    expect(sent).toEqual(['nature', 'l10ncoverage', 'subtopic']);
    expect(read).toEqual([NATURE, COVERAGE, NATURE, COVERAGE, NATURE, COVERAGE]);
  });

  it('keeps a flat and a localized directory of one name apart', () => {
    requests.getEntries('topics').subscribe();
    requests.getAllL10nEntries('topics').subscribe();
    expect(sent).toEqual(['topics', 'topics']);
  });

  it('forgets a request that failed, so the next field to read it asks again', () => {
    directories.getEntries.mockReturnValueOnce(
      defer(() => (sent.push('nature'), throwError(() => ({ status: 500 })))),
    );
    const failed = vi.fn();
    requests.getEntries('nature').subscribe({ error: failed });
    expect(failed).toHaveBeenCalledWith({ status: 500 });
    let read: unknown;
    requests.getEntries('nature').subscribe((entries) => (read = entries));
    expect(read).toEqual(NATURE);
    expect(sent).toEqual(['nature', 'nature']);
  });

  it('is not shared between two hosts', () => {
    const other = TestBed.runInInjectionContext(() => new NxsVocabularyRequests());
    requests.getEntries('nature').subscribe();
    other.getEntries('nature').subscribe();
    expect(sent).toEqual(['nature', 'nature']);
  });
});
