import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import {
  avatarColor,
  documentHasPersistedMainBlob,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';

import { NxsAvatarComponent } from '../avatar/avatar.component';
import type { NxsHeadingLevel } from '../heading-level';
import { NxsTagComponent } from '../tag/tag.component';
import { nxsInitial, nxsPropertyText } from './property-text';

/** Turns a vocabulary value into its label: `(directory, id) => label`. */
export type NxsVocabularyLabel = (directory: string, id: string) => string;

interface NxsPerson {
  readonly name: string;
  readonly initial: string;
  readonly color: ReturnType<typeof avatarColor>;
}

const person = (value: unknown): NxsPerson | null => {
  const name = nxsPropertyText(value);
  return name ? { name, initial: nxsInitial(name), color: avatarColor(name) } : null;
};

/**
 * The Properties view of a document page's side panel — Web UI's `nuxeo-document-info` and
 * `nuxeo-document-metadata`, with the collections and tags sections beside them.
 *
 * It reads what it shows from the document: lifecycle state, dates, creator and contributors, the
 * Dublin Core properties, and the collections it is in. What needs the page — the version control,
 * the tag editor, the type's own layout and the attachments — is projected:
 *
 * - `[nxsVersion]` replaces the version text with a control.
 * - `[nxsTags]` replaces the read-only tag chips with an editor. Tags show only on a document with
 *   the `NXTag` facet, as in Web UI.
 * - Anything else renders after the Dublin Core properties and before the collections.
 *
 * Every value goes through `nxsPropertyText`, so a directory entry, a user or a blob shows its
 * label or name, never `[object Object]`.
 */
@Component({
  selector: 'nxs-properties-panel',
  standalone: true,
  templateUrl: './properties-panel.component.html',
  styleUrl: './properties-panel.component.scss',
  imports: [DatePipe, TranslatePipe, NxsAvatarComponent, NxsTagComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-properties-panel' },
})
export class NxsPropertiesPanelComponent {
  /** The document shown. Nothing renders without one. */
  readonly document = input.required<NuxeoDocument | null>();
  /** Labels for `dc:nature`, `dc:coverage` and `dc:subjects`. Without it the stored ID shows. */
  readonly vocabularyLabel = input<NxsVocabularyLabel | null>(null);
  /** A workflow is running on the document. */
  readonly processRunning = input(false);
  /** The version text, e.g. `1.2+`; a projected `[nxsVersion]` control replaces it. */
  readonly versionLabel = input('');
  /** How many times the document is published; `null` hides the row. */
  readonly publications = input<number | null>(null);
  /** The note's format, e.g. "Markdown". Blank hides the row. */
  readonly format = input('');
  /** The level of the section headings, so they sit under the page's own. */
  readonly headingLevel = input<NxsHeadingLevel>(4);

  /** The publication count was pressed. Only offered when there is at least one. */
  readonly publicationsSelected = output<void>();

  protected readonly props = computed(
    () => (this.document()?.properties ?? {}) as Readonly<Record<string, unknown>>,
  );
  protected readonly state = computed(() => this.document()?.state ?? '');
  protected readonly modified = computed(
    () => nxsPropertyText(this.props()['dc:modified']) || this.document()?.lastModified || '',
  );
  protected readonly created = computed(() => nxsPropertyText(this.props()['dc:created']));
  protected readonly expires = computed(() => nxsPropertyText(this.props()['dc:expired']));
  protected readonly creator = computed(() => person(this.props()['dc:creator']));
  protected readonly contributors = computed(() => {
    const raw = this.props()['dc:contributors'];
    return (Array.isArray(raw) ? raw : [])
      .map(person)
      .filter((entry): entry is NxsPerson => entry !== null);
  });
  protected readonly fileName = computed(() => {
    const doc = this.document();
    if (!doc || !documentHasPersistedMainBlob(doc)) return '';
    return nxsPropertyText(this.props()['file:content']) || doc.title;
  });
  protected readonly description = computed(() => nxsPropertyText(this.props()['dc:description']));
  protected readonly nature = computed(() => this.vocabulary('nature', this.props()['dc:nature']));
  protected readonly coverage = computed(() =>
    this.vocabulary('l10ncoverage', this.props()['dc:coverage']),
  );
  protected readonly subjects = computed(() => {
    const raw = this.props()['dc:subjects'];
    return (Array.isArray(raw) ? raw : [])
      .map((value) => this.vocabulary('l10nsubjects', value))
      .filter(Boolean)
      .join(', ');
  });
  protected readonly taggable = computed(() => this.document()?.facets?.includes('NXTag') ?? false);
  protected readonly tags = computed(() => {
    const raw = this.props()['nxtag:tags'];
    return (Array.isArray(raw) ? raw : []).map(nxsPropertyText).filter(Boolean);
  });
  /** Web UI's `nuxeo-document-collections`; the Favorites collection is the star, not a collection. */
  protected readonly collections = computed(() => {
    const raw = this.document()?.contextParameters?.['collections'];
    return (Array.isArray(raw) ? raw : [])
      .filter((entry) => (entry as { type?: string })?.type !== 'Favorites')
      .map((entry) => ({
        uid: nxsPropertyText((entry as { uid?: unknown }).uid),
        title: nxsPropertyText(entry),
      }))
      .filter((entry) => entry.title !== '');
  });

  /** A vocabulary value as its label: a string ID through `vocabularyLabel`, an entry by its own. */
  private vocabulary(directory: string, value: unknown): string {
    const label = this.vocabularyLabel();
    return typeof value === 'string' && value && label
      ? label(directory, value) || value
      : nxsPropertyText(value);
  }
}
