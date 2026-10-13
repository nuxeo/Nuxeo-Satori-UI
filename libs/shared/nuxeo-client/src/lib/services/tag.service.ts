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
   * with 404.
   */
  suggestTags(term: string): Observable<string[]> {
    return this.api
      .post<TagSuggestion[]>(
        '/nuxeo/api/v1/automation/Tag.Suggestion',
        { params: { searchTerm: term }, context: {} },
        { 'Content-Type': 'application/json' },
      )
      .pipe(map((entries) => entries.map((entry) => entry.displayLabel || entry.id)));
  }
}

/** One entry `Tag.Suggestion` answers with. */
interface TagSuggestion {
  readonly id: string;
  readonly displayLabel?: string;
}
