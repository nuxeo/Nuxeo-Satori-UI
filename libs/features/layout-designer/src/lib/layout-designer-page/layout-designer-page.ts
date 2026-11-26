import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  linkedSignal,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  propertiesOf,
  publishable,
  validateLayoutV2,
  type Finding,
} from '@agentic-ui/shared/app-definition';
import {
  DocumentLayoutFormComponent,
  RecordPageComponent,
  type FormLayoutPreview,
  type LayoutSource,
  type RecordLayoutPreview,
} from '@agentic-ui/shared/document-layouts';
import {
  NxsBannerComponent,
  NxsButtonComponent,
  NxsConfirmDialogComponent,
  NxsIconButtonComponent,
  NxsSelectComponent,
  NxsSpinnerComponent,
  NxsTextFieldComponent,
  type NxsConfirmDialogData,
  type NxsSelectGroup,
  type NxsSelectOption,
} from '@nuxeo/satori-platform/components';
import type { NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';
import { type Observable, combineLatest, map, merge, of, switchMap } from 'rxjs';

import { downloadJson } from '../download';
import { LayerPanelComponent } from '../layer/layer-panel';
import {
  DESIGNED_MODES,
  LayoutDesignerService,
  type DesignedMode,
  type Reading,
  type RecordChoice,
} from '../layout-designer.service';
import {
  addProperty,
  cardsOf,
  insertField,
  layoutFileName,
  layoutFileText,
  moveField,
  newLayoutFile,
  removeField,
  requiredChoice,
  ruleFromText,
  ruleText,
  setCardText,
  setFieldRule,
  type CardPlace,
  type CardText,
  type DesignerCard,
  type DesignerField,
  type FieldRuleKey,
  type LayoutJson,
  type RequiredChoice,
} from '../layout-edits';

/** A field the designer has taken out of the file, kept to be shown again. */
export interface HiddenField {
  readonly place: CardPlace;
  /** Where it was among the card's fields, where it goes back. */
  readonly index: number;
  /** The entry as the file wrote it. */
  readonly entry: unknown;
  /** The card it was in, by its id, and what the designer called the field. */
  readonly cardId: string;
  readonly name: string;
}

/**
 * Whether the file may be saved:
 *
 * - `checking` while the content model is read, since a file may be saved only once it has been
 *   held to it, or once it is known that it cannot be;
 * - `refused` when the validator has any finding at all: the pipeline's verdict, `publishable`,
 *   since the file goes into a package the pipeline then checks;
 * - `saveable` otherwise.
 */
export type SaveState = 'nothing' | 'checking' | 'refused' | 'saveable';

/** A file the designer may open: a type's record page, edit form or create form. */
export interface LayoutChoice {
  readonly type: string;
  readonly mode: DesignedMode;
  /** Whether the server serves it. One it does not is opened as a new file. */
  readonly served: boolean;
  /** `<Type>/<mode>`, as the picker names it. */
  readonly key: string;
}

/** The choices for one type, as the picker groups them. */
export interface LayoutChoiceGroup {
  readonly type: string;
  readonly choices: readonly LayoutChoice[];
}

/** The preview of a record page: the record page engine's, for a record. */
export interface RecordPreviewShown {
  readonly record: NuxeoDocument;
  readonly preview: RecordLayoutPreview;
}

/**
 * The preview of a form: the form engine's, for the record an edit is for, or for a new record in
 * that record's folder.
 */
export interface FormPreviewShown {
  readonly mode: 'edit' | 'create';
  readonly record: NuxeoDocument;
  /** The folder a create form's record would be made in: the chosen record's. */
  readonly parentPath: string | null;
  readonly preview: FormLayoutPreview;
}

/** The folder a record is in, from its path; `null` for a record with none. */
export function parentPathOf(path: string): string | null {
  const at = path.lastIndexOf('/');
  return at > 0 ? path.slice(0, at) : at === 0 ? '/' : null;
}

const isForm = (mode: DesignedMode): mode is 'edit' | 'create' => mode !== 'view';

/**
 * The layout designer: an administrator opens a type's layout file, version 2, as the server
 * serves it, or a new one, changes it, and sees what it draws for a real record of the type
 * (docs/business-apps/development-plan.md, phase 6). The files are a record page, `view`, and the
 * edit and create forms, `edit` and `create`. The edits are reordering and hiding fields, adding a
 * property of the type, a card's id, heading text and heading key, and a field's rules: when it
 * shows, and in a form when it is required or read-only.
 *
 * - **The preview** is the engine's own: the file is read, held to the record's type and drawn by
 *   `lib-record-page` as the View tab draws a served file, or by `lib-document-layout-form` as the
 *   Edit and Create forms draw one. Both are read-only, and the form offers no Save: nothing is sent.
 * - **Every change is validated** by the app definition's validator, in the file's mode, held to
 *   the server's content model when it can be read, and its findings are listed. A file with any
 *   finding cannot be saved.
 * - **Saving** is a download of the file, as a package holds it. Nothing is written to the server,
 *   and publishing is not built: the app registry has no write API.
 *
 * The route is behind the administrator gate, but showing the page to administrators only is not
 * a security control: the server's permissions decide what anyone may read or change.
 */
@Component({
  selector: 'lib-layout-designer-page',
  standalone: true,
  imports: [
    DocumentLayoutFormComponent,
    LayerPanelComponent,
    NxsBannerComponent,
    NxsButtonComponent,
    NxsIconButtonComponent,
    NxsSelectComponent,
    NxsSpinnerComponent,
    NxsTextFieldComponent,
    RecordPageComponent,
    RouterLink,
    TranslatePipe,
  ],
  templateUrl: './layout-designer-page.html',
  styleUrl: './layout-designer-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Reloading or closing the tab with changes made asks first, as leaving by the app's router does.
  host: { '(window:beforeunload)': 'holdUnload($event)' },
})
export class LayoutDesignerPageComponent {
  private readonly service = inject(LayoutDesignerService);
  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = inject(MatDialog);
  private readonly translate = inject(TranslateService);

  /** What a file may name, read once: the rules and row actions register before a page shows. */
  private readonly registries = this.service.registries();

  /**
   * Ticks when the language or its catalogue changes, so that labels looked up with `instant` in a
   * `computed` follow it as the template's `translate` pipe does. ngx-translate 18 reads its
   * catalogue from signals, so such a `computed` follows it without this too; the tick keeps that
   * true on the service's documented events rather than on how it stores its catalogue.
   */
  private readonly translationTick = toSignal(
    merge(
      this.translate.onLangChange,
      this.translate.onTranslationChange,
      this.translate.onFallbackLangChange,
    ).pipe(map((_, index) => index)),
    { initialValue: -1 },
  );

  readonly files = toSignal(this.service.files(), { initialValue: { state: 'reading' } });
  readonly model = toSignal(this.service.model(), { initialValue: { state: 'reading' } });

  /**
   * What may be opened: for each type the server serves a file of, its record page, edit form and
   * create form, served or not, in the order `layouts.json` first names the type.
   */
  readonly choices = computed<readonly LayoutChoiceGroup[]>(() => {
    const files = this.files();
    if (files.state !== 'read') return [];
    const served = new Set(files.value.map((file) => `${file.type}/${file.mode}`));
    return [...new Set(files.value.map((file) => file.type))].map((type) => ({
      type,
      choices: DESIGNED_MODES.map((mode) => ({
        type,
        mode,
        served: served.has(`${type}/${mode}`),
        key: `${type}/${mode}`,
      })),
    }));
  });

  /** The picker's choices: each type's three files, under the type, named as the picker names them. */
  protected readonly typeOptions = computed<readonly NxsSelectGroup[]>(() => {
    this.translationTick();
    return this.choices().map((group) => ({
      label: group.type,
      options: group.choices.map((choice) => ({
        value: choice.key,
        label: this.translate.instant(
          choice.served ? 'layout-designer.choice' : 'layout-designer.choice-new',
          { type: choice.type, mode: this.modeName(choice.mode) },
        ),
      })),
    }));
  });

  /** What a form's field may be: not required, always required, or required while a rule passes. */
  protected readonly requiredOptions = computed<readonly NxsSelectOption[]>(() => {
    this.translationTick();
    return (['no', 'always', 'rule'] as const).map((choice) => ({
      value: choice,
      label: this.translate.instant(`layout-designer.required-${choice}`),
    }));
  });

  /**
   * The file open, or being opened. Set again to the same file, it is read again: so that a file
   * that could not be read can be opened anew.
   */
  readonly current = signal<LayoutChoice | null>(null, { equal: () => false });

  /** The file chosen in the picker, which its button opens: the open one until another is chosen. */
  readonly fileChosen = linkedSignal<string>(() => this.current()?.key ?? '');

  /**
   * The file open, as the server serves it now, or a new one for a file it does not serve, with
   * the choice it is for: the type and mode below are the file's, so that a file is never checked
   * or drawn in the mode of the next one while that one is read.
   */
  private readonly opening = toSignal(
    toObservable(this.current).pipe(
      switchMap((choice) => {
        if (!choice) return of(null);
        const read: Observable<Reading<LayoutSource>> = choice.served
          ? this.service.source(choice.type, choice.mode)
          : of({ state: 'read', value: { url: '', content: newLayoutFile() } });
        return read.pipe(map((source) => ({ choice, source })));
      }),
    ),
    { initialValue: null },
  );

  readonly source = computed<Reading<LayoutSource> | null>(() => this.opening()?.source ?? null);

  /** The type whose file is open. */
  readonly type = computed(() => this.opening()?.choice.type ?? null);

  /** The mode of the file open: a record page until one is opened. */
  readonly mode = computed<DesignedMode>(() => this.opening()?.choice.mode ?? 'view');

  /** Whether the file open is a form's, edit or create. */
  readonly isForm = computed(() => isForm(this.mode()));

  /** Whether the file open is a new one, which the server does not serve. */
  readonly isNew = computed(() => this.opening()?.choice.served === false);

  /** The file's name, as a package holds it under `layouts/<Type>/`. */
  readonly fileName = computed(() => layoutFileName(this.mode()));

  /** Where the app's deployment layer holds the file open: `layouts/<Type>/<mode>.layout.json`. */
  readonly layerPath = computed(() => {
    const type = this.type();
    return type ? `layouts/${type}/${this.fileName()}` : null;
  });

  /** Why the file could not be opened: it could not be read, or what came is no file. */
  readonly sourceProblem = computed<string | null>(() => {
    const source = this.source();
    if (source?.state === 'failed') return source.problem;
    return source?.state === 'read' ? (source.value.problem ?? null) : null;
  });

  /** The file as it was opened, to go back to. */
  readonly opened = computed<LayoutJson | null>(() => {
    const source = this.source();
    return source?.state === 'read' && source.value.content ? source.value.content : null;
  });

  /** The file as it is now, with every change made to it. Opened anew with each file. */
  readonly file = linkedSignal<LayoutJson | null>(() => this.opened());

  /** The fields taken out of the file, to show again. None once another file is opened. */
  readonly hidden = linkedSignal<LayoutJson | null, readonly HiddenField[]>({
    source: this.opened,
    computation: () => [],
  });

  readonly changed = computed(() => {
    const file = this.file();
    const opened = this.opened();
    return file !== null && opened !== null && layoutFileText(file) !== layoutFileText(opened);
  });

  /**
   * Whether leaving the file would lose something: a change to it, or a field to show again. A new
   * file left as it was opened loses nothing: it is opened the same again.
   */
  readonly unsaved = computed(() => this.changed() || this.hidden().length > 0);

  readonly cards = computed<readonly DesignerCard[]>(() => cardsOf(this.file()));

  readonly records = toSignal(
    toObservable(this.type).pipe(
      switchMap((type) => (type ? this.service.records(type) : of(null))),
    ),
    { initialValue: null },
  );

  readonly recordList = computed<readonly RecordChoice[]>(() => {
    const records = this.records();
    return records?.state === 'read' ? records.value : [];
  });

  /** The records the preview may draw, by their titles. */
  protected readonly recordOptions = computed<readonly NxsSelectOption[]>(() =>
    this.recordList().map((record) => ({ value: record.uid, label: record.title })),
  );

  /** The record the preview draws: the first offered, until another is chosen. */
  readonly recordUid = linkedSignal<string | null>(() => {
    const records = this.records();
    return records?.state === 'read' ? (records.value[0]?.uid ?? null) : null;
  });

  readonly record = toSignal(
    toObservable(this.recordUid).pipe(
      switchMap((uid) => (uid ? this.service.record(uid) : of(null))),
    ),
    { initialValue: null },
  );

  private readonly recordDocument = computed<NuxeoDocument | null>(() => {
    const record = this.record();
    return record?.state === 'read' ? record.value : null;
  });

  /** What the file draws for the record, redrawn on every change: a record page, or a form. */
  readonly preview = toSignal(
    combineLatest([
      toObservable(this.file),
      toObservable(this.recordDocument),
      toObservable(this.mode),
    ]).pipe(
      switchMap(
        ([file, record, mode]): Observable<RecordPreviewShown | FormPreviewShown | null> => {
          if (!file || !record) return of(null);
          if (!isForm(mode)) {
            return this.service
              .preview(file, record)
              .pipe(map((preview): RecordPreviewShown => ({ record, preview })));
          }
          return this.service.previewForm(file, mode, record.type, record).pipe(
            map((preview): FormPreviewShown => ({
              mode,
              record,
              parentPath: parentPathOf(record.path),
              preview,
            })),
          );
        },
      ),
    ),
    { initialValue: null },
  );

  /** The record page the preview draws, when the file is one. */
  readonly recordPreview = computed<RecordPreviewShown | null>(() => {
    const shown = this.preview();
    return shown && !('mode' in shown) ? shown : null;
  });

  /** The form the preview draws, when the file is one. */
  readonly formPreview = computed<FormPreviewShown | null>(() => {
    const shown = this.preview();
    return shown && 'mode' in shown ? shown : null;
  });

  /** What the engine leaves out of the file, and why, in the words the console would have. */
  readonly previewNotes = computed<readonly string[]>(() => this.preview()?.preview.notes ?? []);

  /** Every finding of the validator, in the file's mode, held to the content model once it is read. */
  readonly findings = computed<readonly Finding[]>(() => {
    const file = this.file();
    const type = this.type();
    if (!file || !type) return [];
    const model = this.model();
    return validateLayoutV2(file, {
      mode: this.mode(),
      registries: this.registries,
      type,
      model: model.state === 'read' ? model.value : undefined,
    });
  });

  readonly saveState = computed<SaveState>(() => {
    if (!this.file()) return 'nothing';
    if (this.model().state === 'reading') return 'checking';
    return publishable(this.findings()) ? 'saveable' : 'refused';
  });

  /** The type's properties, its facets' included, by `<prefix>:<name>`: what a card may add. */
  readonly properties = computed<readonly string[] | null>(() => {
    const model = this.model();
    const type = this.type();
    if (model.state !== 'read' || !type) return null;
    return [...(propertiesOf(model.value, type)?.keys() ?? [])].sort();
  });

  /** What is chosen to add, card by card, by the card's place. */
  private readonly toAdd = linkedSignal<LayoutJson | null, Readonly<Record<string, string>>>({
    source: this.opened,
    computation: () => ({}),
  });

  /** The words the picker and the headings use for a mode: "record page", "edit form". */
  modeName(mode: DesignedMode): string {
    return this.translate.instant(`layout-designer.mode.${mode}`);
  }

  /**
   * Opens the file `key` names, `<Type>/<mode>`, once the person agrees to lose the changes to the
   * one open, if any.
   */
  open(key: string): void {
    const choice = this.choices()
      .flatMap((group) => group.choices)
      .find((each) => each.key === key);
    // The file open is not opened again, but one that could not be read is read again.
    if (!choice || (choice.key === this.current()?.key && this.sourceProblem() === null)) return;
    this.discard()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((agreed) => {
        if (agreed) this.current.set(choice);
        else this.fileChosen.set(this.current()?.key ?? '');
      });
  }

  /**
   * Whether the page may be left: at once with nothing to lose, else once the person agrees. The
   * route's `canDeactivate` asks it, so that a link in the preview or the menu loses nothing unasked.
   */
  leave(): Observable<boolean> {
    return this.discard();
  }

  /** Asks the browser to confirm reloading or closing the tab while there is something to lose. */
  protected holdUnload(event: BeforeUnloadEvent): void {
    if (this.unsaved()) event.preventDefault();
  }

  private discard(): Observable<boolean> {
    const current = this.current();
    if (!this.unsaved() || !current) return of(true);
    const data: NxsConfirmDialogData = {
      title: this.translate.instant('layout-designer.discard-title'),
      message: this.translate.instant('layout-designer.discard-message', {
        type: current.type,
        mode: this.modeName(current.mode),
      }),
      confirmLabel: this.translate.instant('layout-designer.discard'),
    };
    return this.dialog
      .open(NxsConfirmDialogComponent, { data })
      .afterClosed()
      .pipe(map((agreed) => agreed === true));
  }

  chooseRecord(uid: string): void {
    this.recordUid.set(uid === '' ? null : uid);
  }

  /** Moves the field up one place. The focus goes with it, so that pressing again moves it on. */
  moveUp(card: DesignerCard, field: DesignerField): void {
    this.edit((file) => moveField(file, card.place, field.index, field.index - 1));
    this.focusField(card.path, field.index - 1, ['up', 'down']);
  }

  moveDown(card: DesignerCard, field: DesignerField): void {
    this.edit((file) => moveField(file, card.place, field.index, field.index + 1));
    this.focusField(card.path, field.index + 1, ['down', 'up']);
  }

  /** Takes the field out of the file, to show again. The focus goes to the next field, or the last. */
  hide(card: DesignerCard, field: DesignerField): void {
    const file = this.file();
    if (!file) return;
    const { file: next, entry } = removeField(file, card.place, field.index);
    if (entry === undefined) return;
    this.file.set(next);
    this.hidden.update((hidden) => [
      ...hidden,
      {
        place: card.place,
        index: field.index,
        entry,
        cardId: card.id,
        name: this.fieldName(field),
      },
    ]);
    const left = card.fields.length - 1;
    if (left > 0) this.focusField(card.path, Math.min(field.index, left - 1), ['hide']);
    else this.focusIn('.layout-designer__hidden li:last-child', '[data-action="show"] button');
  }

  /** Puts the field back where it was, the focus on it. */
  show(field: HiddenField): void {
    this.edit((file) => insertField(file, field.place, field.index, field.entry));
    this.hidden.update((hidden) => hidden.filter((each) => each !== field));
    const card = this.cards().find(
      (each) => each.place.tab === field.place.tab && each.place.card === field.place.card,
    );
    if (card) {
      this.focusField(card.path, Math.min(field.index, card.fields.length - 1), ['hide']);
    }
  }

  setText(card: DesignerCard, key: CardText, value: string): void {
    this.edit((file) => setCardText(file, card.place, key, value));
  }

  /** What the field's `required` is, as the designer offers it. */
  requiredOf(field: DesignerField): RequiredChoice {
    return requiredChoice(field.rules.required);
  }

  /**
   * Makes the field not required, always required, or required while a rule passes. A rule chosen
   * for a field with none is written empty, which the validator refuses until the rule is written.
   */
  setRequired(card: DesignerCard, field: DesignerField, choice: string): void {
    const current = field.rules.required;
    let value: unknown;
    if (choice === 'always') value = true;
    else if (choice === 'rule') value = requiredChoice(current) === 'rule' ? current : '';
    else value = undefined;
    this.edit((file) => setFieldRule(file, card.place, field.index, 'required', value));
  }

  /** The field's rule for `key`, as it is edited: an ID as it is, a rule as JSON. */
  ruleOf(field: DesignerField, key: FieldRuleKey): string {
    return ruleText(field.rules[key]);
  }

  /**
   * Sets the field's rule for `key` from the text written: none takes the key out, but for
   * `required`, whose rule stays to be written while "a rule" is chosen. Whatever is written goes
   * into the file, and the validator says whether it is a rule.
   */
  setRule(card: DesignerCard, field: DesignerField, key: FieldRuleKey, text: string): void {
    const rule = ruleFromText(text);
    const value = key === 'required' && rule === undefined ? '' : rule;
    this.edit((file) => setFieldRule(file, card.place, field.index, key, value));
  }

  /** How many of the field's rules the file sets, for its summary. */
  rulesSet(field: DesignerField): number {
    const keys: readonly FieldRuleKey[] =
      this.isForm() && field.kind === 'property'
        ? ['required', 'readOnlyWhen', 'visibleWhen']
        : ['visibleWhen'];
    return keys.filter((key) => field.rules[key] !== undefined && field.rules[key] !== false)
      .length;
  }

  /** The properties a card may add: the type's, less those the card shows already. */
  addable(card: DesignerCard): readonly string[] {
    const shown = new Set(
      card.fields.flatMap((field) => (field.kind === 'property' && field.name ? [field.name] : [])),
    );
    return (this.properties() ?? []).filter((xpath) => !shown.has(xpath));
  }

  /** The add picker's choices for the card: the properties it may add, by their xpaths. */
  protected addOptions(card: DesignerCard): readonly NxsSelectOption[] {
    return this.addable(card).map((xpath) => ({ value: xpath, label: xpath }));
  }

  chosen(card: DesignerCard): string {
    return this.toAdd()[card.path] ?? '';
  }

  choose(card: DesignerCard, xpath: string): void {
    this.toAdd.update((chosen) => ({ ...chosen, [card.path]: xpath }));
  }

  /** Adds the chosen property as the card's last field, the focus on it, to move it from there. */
  add(card: DesignerCard): void {
    const xpath = this.chosen(card);
    if (xpath === '') return;
    this.edit((file) => addProperty(file, card.place, xpath));
    this.toAdd.update((chosen) => ({ ...chosen, [card.path]: '' }));
    this.focusField(card.path, card.fields.length, ['up', 'hide']);
  }

  /** Back to the file as it was opened, the focus on the editor's heading, above the first card. */
  reset(): void {
    this.file.set(this.opened());
    this.hidden.set([]);
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>('#layout-designer-editor')?.focus(),
      { injector: this.injector },
    );
  }

  /**
   * Saves the file to the browser's downloads, as a package holds it. Refused, whatever the button
   * shows, unless the validator finds nothing: held to the content model once it is read, or, when
   * the model cannot be read, without it, as the page then says.
   */
  download(): void {
    const file = this.file();
    if (!file || this.saveState() !== 'saveable') return;
    downloadJson(this.fileName(), layoutFileText(file), this.document);
  }

  /**
   * Opens a version of the file from the app's deployment layer, its draft or its live version, as
   * the file being edited: a change to the one opened from the server, which the page then checks
   * and previews as any other, and asks before losing.
   */
  openFromLayer(content: unknown): void {
    if (typeof content === 'object' && content !== null && !Array.isArray(content))
      this.file.set(content as LayoutJson);
  }

  /** The file as the download writes it, for the page to show. */
  readonly fileText = computed(() => {
    const file = this.file();
    return file ? layoutFileText(file) : '';
  });

  /** What the designer calls a field: its property, its computed id, or its place. */
  fieldName(field: DesignerField): string {
    return field.name ?? `fields[${field.index}]`;
  }

  protected failed<T>(reading: Reading<T> | null): string | null {
    return reading?.state === 'failed' ? reading.problem : null;
  }

  private edit(change: (file: LayoutJson) => LayoutJson): void {
    const file = this.file();
    if (file) this.file.set(change(file));
  }

  /**
   * Once the page is drawn again, the focus on the first of `actions` that is offered, in the
   * card's field at `index`. The rows are kept by their place, so without this the focus would
   * stay where the moved field was, on the field that took its place.
   */
  private focusField(cardPath: string, index: number, actions: readonly string[]): void {
    this.focusIn(
      `[data-card="${cardPath}"] .layout-designer__fields > li:nth-child(${index + 1})`,
      ...actions.map((action) => `[data-action="${action}"] button`),
    );
  }

  /**
   * Once the page is drawn again, the focus on the first button `buttons` names in `container`
   * that is offered. Each names the native `button` inside an `nxs-` button, since that, not the
   * element, is what takes the focus.
   */
  private focusIn(container: string, ...buttons: readonly string[]): void {
    afterNextRender(
      () => {
        const within = this.host.nativeElement.querySelector(container);
        for (const selector of buttons) {
          const button = within?.querySelector<HTMLButtonElement>(selector);
          if (button && !button.disabled) {
            button.focus();
            return;
          }
        }
      },
      { injector: this.injector },
    );
  }
}
