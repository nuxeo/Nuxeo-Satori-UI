import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/**
 * The string literals in `source` that name the `Tag.Suggestion` operation — a request to it —
 * after comments are removed, so a sentence about the operation is not a sender.
 */
function tagSuggestionSenders(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
  return code.match(/(['"`])[^'"`\n]*\bTag\.Suggestion\b[^'"`\n]*\1/g) ?? [];
}

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../../../..');

/** The shipped TypeScript under `dir`: no specs, stories, `node_modules` or build output. */
function shippedSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return ['node_modules', 'dist', '.storybook'].includes(entry.name)
        ? []
        : shippedSources(path);
    }
    return /\.ts$/.test(entry.name) && !/\.(spec|stories)\.ts$/.test(entry.name) ? [path] : [];
  });
}

describe('TagService is the only Tag.Suggestion sender', () => {
  it.each([
    ['a URL in single quotes', `post('/nuxeo/api/v1/automation/Tag.Suggestion', body)`, 1],
    ['a URL in double quotes', `post("/nuxeo/api/v1/automation/Tag.Suggestion", body)`, 1],
    ['a template literal', 'post(`${base}/automation/Tag.Suggestion`, body)', 1],
    ['the operation id alone', `operation('Tag.Suggestion', params)`, 1],
    ['an @op path', `post(\`/id/\${uid}/@op/Tag.Suggestion\`)`, 1],
    ['a block comment', `/** Suggests through the \`Tag.Suggestion\` operation. */`, 0],
    ['a line comment', `const a = 1; // calls 'Tag.Suggestion' via TagService`, 0],
    ['another operation', `post('/nuxeo/api/v1/automation/Tag.Suggestions', body)`, 0],
    ['a near name', `post('/nuxeo/api/v1/automation/TagSuggestion', body)`, 0],
  ])('counts %s as %i sender(s)', (_case, source, senders) => {
    expect(tagSuggestionSenders(source)).toHaveLength(senders);
  });

  it('finds exactly one sender in the shipped code: TagService.suggestTags', () => {
    const roots = ['libs', 'apps/nuxeo-ui/src'].map((dir) => join(repositoryRoot, dir));
    const senders = roots
      .flatMap(shippedSources)
      .flatMap((path) =>
        tagSuggestionSenders(readFileSync(path, 'utf8')).map(
          (literal) => `${relative(repositoryRoot, path)}: ${literal}`,
        ),
      );
    expect(senders).toEqual([
      "libs/shared/nuxeo-client/src/lib/services/tag.service.ts: '/nuxeo/api/v1/automation/Tag.Suggestion'",
    ]);
  });
});
