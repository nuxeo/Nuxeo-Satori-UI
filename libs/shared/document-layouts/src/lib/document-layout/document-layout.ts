import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  LOCALE_ID,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MatTabsModule } from '@angular/material/tabs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  AppExtensionsService,
  ExtensionComponentRegistry,
  ExtensionOutletComponent,
  ExtensionRuleContextService,
  type ExtensionDocumentLayoutDescriptor,
} from '@nuxeo-satori/platform/extensions';
import { NuxeoDocument } from '@nuxeo-satori/platform/nuxeo-client';
import { forkJoin, map, merge, of, startWith, switchMap } from 'rxjs';

import { DocumentLayoutService } from '../document-layout.service';
import { layoutLabelText } from '../layout-label';
import { layoutSlotEntry } from '../layout-slot';
import { DocumentSchemaRef, LayoutLabel, LayoutMode, ResolvedLayout } from '../layout.model';
import { humanize, readDocumentSchemas } from '../resolve-layout';
import { FieldView, VocabularyValue, describeField, vocabularyValues } from './field-view';

type Vocabularies = ReadonlyMap<string, ReadonlyMap<string, string>>;

interface LayoutTarget {
  readonly uid: string;
  readonly type: string;
  readonly mode: LayoutMode;
  readonly schemas: readonly DocumentSchemaRef[];
}

function sameTarget(a: LayoutTarget | null, b: LayoutTarget | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.uid === b.uid &&
    a.type === b.type &&
    a.mode === b.mode &&
    a.schemas.length === b.schemas.length &&
    a.schemas.every((schema, i) => schema.name === b.schemas[i]?.name)
  );
}

function sameValues(a: readonly VocabularyValue[], b: readonly VocabularyValue[]): boolean {
  return (
    a.length === b.length &&
    a.every((value, i) => value.directory === b[i]?.directory && value.id === b[i]?.id)
  );
}

function byDirectory(
  labels: readonly (VocabularyValue & { readonly label: string | null })[],
): Vocabularies {
  const vocabularies = new Map<string, Map<string, string>>();
  for (const { directory, id, label } of labels) {
    if (label === null) continue;
    let entries = vocabularies.get(directory);
    if (!entries) {
      entries = new Map();
      vocabularies.set(directory, entries);
    }
    entries.set(id, label);
  }
  return vocabularies;
}

interface SectionView {
  readonly id: string;
  /** `null` for a contributed section with no label: it renders without a heading. */
  readonly heading: string | null;
  readonly fields: readonly FieldView[];
}

interface LayoutView {
  readonly type: string;
  readonly source: ResolvedLayout['source'];
  readonly display: ResolvedLayout['display'];
  readonly sections: readonly SectionView[];
}

const NO_VOCABULARIES: Vocabularies = new Map();

/**
 * Renders a document's per-type layout: the file a configuration package contributed for its
 * type and mode, or the layout generated from the type's own schemas and those the document's
 * dynamic facets add. A `documentMetadata` entry whose rule admits the document renders its
 * component in place of either, and the layout comes back if that component cannot be loaded.
 *
 * Read-only. Each value is shown by its schema type, and a vocabulary-bound value by its entry's
 * label. Hiding a field here hides it from this panel only — the REST API still returns it.
 */
@Component({
  selector: 'lib-document-layout',
  standalone: true,
  imports: [ExtensionOutletComponent, MatTabsModule, NgTemplateOutlet, TranslatePipe],
  templateUrl: './document-layout.html',
  styleUrl: './document-layout.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentLayoutComponent {
  readonly document = input.required<NuxeoDocument | null>();
  readonly mode = input<LayoutMode>('metadata');

  private readonly layouts = inject(DocumentLayoutService);
  private readonly translate = inject(TranslateService);
  private readonly locale = inject(LOCALE_ID);
  private readonly extensions = inject(AppExtensionsService);
  private readonly components = inject(ExtensionComponentRegistry);
  private readonly ruleContext = inject(ExtensionRuleContextService);

  /** The `documentMetadata` entry that takes this document's section, or `null` for the layout. */
  readonly entry = computed<ExtensionDocumentLayoutDescriptor | null>(() => {
    const document = this.document();
    if (!document?.type) return null;
    return layoutSlotEntry(this.extensions, this.components, 'metadata', {
      ...this.ruleContext.context(),
      document,
    });
  });

  /** `document` last, so a manifest `inputs.document` cannot stand in for the one on screen. */
  readonly entryInputs = computed<Readonly<Record<string, unknown>>>(() => ({
    ...this.entry()?.inputs,
    document: this.document(),
  }));

  private readonly outlet = viewChild(ExtensionOutletComponent);

  /** The entry's component is on screen. When it fails to load, the layout shows instead. */
  private readonly usesEntry = computed(
    () => this.entry() !== null && !(this.outlet()?.unresolved() ?? false),
  );

  /**
   * Re-resolved per document, not per type: the service caches what it read successfully, and
   * asking again is how a failed schema read recovers on the next document. The schemas are part
   * of it because a dynamic facet gives one document schemas its type does not have.
   */
  private readonly target = computed<LayoutTarget | null>(
    () => {
      const document = this.document();
      if (!document?.type || this.usesEntry()) return null;
      return {
        uid: document.uid,
        type: document.type,
        mode: this.mode(),
        schemas: readDocumentSchemas('schemas' in document ? document.schemas : undefined),
      };
    },
    { equal: sameTarget },
  );

  private readonly resolved = toSignal(
    toObservable(this.target).pipe(
      switchMap((target) =>
        target
          ? this.layouts
              .layoutFor(target.type, target.mode, target.schemas)
              .pipe(map((layout) => ({ target, layout })))
          : of(null),
      ),
    ),
    { initialValue: null },
  );

  /**
   * The layout resolved for the document in force. Two documents of one type can now have
   * different layouts, so the previous one's must not show while this one's resolves.
   */
  private readonly layout = computed(() => {
    const resolved = this.resolved();
    return resolved?.target === this.target() ? resolved.layout : null;
  });

  /** The vocabulary entries this document's values name: only those are read. */
  private readonly vocabularyValues = computed(
    () => {
      const layout = this.layout();
      const document = this.document();
      if (!layout || !document || layout.type !== document.type) return [];
      return vocabularyValues(
        layout.sections.flatMap((section) =>
          section.fields.map((field) => ({
            definition: field.definition,
            value: document.properties[field.xpath],
          })),
        ),
      );
    },
    { equal: sameValues },
  );

  /** Shown as the stored ids until the labels arrive, and as the id wherever one cannot be read. */
  private readonly vocabularies = toSignal(
    toObservable(this.vocabularyValues).pipe(
      switchMap((values) =>
        values.length === 0
          ? of(NO_VOCABULARIES)
          : forkJoin(
              values.map((value) =>
                this.layouts
                  .vocabularyLabel(value.directory, value.id)
                  .pipe(map((label) => ({ ...value, label }))),
              ),
            ).pipe(map(byDirectory), startWith(NO_VOCABULARIES)),
      ),
    ),
    { initialValue: NO_VOCABULARIES },
  );

  /** Bumped when the language or a catalogue changes, so labels resolved with `instant` follow. */
  private readonly translations = signal(0);

  constructor() {
    merge(this.translate.onLangChange, this.translate.onTranslationChange)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.translations.update((n) => n + 1));
  }

  readonly view = computed<LayoutView | null>(() => {
    this.translations();
    const document = this.document();
    const layout = this.layout();
    const vocabularies = this.vocabularies();
    // A layout still resolving for the previous document's type must not show this one's values.
    if (!document || !layout || layout.type !== document.type) return null;
    const context = {
      locale: this.locale,
      vocabulary: (directory: string, id: string) => vocabularies.get(directory)?.get(id) ?? id,
    };
    const sections = layout.sections.map((section) => ({
      id: section.id,
      heading: this.text(section.label),
      fields: section.fields.map((field) =>
        describeField(
          field.xpath,
          this.text(field.label) ?? field.xpath,
          field.definition,
          document.properties[field.xpath],
          context,
        ),
      ),
    }));
    return { type: layout.type, source: layout.source, display: layout.display, sections };
  });

  /** A tab needs a name even where a section heading may be left out. */
  tabLabel(section: SectionView): string {
    return section.heading ?? humanize(section.id);
  }

  private text(label: LayoutLabel): string | null {
    return layoutLabelText(this.translate, label);
  }
}
