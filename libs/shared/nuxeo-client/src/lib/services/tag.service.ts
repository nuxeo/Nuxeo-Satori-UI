import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';

import { NuxeoApiBase } from './nuxeo-api-base';

export interface TagEntry {
  label: string;
}

@Injectable({ providedIn: 'root' })
export class TagService {
  private readonly api = inject(NuxeoApiBase);
  private readonly http = inject(HttpClient);

  addTag(uid: string, label: string): Observable<unknown> {
    return this.api.post(`/nuxeo/api/v1/id/${uid}/@op/Services.TagDocument`, {
      params: { tags: label },
      context: {},
    });
  }

  removeTag(uid: string, label: string): Observable<unknown> {
    return this.api.post(`/nuxeo/api/v1/id/${uid}/@op/Services.UntagDocument`, {
      params: { tags: label },
      context: {},
    });
  }

  searchTags(term: string): Observable<string[]> {
    const params = new HttpParams().set('pageSize', '20').set('currentPageIndex', '0');
    return this.http
      .get<{
        entries: Array<{ properties: { label: string } }>;
      }>(this.api.apiUrl('/nuxeo/api/v1/directory/label_tag_entry'), { params })
      .pipe(
        map((res) =>
          res.entries
            .map((e) => e.properties.label)
            .filter((l) => l.toLowerCase().includes(term.toLowerCase())),
        ),
      );
  }

  /**
   * Existing tags matching `term`, as Web UI's tag suggestion lists them: the `Tag.Suggestion`
   * operation. `searchTags` reads a `label_tag_entry` directory, which a stock Nuxeo 2025 answers
   * with 404. An entry with neither a label nor an id is skipped, and an answer that is not a list
   * is no suggestions; a server error reaches the caller.
   */
  suggestTags(term: string): Observable<string[]> {
    return this.api
      .post<unknown>(
        '/nuxeo/api/v1/automation/Tag.Suggestion',
        { params: { searchTerm: term }, context: {} },
        { 'Content-Type': 'application/json' },
      )
      .pipe(
        map((answer) =>
          Array.isArray(answer) ? answer.map(suggestionLabel).filter((label) => label !== '') : [],
        ),
      );
  }
}

/** A `Tag.Suggestion` entry's label, or its id when it has none; empty when it has neither. */
function suggestionLabel(entry: unknown): string {
  if (typeof entry !== 'object' || entry === null) return '';
  const label = 'displayLabel' in entry ? entry.displayLabel : undefined;
  const id = 'id' in entry ? entry.id : undefined;
  return (typeof label === 'string' && label) || (typeof id === 'string' ? id : '');
}
