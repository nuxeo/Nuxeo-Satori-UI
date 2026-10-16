import { Observable, catchError, forkJoin, map, of } from 'rxjs';

import type { NxsFacetLabels } from '@nuxeo/satori-platform/components';
import { DirectoryService, type L10nDirectoryEntry } from '@nuxeo/satori-platform/nuxeo-client';

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

/**
 * An l10n vocabulary's labels, keyed the way the search stores them. A child is stored as
 * `<parent>/<id>` and labelled `<Parent>/<Child>`, as the vocabulary picker does: the ids are bare,
 * so the parent is what keeps two children of one name apart. A top-level entry keeps its id.
 *
 * A child's bare id is also labelled when no other entry shares it, because a value saved without
 * its parent (`formatHierarchicalL10nLabel` accepts those) is still a bucket. An ambiguous bare id
 * gets no alias, so it shows as itself rather than with the wrong parent's label.
 *
 * Labels follow `lang` (`fr-FR` counts as French), falling back to the other language, then the id.
 * The map is built with `Object.fromEntries`, so an id such as `__proto__` is an own key.
 */
function l10nLabels(entries: readonly L10nDirectoryEntry[], lang: string): Record<string, string> {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const idCount = new Map<string, number>();
  for (const entry of entries) idCount.set(entry.id, (idCount.get(entry.id) ?? 0) + 1);
  const french = lang.split('-')[0] === 'fr';
  const textOf = (entry: L10nDirectoryEntry): string => {
    const { label_en: en, label_fr: fr } = entry.properties;
    return (french ? fr || en : en || fr) || entry.id;
  };
  const pairs: [string, string][] = [];
  for (const entry of entries) {
    const parent = entry.properties.parent;
    if (!parent) {
      pairs.push([entry.id, textOf(entry)]);
      continue;
    }
    const parentEntry = byId.get(parent);
    const label = `${parentEntry ? textOf(parentEntry) : parent}/${textOf(entry)}`;
    pairs.push([`${parent}/${entry.id}`, label]);
    if (idCount.get(entry.id) === 1) pairs.push([entry.id, label]);
  }
  return Object.fromEntries(pairs);
}
