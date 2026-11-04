import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  computed,
  input,
  linkedSignal,
  output,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { TranslatePipe } from '@ngx-translate/core';

import { nxsVisibleText } from '../visible-text';

/** The ID the host renders the asset facets under, through `lib-extension-outlet`. */
export const NXS_ASSET_FACETS_DRAWER_ID = 'nxs.components.assetFacetsDrawer';

let nextId = 0;

/** One choice within a facet group. */
export interface NxsFacetChoice {
  /** The bucket key the host filters by. Unique within its group. */
  readonly value: string;
  /** What to show, already translated and already resolved from any vocabulary. */
  readonly label: string;
  /** Whether this choice is currently filtering the search. */
  readonly selected: boolean;
  /**
   * Results in this bucket as the server counted them, shown after the label. `null` shows no
   * count — the server sent no bucket, and the host has decided not to claim zero.
   */
  readonly count: number | null;
}

/** One collapsible group of facet choices. */
export interface NxsFacetGroup {
  /** Identifies the group in `optionToggle` and in the expansion state. */
  readonly id: string;
  /** The group's heading, already translated. */
  readonly label: string;
  /** The choices, in the order they are offered. */
  readonly options: readonly NxsFacetChoice[];
  /**
   * Whether the group's choices come from the server's aggregates rather than a fixed list.
   *
   * It changes only what an **empty** group says: a dynamic group with nothing in it says so,
   * because the server answered and had no buckets, while a fixed group with nothing in it is
   * still loading and says nothing at all.
   */
  readonly dynamic: boolean;
}

/** A choice the user flipped. */
export interface NxsFacetSelection {
  readonly groupId: string;
  readonly value: string;
}

/** The three buttons in the footer, as one event rather than three. */
export type NxsAssetFacetsAction = 'reset' | 'save-as' | 'search';

/**
 * The faceted filter panel of the assets drawer: a full-text box, a collapsible group per facet with
 * its choices and their result counts, and a footer that resets, saves the search, or runs it.
 *
 * It reads nothing, fetches nothing and navigates nowhere. The host owns the aggregates, the query
 * and the saved searches; the panel shows what it is given and reports what the user did. That is
 * what lets the assets drawer and any other faceted screen share one panel instead of each growing
 * its own list of checkboxes.
 *
 * **Which group is open is the panel's own business.** It is view state, not search state: nothing
 * outside depends on it and nothing needs to persist it, so the panel keeps it rather than making
 * every host carry a `Set` it never reads. `initiallyExpandedGroupIds` seeds it.
 */
@Component({
  selector: 'nxs-asset-facets-drawer',
  standalone: true,
  templateUrl: './asset-facets-drawer.component.html',
  styleUrl: './asset-facets-drawer.component.scss',
  imports: [
    MatButtonModule,
    MatCheckboxModule,
    MatDividerModule,
    MatIconModule,
    MatSlideToggleModule,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-asset-facets-drawer' },
})
export class NxsAssetFacetsDrawerComponent {
  /** The facet groups, in the order they are shown. */
  readonly groups = input<readonly NxsFacetGroup[]>([]);
  /** What is in the full-text box. The host owns the value and passes it back. */
  readonly fullText = input('');
  /** Whether a changed facet searches immediately. With `false`, the Search button appears. */
  readonly autoSearch = input(true, { transform: booleanAttribute });
  /** Whether anything is filtered, which is what makes "Save as" worth offering. */
  readonly canSaveAs = input(false, { transform: booleanAttribute });
  /**
   * The panel's accessible name, already translated. Blank, or only whitespace or zero-width
   * characters, names it "Asset filters".
   */
  readonly label = input('');
  /** Which groups start open. Read once per change, then the panel owns the state. */
  readonly initiallyExpandedGroupIds = input<readonly string[]>([]);

  /**
   * The full-text box as it is typed in — the same fact as `fullTextChange`, as a callback.
   *
   * The callback forms exist because `lib-extension-outlet` sets **inputs only**: a host rendering
   * this panel through `NXS_ASSET_FACETS_DRAWER_ID` cannot bind an output, so it passes handlers,
   * exactly as the trash list takes `openHandler`. A host with the element in its own template
   * binds the outputs instead. Every interaction does both, so neither path is the special case.
   */
  readonly fullTextChangeHandler = input<((value: string) => void) | null>(null);
  /** The full-text box submitted, trimmed — the same fact as `fullTextSubmit`, as a callback. */
  readonly fullTextSubmitHandler = input<((value: string) => void) | null>(null);
  /** A choice was flipped — the same fact as `optionToggle`, as a callback. */
  readonly optionToggleHandler = input<((selection: NxsFacetSelection) => void) | null>(null);
  /** The auto-search switch moved — the same fact as `autoSearchChange`, as a callback. */
  readonly autoSearchChangeHandler = input<((autoSearch: boolean) => void) | null>(null);
  /** A footer button was pressed — the same fact as `action`, as a callback. */
  readonly actionHandler = input<((action: NxsAssetFacetsAction) => void) | null>(null);

  /** The full-text box as it is typed in. */
  readonly fullTextChange = output<string>();
  /** The full-text box submitted — Enter, or cleared. The host searches. */
  readonly fullTextSubmit = output<string>();
  /** A choice was flipped. The host owns the selection and applies it. */
  readonly optionToggle = output<NxsFacetSelection>();
  /** The auto-search toggle was moved. */
  readonly autoSearchChange = output<boolean>();
  /** A footer button was pressed. */
  readonly action = output<NxsAssetFacetsAction>();

  /**
   * The text in the box. A `linkedSignal` so typing shows immediately without waiting for the host
   * to echo the value back, while a new `fullText` from the host — a saved search being loaded, or
   * the query string changing — still replaces what is there.
   */
  protected readonly text = linkedSignal(() => this.fullText());

  /**
   * Which groups are open.
   *
   * A `linkedSignal` on the input rather than a plain signal seeded in the constructor: a signal
   * input is not set yet when the constructor runs, so seeding there would read the default and
   * open nothing. It also must not be an "empty means use the seed" sentinel — that reads
   * *everything closed* as *not seeded yet*, so collapsing the last group would spring the seeded
   * ones back open.
   */
  protected readonly expanded = linkedSignal<readonly string[], ReadonlySet<string>>({
    source: this.initiallyExpandedGroupIds,
    computation: (ids) => new Set(ids),
  });

  /**
   * Element IDs, numbered per instance. Two panels can be on one page — an outlet renders one while
   * a screen keeps its own — and a hardcoded `id` would then point both `for=` labels and both
   * `aria-controls` at the first panel's elements, silently unnaming the second's controls.
   */
  protected readonly ids = (() => {
    const base = `nxs-asset-facets-${nextId++}`;
    return {
      fulltext: `${base}-fulltext`,
      autoLabel: `${base}-auto-label`,
      group: (id: string) => `${base}-group-${id}`,
    };
  })();

  protected readonly ownLabel = computed(() => nxsVisibleText(this.label()));
  protected readonly hasText = computed(() => this.text().trim().length > 0);

  protected isExpanded(id: string): boolean {
    return this.expanded().has(id);
  }

  protected toggleGroup(id: string): void {
    this.expanded.update((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** ` (12)`, or nothing when the host passed no count. */
  protected countText(choice: NxsFacetChoice): string {
    return choice.count === null ? '' : ` (${choice.count})`;
  }

  protected onText(value: string): void {
    this.text.set(value);
    this.fullTextChange.emit(value);
    this.fullTextChangeHandler()?.(value);
  }

  protected submitText(): void {
    const value = this.text().trim();
    this.fullTextSubmit.emit(value);
    this.fullTextSubmitHandler()?.(value);
  }

  protected clearText(): void {
    this.onText('');
    this.submitText();
  }

  protected toggleOption(groupId: string, value: string): void {
    const selection: NxsFacetSelection = { groupId, value };
    this.optionToggle.emit(selection);
    this.optionToggleHandler()?.(selection);
  }

  protected setAutoSearch(autoSearch: boolean): void {
    this.autoSearchChange.emit(autoSearch);
    this.autoSearchChangeHandler()?.(autoSearch);
  }

  protected run(action: NxsAssetFacetsAction): void {
    this.action.emit(action);
    this.actionHandler()?.(action);
  }
}
