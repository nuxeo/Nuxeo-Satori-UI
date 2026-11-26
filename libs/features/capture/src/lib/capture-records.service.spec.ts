import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { DocumentLayoutService, type RecordCapture } from '@agentic-ui/shared/document-layouts';
import { of } from 'rxjs';

import { CaptureRecordsService, type CaptureRecord } from './capture-records.service';

const UID = '6f0c5c84-3c39-4a5e-9d7c-5c1a8e0d3003';
const CAPTURE: RecordCapture = {
  property: 'files:files',
  findBy: ['dmg:number', 'dmg:moveNumber'],
  keepLocation: false,
};

const claim = (overrides: Record<string, unknown> = {}) => ({
  'entity-type': 'document',
  uid: UID,
  type: 'DamageClaim',
  title: 'Dresser top scratched',
  isVersion: false,
  properties: { 'dmg:number': 'DC-3003', 'dmg:moveNumber': 'MV-2003', 'files:files': [] },
  contextParameters: { permissions: ['Read', 'Write'] },
  ...overrides,
});

describe('CaptureRecordsService', () => {
  let http: HttpTestingController;
  let records: CaptureRecordsService;
  const layouts = {
    captureFor: vi.fn(() => of<RecordCapture | null>(CAPTURE)),
    captureTypes: vi.fn(() => of([{ type: 'DamageClaim', capture: CAPTURE }])),
  };

  beforeEach(() => {
    layouts.captureFor.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: DocumentLayoutService, useValue: layouts },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    records = TestBed.inject(CaptureRecordsService);
  });

  afterEach(() => http.verify());

  function load(document: Record<string, unknown>): CaptureRecord | undefined {
    let read: CaptureRecord | undefined;
    records.load(UID).subscribe((record) => (read = record));
    const request = http.expectOne(`/nuxeo/api/v1/id/${UID}`);
    expect(request.request.headers.get('enrichers.document')).toBe('permissions');
    request.flush(document);
    return read;
  }

  it('reads the record with its permissions, its number, and how photos are filed on it', () => {
    expect(load(claim())).toEqual({
      uid: UID,
      title: 'Dresser top scratched',
      type: 'DamageClaim',
      number: 'DC-3003',
      capture: CAPTURE,
      writable: true,
    });
    expect(layouts.captureFor).toHaveBeenCalledWith(expect.objectContaining({ uid: UID }));
  });

  it('is writable only with Write or WriteProperties, and never as a version', () => {
    expect(load(claim({ contextParameters: { permissions: ['Read'] } }))?.writable).toBe(false);
    expect(load(claim({ contextParameters: { permissions: ['WriteProperties'] } }))?.writable).toBe(
      true,
    );
    expect(load(claim({ isVersion: true }))?.writable).toBe(false);
    expect(load(claim({ contextParameters: {} }))?.writable).toBe(false);
  });

  it('has no capture, and no number, for a type that takes no photos', () => {
    layouts.captureFor.mockReturnValueOnce(of(null));
    expect(load(claim())).toMatchObject({ capture: null, number: null });
  });

  it('finds the records a number names, the number a query value', () => {
    let found: unknown;
    records.find('mv-2003').subscribe((choices) => (found = choices));
    const request = http.expectOne((each) => each.url === '/nuxeo/api/v1/search/lang/NXQL/execute');
    const query = request.request.params.get('query') ?? '';
    expect(query).not.toContain('2003');
    expect(request.request.params.getAll('queryParams')).toEqual([
      'DamageClaim',
      'mv-2003',
      'MV-2003',
      'mv-2003',
      'MV-2003',
    ]);
    expect(request.request.params.get('pageSize')).toBe('21');
    request.flush({
      entries: [
        claim(),
        claim({ uid: 'other', title: '', properties: { 'dmg:moveNumber': 'MV-2003' } }),
      ],
    });
    expect(found).toEqual([
      { uid: UID, title: 'Dresser top scratched', number: 'DC-3003' },
      { uid: 'other', title: 'other', number: 'MV-2003' },
    ]);
  });

  it('asks nothing when no type looks a number up', () => {
    layouts.captureTypes.mockReturnValueOnce(of([]));
    let found: unknown;
    records.find('DC-1').subscribe((choices) => (found = choices));
    http.expectNone(() => true);
    expect(found).toEqual([]);
  });

  it('says whether the record holds a file of a name and a size', () => {
    const answers: boolean[] = [];
    const ask = (name: string, size: number) => {
      records.holds(UID, 'files:files', name, size).subscribe((held) => answers.push(held));
      http.expectOne(`/nuxeo/api/v1/id/${UID}`).flush(
        claim({
          properties: { 'files:files': [{ file: { name: 'a.jpg', length: '10' } }, null] },
        }),
      );
    };
    ask('a.jpg', 10);
    ask('a.jpg', 11);
    ask('b.jpg', 10);
    expect(answers).toEqual([true, false, false]);
  });
});
