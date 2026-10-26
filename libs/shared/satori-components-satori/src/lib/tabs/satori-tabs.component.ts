import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  model,
  untracked,
  viewChildren,
  type TemplateRef,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { SatNavigationTab, SatNavigationTabs } from '@hylandsoftware/satori-ui/navigation-tabs';
import type { NxsTab, NxsTabBodyContext, NxsTabsInputs } from '@nuxeo/satori-platform/components';

let nextId = 0;

/**
 * `nxs.primitives.tabs` on Satori's `sat-navigation-tabs`.
 *
 * Satori's tabs are a strip of links that show no panel of their own, so this renders the selected
 * tab's body under the strip, as the `tabpanel` its tab names. It also makes the strip work from
 * the keyboard as Material's does: Enter and Space select the focused tab, which an anchor with no
 * `href` would not do, and the selected tab is the strip's tab stop.
 */
@Component({
  selector: 'nxs-satori-tabs',
  standalone: true,
  templateUrl: './satori-tabs.component.html',
  styleUrl: './satori-tabs.component.scss',
  imports: [NgTemplateOutlet, MatIconModule, SatNavigationTabs, SatNavigationTab],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-satori-tabs' },
})
export class NxsSatoriTabsComponent implements NxsTabsInputs {
  readonly tabs = input.required<readonly NxsTab[]>();
  /** The tab list's accessible name, already translated. Optional. */
  readonly label = input('');
  /** The selected tab's position. Two-way. Past the last tab selects the last. */
  readonly selectedIndex = model(0);
  /** The template every tab's body renders from, given the tab as `let-tab`. */
  readonly body = input<TemplateRef<NxsTabBodyContext> | null>(null);
  /**
   * Called with the selected tab and its position whenever the selection changes — the user
   * choosing a tab, or the host moving `selectedIndex` — but not for the first selection.
   */
  readonly selectHandler = input<((tab: NxsTab, index: number) => void) | null>(null);

  /** The selection, kept within the tabs there are, as Material's tab group keeps it. */
  protected readonly shown = computed(() =>
    Math.max(0, Math.min(this.selectedIndex(), this.tabs().length - 1)),
  );
  protected readonly shownTab = computed<NxsTab | null>(() => this.tabs()[this.shown()] ?? null);
  protected readonly ownLabel = computed(() => this.label().trim());

  private readonly idPrefix = `nxs-satori-tabs-${nextId++}`;
  protected readonly panelId = `${this.idPrefix}-panel`;

  private readonly links = viewChildren(SatNavigationTab);

  constructor() {
    // Satori makes its first tab the strip's tab stop once, as it starts, and moves the stop only
    // on arrow keys. A selection other than the first tab, or a tab list that changes afterwards,
    // would leave the stop on an unselected tab or on none. `tabindex` is the signal Satori's own
    // arrow keys write; marked internal upstream, so a Satori upgrade that renames it fails here.
    effect(() => {
      const shown = this.shown();
      this.links().forEach((link, index) => link.tabindex.set(index === shown ? 0 : -1));
    });

    // Material's tab group reports every change of selection but the first, whoever made it, so
    // `selectHandler` is called the same way here.
    let previous: number | null = null;
    effect(() => {
      const index = this.shown();
      const tab = this.shownTab();
      const changed = previous !== null && index !== previous;
      previous = index;
      if (changed && tab) untracked(() => this.selectHandler()?.(tab, index));
    });
  }

  protected tabId(index: number): string {
    return `${this.idPrefix}-tab-${index}`;
  }

  protected select(index: number): void {
    this.selectedIndex.set(index);
  }
}
