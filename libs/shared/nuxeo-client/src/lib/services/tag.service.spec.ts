import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { TagService } from './tag.service';

describe('TagService.suggestTags', () => {
  let service: TagService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(TagService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('posts the term to Tag.Suggestion, as Web UI does', () => {
    service.suggestTags('contr').subscribe();
    const request = http.expectOne((r) => r.url.endsWith('/automation/Tag.Suggestion'));
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ params: { searchTerm: 'contr' }, context: {} });
    request.flush([]);
  });

  it('answers with each suggestion’s label, or its id when it has none', () => {
    let labels: string[] = [];
    service.suggestTags('c').subscribe((result) => (labels = result));
    http
      .expectOne((r) => r.url.endsWith('/automation/Tag.Suggestion'))
      .flush([{ id: 'contract', displayLabel: 'contract' }, { id: 'claims' }]);
    expect(labels).toEqual(['contract', 'claims']);
  });

  it('passes a server error on to the caller', () => {
    let status = 0;
    service.suggestTags('c').subscribe({ error: (error) => (status = error.status) });
    http
      .expectOne((r) => r.url.endsWith('/automation/Tag.Suggestion'))
      .flush('nope', { status: 500, statusText: 'Server Error' });
    expect(status).toBe(500);
  });
});

describe('TagService.addTag and removeTag', () => {
  let service: TagService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(TagService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('tags through Services.TagDocument and answers with the labels Nuxeo stored', () => {
    let labels: string[] = [];
    service.addTag('doc-1', 'Q3 Report').subscribe((result) => (labels = result));
    const request = http.expectOne((r) => r.url.endsWith('/id/doc-1/@op/Services.TagDocument'));
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ params: { tags: 'Q3 Report' }, context: {} });
    expect(request.request.headers.get('properties')).toBe('facetedTag');
    request.flush({
      uid: 'doc-1',
      properties: {
        'nxtag:tags': [
          { label: 'contract', username: 'jdoe' },
          { label: 'q3report', username: 'jdoe' },
        ],
      },
    });
    expect(labels).toEqual(['contract', 'q3report']);
  });

  it('untags through Services.UntagDocument and answers with the tags left', () => {
    let labels: string[] | null = null;
    service.removeTag('doc-1', 'contract').subscribe((result) => (labels = result));
    const request = http.expectOne((r) => r.url.endsWith('/id/doc-1/@op/Services.UntagDocument'));
    expect(request.request.body).toEqual({ params: { tags: 'contract' }, context: {} });
    expect(request.request.headers.get('properties')).toBe('facetedTag');
    request.flush({ uid: 'doc-1', properties: { 'nxtag:tags': [] } });
    expect(labels).toEqual([]);
  });

  it('reads plain-string labels and treats a missing tag list as none', () => {
    const answers: string[][] = [];
    service.addTag('doc-1', 'a').subscribe((result) => answers.push(result));
    http
      .expectOne((r) => r.url.endsWith('/Services.TagDocument'))
      .flush({ uid: 'doc-1', properties: { 'nxtag:tags': ['a', { label: '' }, null] } });
    service.removeTag('doc-1', 'a').subscribe((result) => answers.push(result));
    http.expectOne((r) => r.url.endsWith('/Services.UntagDocument')).flush({ uid: 'doc-1' });
    expect(answers).toEqual([['a'], []]);
  });

  it('passes a refusal on to the caller', () => {
    let status = 0;
    service.removeTag('doc-1', 'a').subscribe({ error: (error) => (status = error.status) });
    http
      .expectOne((r) => r.url.endsWith('/Services.UntagDocument'))
      .flush('no', { status: 403, statusText: 'Forbidden' });
    expect(status).toBe(403);
  });
});
