import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';

import { SearchService, type SavedSearchOption } from '@nuxeo-satori/platform/nuxeo-client';

/** A saved search the user chose: its id and its title. */
export interface NxsSavedSearchChoice {
  readonly id: string;
  readonly title: string;
}

let nextId = 0;

/**
 * The saved searches the user can open — the list at the top of Web UI's search form.
 *
 * Lists the saved searches the server returns for `pageProvider`: the user's own and those shared
 * with them. It reads the list when it is first opened and again when `refresh` changes, narrows it
 * as the user types, and emits the one chosen. Loading that search's filters is the host's job.
 */
@Component({
  selector: 'nxs-saved-search-select',
  standalone: true,
  templateUrl: './saved-search-select.component.html',
  styleUrl: './saved-search-select.component.scss',
  imports: [MatAutocompleteModule, MatIconModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-saved-search-select' },
})
export class NxsSavedSearchSelectComponent {
  /** The saved search open now, or an empty string for none. */
  readonly selectedId = input('');
  /** Its title, shown in the box. */
  readonly selectedTitle = input('');
  /** The page provider whose saved searches are listed. */
  readonly pageProvider = input('default_search');
  /** Change it to read the list again — after a search is saved, renamed or deleted. */
  readonly refresh = input(0);
  /** The user chose a saved search. */
  readonly selectedChange = output<NxsSavedSearchChoice>();

  private readonly searchService = inject(SearchService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly inputId = `nxs-saved-search-select-${nextId++}`;
  protected readonly text = signal('');
  protected readonly searches = signal<readonly SavedSearchOption[]>([]);
  protected readonly state = signal<'idle' | 'loading' | 'loaded'>('idle');

  /** The saved searches whose title contains what is typed, unless it is the open one's title. */
  protected readonly options = computed(() => {
    const term = this.text().trim().toLowerCase();
    const all = this.searches();
    if (!term || term === this.selectedTitle().trim().toLowerCase()) return all;
    return all.filter((search) => search.title.toLowerCase().includes(term));
  });

  constructor() {
    effect(() => {
      const title = this.selectedTitle();
      untracked(() => this.text.set(title));
    });
    // A new `refresh` drops the list, so the next opening reads it again; an open panel reads now.
    let first = true;
    effect(() => {
      this.refresh();
      this.pageProvider();
      if (first) {
        first = false;
        return;
      }
      untracked(() => {
        const wasLoaded = this.state() !== 'idle';
        this.state.set('idle');
        if (wasLoaded) this.load();
      });
    });
  }

  /** Reads the list, unless it is loading or already read. */
  protected load(): void {
    if (this.state() !== 'idle') return;
    this.state.set('loading');
    this.searchService
      .getSavedSearches(this.pageProvider())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((searches) => {
        this.searches.set(searches);
        this.state.set('loaded');
      });
  }

  protected onInput(value: string): void {
    this.text.set(value);
  }

  protected choose(id: string): void {
    const search = this.searches().find((entry) => entry.id === id);
    if (!search) return;
    this.text.set(search.title);
    this.selectedChange.emit({ id: search.id, title: search.title });
  }

  /** Puts the open search's title back when the box is left without a choice. */
  protected restore(): void {
    this.text.set(this.selectedTitle());
  }

  protected readonly display = (id: string | null): string =>
    this.searches().find((entry) => entry.id === id)?.title ?? this.selectedTitle();
}
