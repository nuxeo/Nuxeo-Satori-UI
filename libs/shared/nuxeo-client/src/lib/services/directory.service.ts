import { HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, EMPTY, catchError, expand, map, of, reduce, shareReplay } from 'rxjs';

import { NuxeoApiBase } from './nuxeo-api-base';
import {
  DEFAULT_VOCABULARY_ORDERING,
  DirectoryEntriesResponse,
  DirectoryEntry,
  DirectoryEntryRest,
  DirectoryMetadata,
  FALLBACK_DIRECTORY_NAMES,
  L10nDirectoryEntry,
  L10nDirectoryResponse,
  ManagedDirectoryEntry,
  VocabularyEntryFormValues,
  directoryPickerLabel,
  directoryUsesL10nLabel,
  isManagedDirectory,
  isManagedDirectoryName,
  resolveParentSourceName,
} from '../models/directory.model';

@Injectable({ providedIn: 'root' })
export class DirectoryService {
  private readonly api = inject(NuxeoApiBase);
  private catalog$?: Observable<Map<string, DirectoryMetadata>>;

  /** Nuxeo directory registry (name → metadata including parent vocabulary). */
  getDirectoryCatalog(): Observable<Map<string, DirectoryMetadata>> {
    if (!this.catalog$) {
      this.catalog$ = this.fetchDirectoryCatalog().pipe(
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    }
    return this.catalog$;
  }

  /** Directory names for Administration → Vocabularies (excludes system directories). */
  listDirectoryNames(): Observable<string[]> {
    return this.getDirectoryCatalog().pipe(
      map((catalog) => {
        const names = [...catalog.values()]
          .filter(isManagedDirectory)
          .map((meta) => meta.name)
          .sort((a, b) => a.localeCompare(b));
        return names.length ? names : [...FALLBACK_DIRECTORY_NAMES].filter(isManagedDirectoryName);
      }),
    );
  }

  invalidateDirectoryCatalog(): void {
    this.catalog$ = undefined;
  }

  private fetchDirectoryCatalog(): Observable<Map<string, DirectoryMetadata>> {
    return this.api.get<DirectoryCatalogResponse>('/nuxeo/api/v1/directory').pipe(
      map((res) => this.parseDirectoryCatalog(res)),
      catchError(() => {
        this.catalog$ = undefined;
        return of(new Map<string, DirectoryMetadata>());
      }),
    );
  }

  private parseDirectoryCatalog(res: DirectoryCatalogResponse): Map<string, DirectoryMetadata> {
    const rows = this.extractDirectoryCatalogRows(res);
    const catalog = new Map<string, DirectoryMetadata>();
    for (const row of rows) {
      const name = row.name;
      if (!name) continue;
      catalog.set(name, {
        name,
        schema: row.schema,
        idField: row.idField,
        parentDirectory: row.parent || row.parentDirectory || undefined,
        type: row.type,
      });
    }
    return catalog;
  }

  private extractDirectoryCatalogRows(res: DirectoryCatalogResponse): DirectoryMetadataRest[] {
    if (Array.isArray(res)) return res;
    if (res.entries?.length) return res.entries;
    if (res.directories?.length) return res.directories;
    return [];
  }

  /**
   * Loads active directory entries for metadata pickers via Directory.SuggestEntries.
   * Each call queries the server (Nuxeo Web UI parity — no session-wide list cache).
   * `lang` localises the labels; English unless the caller asks for another language.
   */
  getEntries(directoryName: string, lang = 'en'): Observable<DirectoryEntry[]> {
    return this.api
      .post<DirectoryEntry[]>(
        '/nuxeo/api/v1/automation/Directory.SuggestEntries',
        {
          params: {
            directoryName,
            contains: true,
            dbl10n: false,
            localize: true,
            lang,
            searchTerm: '',
          },
          context: {},
        },
        { 'Content-Type': 'application/json', properties: '*' },
      )
      .pipe(
        map((entries) =>
          entries
            .filter((e) => !e.obsolete)
            .map((entry) => ({
              ...entry,
              displayLabel: directoryPickerLabel(entry),
            }))
            .sort((a, b) => a.ordering - b.ordering),
        ),
      );
  }

  /**
   * Loads all directory entries for the admin vocabularies table (includes obsolete entries).
   */
  getAdminEntries(directoryName: string): Observable<ManagedDirectoryEntry[]> {
    const fetchPage = (pageIndex: number) => {
      const params = new HttpParams()
        .set('pageSize', '50')
        .set('currentPageIndex', String(pageIndex));
      return this.api.get<DirectoryEntriesResponse>(
        `/nuxeo/api/v1/directory/${encodeURIComponent(directoryName)}`,
        params,
      );
    };

    return fetchPage(0).pipe(
      expand((res) => (res.isNextPageAvailable ? fetchPage(res.currentPageIndex + 1) : EMPTY)),
      reduce<DirectoryEntriesResponse, DirectoryEntryRest[]>(
        (acc, res) => acc.concat(res.entries ?? []),
        [],
      ),
      map((entries) =>
        entries
          .map((entry) => this.normalizeAdminEntry(directoryName, entry))
          .sort((a, b) => a.ordering - b.ordering || a.label.localeCompare(b.label)),
      ),
    );
  }

  createEntry(
    directoryName: string,
    values: VocabularyEntryFormValues,
    metadata?: DirectoryMetadata,
  ): Observable<ManagedDirectoryEntry> {
    const body = {
      'entity-type': 'directoryEntry',
      directoryName,
      properties: this.buildEntryProperties(directoryName, values, metadata),
    };

    return this.api
      .post<DirectoryEntryRest>(
        `/nuxeo/api/v1/directory/${encodeURIComponent(directoryName)}/`,
        body,
        { 'Content-Type': 'application/json' },
      )
      .pipe(map((entry) => this.normalizeAdminEntry(directoryName, entry)));
  }

  updateEntry(
    directoryName: string,
    entryId: string,
    values: VocabularyEntryFormValues,
    metadata?: DirectoryMetadata,
  ): Observable<ManagedDirectoryEntry> {
    const body = {
      'entity-type': 'directoryEntry',
      directoryName,
      id: entryId,
      properties: this.buildEntryProperties(directoryName, values, metadata),
    };

    return this.api
      .put<DirectoryEntryRest>(
        `/nuxeo/api/v1/directory/${encodeURIComponent(directoryName)}/${encodeURIComponent(entryId)}`,
        body,
        { 'Content-Type': 'application/json' },
      )
      .pipe(map((entry) => this.normalizeAdminEntry(directoryName, entry)));
  }

  deleteEntry(directoryName: string, entryId: string): Observable<void> {
    return this.api
      .delete<void>(
        `/nuxeo/api/v1/directory/${encodeURIComponent(directoryName)}/${encodeURIComponent(entryId)}`,
      )
      .pipe(map(() => undefined));
  }

  /**
   * Fetches entries from an l10n directory (l10nsubjects, l10ncoverage)
   * using the REST directory API with pagination. Returns only top-level
   * entries (parent === '').
   */
  getL10nEntries(directoryName: string): Observable<L10nDirectoryEntry[]> {
    return this.fetchL10nEntries(directoryName, 'top-level');
  }

  /**
   * Fetches every entry from an l10n directory, including children, for
   * hierarchical pickers (e.g. grouped coverage / subjects dropdowns).
   */
  getAllL10nEntries(directoryName: string): Observable<L10nDirectoryEntry[]> {
    return this.fetchL10nEntries(directoryName, 'all');
  }

  private fetchL10nEntries(
    directoryName: string,
    scope: 'top-level' | 'all',
  ): Observable<L10nDirectoryEntry[]> {
    const fetchPage = (pageIndex: number) => {
      const params = new HttpParams().set('pageSize', 50).set('currentPageIndex', pageIndex);
      return this.api.get<L10nDirectoryResponse>(
        `/nuxeo/api/v1/directory/${directoryName}`,
        params,
      );
    };

    return fetchPage(0).pipe(
      expand((res) => (res.isNextPageAvailable ? fetchPage(res.currentPageIndex + 1) : EMPTY)),
      reduce<L10nDirectoryResponse, L10nDirectoryEntry[]>(
        (acc, res) => acc.concat(res.entries),
        [],
      ),
      map((entries) =>
        entries
          .filter((e) => {
            if (e.properties.obsolete) return false;
            return scope === 'all' || !e.properties.parent;
          })
          .sort((a, b) =>
            (a.properties.label_en ?? a.id).localeCompare(b.properties.label_en ?? b.id),
          ),
      ),
    );
  }

  getEventTypes(): Observable<DirectoryEntry[]> {
    return this.getEntries('eventTypes');
  }

  getEventCategories(): Observable<DirectoryEntry[]> {
    return this.getEntries('eventCategories');
  }

  private normalizeAdminEntry(
    directoryName: string,
    entry: DirectoryEntryRest,
  ): ManagedDirectoryEntry {
    const properties = entry.properties ?? {};
    const propertyKeys = Object.keys(properties);
    const l10n = directoryUsesL10nLabel(directoryName);
    const parentValue = properties['parent'];
    const parent =
      parentValue !== undefined && parentValue !== null && String(parentValue) !== ''
        ? String(parentValue)
        : undefined;
    return {
      id: entry.id ?? String(properties['id'] ?? ''),
      directoryName,
      label: l10n
        ? String(properties['label_en'] ?? properties['label'] ?? entry.id)
        : String(properties['label'] ?? entry.id),
      ordering: Number(properties['ordering'] ?? DEFAULT_VOCABULARY_ORDERING),
      obsolete: Number(properties['obsolete'] ?? 0) === 1,
      parent,
      propertyKeys,
    };
  }

  private buildEntryProperties(
    directoryName: string,
    values: VocabularyEntryFormValues,
    metadata?: DirectoryMetadata,
  ): Record<string, string | number> {
    const properties: Record<string, string | number> = {
      id: values.id.trim(),
      ordering: values.ordering,
      obsolete: values.obsolete ? 1 : 0,
    };

    if (directoryUsesL10nLabel(directoryName)) {
      properties['label_en'] = values.label.trim();
    } else {
      properties['label'] = values.label.trim();
    }

    if (resolveParentSourceName(directoryName, metadata) || values.parent !== undefined) {
      properties['parent'] = values.parent?.trim() ?? '';
    }

    return properties;
  }
}

interface DirectoryMetadataRest {
  name: string;
  schema?: string;
  idField?: string;
  parent?: string;
  parentDirectory?: string;
  type?: string;
}

type DirectoryCatalogResponse =
  | DirectoryMetadataRest[]
  | { entries?: DirectoryMetadataRest[]; directories?: DirectoryMetadataRest[] };
