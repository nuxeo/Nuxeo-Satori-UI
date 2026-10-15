import { Observable, catchError, forkJoin, map, of } from 'rxjs';

import type { NxsFacetLabels } from '@nuxeo-satori/platform/components';
import { DirectoryService, type L10nDirectoryEntry } from '@nuxeo-satori/platform/nuxeo-client';

/**
 * The vocabulary each facet's bucket keys are labelled from: the same directories the metadata
 * pickers use, so a facet reads what the picker on a document reads.
 */
export const FACET_VOCABULARIES = {
  nature: 'nature',
  subjects: 'l10nsubjects',
  coverage: 'l10ncoverage',
} as const;

/**
 * The labels of every nature, subject and coverage id, in `lang`, for the search filters to show.
 *
 * Only the text changes. The filters keep the ids, so a saved search keeps the ids it always had. A
 * vocabulary that fails to load leaves its facet on ids rather than failing the whole drawer.
 */
export function loadFacetLabels(
  directories: DirectoryService,
  lang: string,
): Observable<NxsFacetLabels> {
  return forkJoin({
    nature: directories.getEntries(FACET_VOCABULARIES.nature, lang).pipe(
      map((entries) => Object.fromEntries(entries.map((entry) => [entry.id, entry.displayLabel]))),
      catchError(() => of({})),
    ),
    subjects: directories.getAllL10nEntries(FACET_VOCABULARIES.subjects).pipe(
      map((entries) => l10nLabels(entries, lang)),
      catchError(() => of({})),
    ),
    coverage: directories.getAllL10nEntries(FACET_VOCABULARIES.coverage).pipe(
      map((entries) => l10nLabels(entries, lang)),
      catchError(() => of({})),
    ),
  });
}

/** An l10n vocabulary's label in `lang`, falling back to the other language, then to the id. */
function l10nLabels(entries: readonly L10nDirectoryEntry[], lang: string): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const entry of entries) {
    const { label_en: en, label_fr: fr } = entry.properties;
    const label = lang === 'fr' ? fr || en : en || fr;
    labels[entry.id] = label || entry.id;
  }
  return labels;
}
