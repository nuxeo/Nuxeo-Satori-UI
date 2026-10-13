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

  it('skips an entry with neither a label nor an id', () => {
    let labels: string[] = [];
    service.suggestTags('c').subscribe((result) => (labels = result));
    http
      .expectOne((r) => r.url.endsWith('/automation/Tag.Suggestion'))
      .flush([{ id: 'contract', displayLabel: '' }, { other: true }, null, { id: 'claims' }]);
    expect(labels).toEqual(['contract', 'claims']);
  });

  it('answers no suggestions when the answer is not a list', () => {
    let labels: string[] | undefined;
    service.suggestTags('c').subscribe((result) => (labels = result));
    http.expectOne((r) => r.url.endsWith('/automation/Tag.Suggestion')).flush({ entries: [] });
    expect(labels).toEqual([]);
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
