import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { NxsEmptyStateComponent } from '@nuxeo/satori-platform/components';
import {
  ExtensionRuleContextService,
  ExtensionRuleRegistry,
  type ExtensionRuleContext,
} from '@nuxeo/satori-platform/extensions';
import { map, merge, type Observable } from 'rxjs';

import { figureOf, requestKey, type Figure } from '../figures';
import { readHome, type HomeCard, type HomeFile, type ReadHome } from '../home-file';
import { HOME_QUEUE_LINK, HOME_TASKS_LINK, HomeService } from '../home.service';
import { recordItem, taskItem, type ListItem, type RouterTarget } from '../lists';

type State =
  | { readonly kind: 'loading' }
  | { readonly kind: 'none' }
  | { readonly kind: 'refused' }
  | { readonly kind: 'home'; readonly home: HomeFile };

/** A page provider's results, or why there are none. */
type Results =
  { readonly ok: true; readonly body: unknown } | { readonly ok: false; readonly reason: string };

/** A list card's tasks or records, or why there are none. */
type ListResults =
  | { readonly ok: true; readonly items: readonly ListItem[] }
  | { readonly ok: false; readonly reason: string };

/** One task or record as the page draws it, its date written for the person's language. */
interface DrawnItem extends ListItem {
  readonly when: string | null;
}

/** A list card's content: the person's tasks, or their recent records. */
interface DrawnList {
  readonly of: 'tasks' | 'recent';
  readonly state: 'loading' | 'failed' | 'empty' | 'items';
  readonly items: readonly DrawnItem[];
  /** The tasks page, for a list of tasks; `null` for a list of records. */
  readonly more: RouterTarget | null;
}

/** A card as the page draws it, its numbers written for the person's language. */
interface DrawnCard {
  readonly id: string;
  readonly title: string;
  /** `link`: a card that is only a link to a queue; `list`: a list of tasks or of records. */
  readonly kind: 'link' | 'loading' | 'unavailable' | 'figure' | 'list';
  readonly value: string | null;
  readonly buckets: readonly { readonly key: string; readonly count: string }[];
  /** Whether the server returned only an aggregate's largest buckets. */
  readonly truncated: boolean;
  /** Why the figure, or the list, is unavailable, for the console. */
  readonly reason: string | null;
  readonly link: RouterTarget | null;
  readonly list: DrawnList | null;
}

function warn(message: string): void {
  console.warn(`[agentic-ui-home] ${message}`);
}

/**
 * The home: an app's `home.json` drawn as cards (docs/business-apps/app-definition-v2.md,
 * section 10). Each card shows when its rule holds for the person signed in, with their groups and
 * no record, so a home per group is cards whose rule is `app.rules.inGroup`. A KPI counts a page
 * provider's results, or the documents in one of its aggregates' buckets, or lists the buckets. A
 * list shows the person's open tasks, newest first, or the records they created or edited last.
 *
 * A card's rule decides what this page shows, and nothing else: a figure counts only what the
 * page provider returns to this person, a list holds only what the server returns to them, and
 * hiding a card hides no record.
 */
@Component({
  selector: 'lib-home-page',
  standalone: true,
  imports: [RouterLink, TranslatePipe, NxsEmptyStateComponent],
  templateUrl: './home-page.html',
  styleUrl: './home-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomePageComponent {
  private readonly homes = inject(HomeService);
  private readonly rules = inject(ExtensionRuleRegistry);
  private readonly ruleContext = inject(ExtensionRuleContextService);
  private readonly translate = inject(TranslateService);
  private readonly queueLink = inject(HOME_QUEUE_LINK);
  private readonly tasksLink = inject(HOME_TASKS_LINK);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly state = signal<State>({ kind: 'loading' });
  private readonly results = signal<ReadonlyMap<string, Results>>(new Map());
  private readonly requested = new Set<string>();
  /** Each list card's tasks or records, by the card's id. */
  private readonly lists = signal<ReadonlyMap<string, ListResults>>(new Map());
  private readonly listed = new Set<string>();
  /** What the console has been told, so that a page drawn again does not repeat it. */
  private readonly told = new Set<string>();

  /** Bumped when the language or a catalogue changes, so titles resolved with `instant` follow. */
  private readonly translations = signal(0);

  /** The context the cards' rules see: the person and their groups, and no record. */
  private readonly context = computed<ExtensionRuleContext>(() => ({
    ...this.ruleContext.context(),
    document: null,
    selection: [],
    selectionCount: 0,
  }));

  /** The cards whose rule holds, in the file's order. */
  private readonly shownCards = computed<readonly HomeCard[]>(() => {
    const state = this.state();
    if (state.kind !== 'home') return [];
    const context = this.context();
    return state.home.cards.filter((card) => this.rules.evaluate(card.visibleWhen, context));
  });

  /** The home's own title, or `null` for the platform's. */
  protected readonly title = computed(() => {
    this.translations();
    const state = this.state();
    return state.kind === 'home' ? this.text(state.home.label, state.home.labelKey) : null;
  });

  protected readonly cards = computed<readonly DrawnCard[]>(() => {
    this.translations();
    const results = this.results();
    const lists = this.lists();
    const drawn: DrawnCard[] = [];
    for (const card of this.shownCards()) {
      if (card.tasks !== null || card.recent !== null) {
        const list = this.drawList(card, lists.get(card.id));
        if (list !== null) drawn.push(list);
        continue;
      }
      const link = card.queue !== null && this.queueLink ? this.queueLink(card.queue) : null;
      if (card.kpi === null) {
        // A card that is only a link to a queue waits for the app's queue page.
        if (link === null) continue;
        drawn.push({
          id: card.id,
          title: this.text(card.label, card.labelKey) || (card.queue as string),
          kind: 'link',
          value: null,
          buckets: [],
          truncated: false,
          reason: null,
          link,
          list: null,
        });
        continue;
      }
      const answer = results.get(requestKey(card.kpi));
      const figure: Figure | null =
        answer === undefined
          ? null
          : answer.ok
            ? figureOf(card.kpi, answer.body)
            : { kind: 'unavailable', reason: answer.reason };
      drawn.push({
        id: card.id,
        // An empty name, which the validator lets through, falls back too.
        title: this.text(card.label, card.labelKey) || card.labelKey || card.id,
        kind:
          figure === null ? 'loading' : figure.kind === 'unavailable' ? 'unavailable' : 'figure',
        value: figure && figure.kind !== 'unavailable' ? this.format(figure.value) : null,
        buckets:
          figure?.kind === 'buckets'
            ? figure.buckets.map((bucket) => ({
                key: bucket.key,
                count: this.format(bucket.count),
              }))
            : [],
        truncated: figure?.kind === 'buckets' && figure.truncated,
        reason: figure?.kind === 'unavailable' ? figure.reason : null,
        link,
        list: null,
      });
    }
    return drawn;
  });

  constructor() {
    merge(this.translate.onLangChange, this.translate.onTranslationChange)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.translations.update((n) => n + 1));

    this.homes
      .load()
      .pipe(takeUntilDestroyed())
      .subscribe((load) => {
        if (load.kind === 'none') {
          this.state.set({ kind: 'none' });
          return;
        }
        if (load.kind === 'unreadable') {
          warn(`home.json not loaded: ${load.reason}`);
          this.state.set({ kind: 'refused' });
          return;
        }
        let read: ReadHome;
        try {
          read = readHome(load.content, this.rules.registeredRuleIds());
        } catch (error) {
          // Whatever a file does to the reader, the page says it could not be read, rather than
          // stay loading.
          const reason = error instanceof Error ? error.message : String(error);
          warn(`home.json refused: it could not be read: ${reason}`);
          this.state.set({ kind: 'refused' });
          return;
        }
        if ('refused' in read) {
          for (const problem of read.refused) warn(`home.json refused: ${problem}`);
          this.state.set({ kind: 'refused' });
          return;
        }
        for (const problem of read.problems) warn(`home.json ${problem}`);
        // Every card left out is a home that could not be read, not one with nothing for this person.
        if (read.home.cards.length === 0) {
          warn('home.json refused: every card is left out');
          this.state.set({ kind: 'refused' });
          return;
        }
        if (this.queueLink === null && read.home.cards.some((card) => card.queue !== null))
          warn('the app has no queue page yet, so the links to queues are not drawn');
        if (this.tasksLink === null && read.home.cards.some((card) => card.tasks !== null))
          warn('the app has no tasks page, so the lists of tasks are not drawn');
        this.state.set({ kind: 'home', home: read.home });
      });

    // Ask for the results of the cards that show, once for each page provider and parameters, and
    // for each list that shows, once. A card that is hidden asks for nothing.
    effect(() => {
      const cards = this.shownCards();
      untracked(() => {
        for (const card of cards) {
          if (card.kpi) this.request(card);
          else if (card.recent !== null || (card.tasks !== null && this.tasksLink !== null))
            this.requestList(card);
        }
      });
    });

    // Say once why a figure or a list is unavailable.
    effect(() => {
      for (const card of this.cards()) {
        if (card.reason === null) continue;
        const message = `card "${card.id}": ${card.reason}`;
        if (this.told.has(message)) continue;
        this.told.add(message);
        warn(message);
      }
    });
  }

  private format(value: number): string {
    try {
      return new Intl.NumberFormat(this.translate.getCurrentLang() || undefined).format(value);
    } catch {
      return String(value);
    }
  }

  private request(card: HomeCard): void {
    const kpi = card.kpi;
    if (!kpi) return;
    const key = requestKey(kpi);
    if (this.requested.has(key)) return;
    this.requested.add(key);
    this.homes
      .results(kpi)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (body) => this.answer(key, { ok: true, body }),
        error: (error: unknown) =>
          this.answer(key, {
            ok: false,
            reason: `the page provider "${kpi.pageProvider}" was not read: ${(error as Error).message}`,
          }),
      });
  }

  private answer(key: string, results: Results): void {
    this.results.update((all) => new Map(all).set(key, results));
  }

  /** Read a list card's tasks or records, once. */
  private requestList(card: HomeCard): void {
    if (this.listed.has(card.id)) return;
    this.listed.add(card.id);
    const tasksLink = this.tasksLink;
    let items: Observable<readonly ListItem[]>;
    let what: string;
    if (card.tasks !== null && tasksLink !== null) {
      items = this.homes
        .tasks(card.tasks)
        .pipe(map((tasks) => tasks.map((task) => taskItem(task, tasksLink))));
      what = 'the tasks were not read';
    } else if (card.recent !== null) {
      items = this.homes
        .recent(card.recent)
        .pipe(map((records) => records.map((record) => recordItem(record))));
      what = 'the recent records were not read';
    } else return;
    items.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (found) => this.listAnswer(card.id, { ok: true, items: found }),
      error: (error: unknown) =>
        this.listAnswer(card.id, { ok: false, reason: `${what}: ${(error as Error).message}` }),
    });
  }

  private listAnswer(id: string, results: ListResults): void {
    this.lists.update((all) => new Map(all).set(id, results));
  }

  /**
   * A list card as the page draws it, or `null` for a list of tasks in a host with no tasks page.
   * Its title is its own, or the platform's name for the list.
   */
  private drawList(card: HomeCard, answer: ListResults | undefined): DrawnCard | null {
    const of = card.tasks !== null ? 'tasks' : 'recent';
    if (of === 'tasks' && this.tasksLink === null) return null;
    const items: DrawnItem[] =
      answer?.ok === true
        ? answer.items.map((item) => ({ ...item, when: this.day(item.date) }))
        : [];
    return {
      id: card.id,
      title:
        this.text(card.label, card.labelKey) ||
        this.text(null, of === 'tasks' ? 'home.tasks.title' : 'home.recent.title') ||
        card.id,
      kind: 'list',
      value: null,
      buckets: [],
      truncated: false,
      reason: answer?.ok === false ? answer.reason : null,
      link: null,
      list: {
        of,
        state:
          answer === undefined
            ? 'loading'
            : !answer.ok
              ? 'failed'
              : items.length === 0
                ? 'empty'
                : 'items',
        items,
        more: of === 'tasks' && this.tasksLink !== null ? this.tasksLink() : null,
      },
    };
  }

  /**
   * An instant as the person's language writes its day, in the browser's time zone, the zone the
   * person reads it in; `null` for one that cannot be read. A language the browser does not know
   * falls back to the browser's own, in the same zone.
   */
  private day(date: string | null): string | null {
    if (date === null) return null;
    const time = Date.parse(date);
    if (Number.isNaN(time)) return null;
    const options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' };
    try {
      return new Intl.DateTimeFormat(this.translate.getCurrentLang() || undefined, options).format(
        time,
      );
    } catch {
      return new Intl.DateTimeFormat(undefined, options).format(time);
    }
  }

  /** The literal, which wins, else the key's translation, else `null`. */
  private text(label: string | null, labelKey: string | null): string | null {
    if (label !== null && label !== '') return label;
    if (labelKey === null) return null;
    const translated: unknown = this.translate.instant(labelKey);
    return typeof translated === 'string' && translated !== labelKey ? translated : null;
  }
}
