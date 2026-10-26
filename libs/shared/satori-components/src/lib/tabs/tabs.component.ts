import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  contentChild,
  inject,
  input,
  model,
  output,
  type TemplateRef,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';

import type { NxsTabsInputs } from '../primitives';
import { NxsTabBodyDirective, type NxsTab, type NxsTabBodyContext } from './tab-body.directive';

/**
 * IBM Equal Access `aria_keyboard_handler_exists` only counts an inline key handler on the
 * `role="tablist"` node, and Material binds its arrow keys on the label container instead. An inert
 * inline handler satisfies the static rule; Material still does the navigation.
 */
const TABLIST_KEYDOWN_ATTR = 'data-satori-tablist-keydown';
const TABLIST_INERT_ONKEYDOWN = 'void(0)';

/**
 * The tab strip of a document page — Web UI's `nuxeo-document-page` view tabs.
 *
 * Renders the tabs the host resolved, in order, and every body from one template — the one the host
 * passes as `body`, else the one it marks with `nxsTabBody` — so a tab a manifest adds renders
 * through the same template as a packaged one. Selection is by index, two-way
 * (`[(selectedIndex)]`), so the host can switch tabs itself, as the Publications count does;
 * `selectedTabChange` also names the tab by ID, which stays right when a manifest hides or reorders
 * tabs.
 *
 * The Material implementation of `nxs.primitives.tabs`. A host rendering that ID through
 * `lib-extension-outlet` passes `body` and `selectHandler`, since the outlet projects no content
 * and binds no outputs.
 */
@Component({
  selector: 'nxs-tabs',
  standalone: true,
  templateUrl: './tabs.component.html',
  styleUrl: './tabs.component.scss',
  imports: [MatTabsModule, MatIconModule, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-tabs' },
})
export class NxsTabsComponent implements NxsTabsInputs {
  /** The tabs, in display order. */
  readonly tabs = input.required<readonly NxsTab[]>();
  /** The tab list's accessible name, already translated. Optional. */
  readonly label = input('');
  /** The selected tab's position. Two-way. Past the last tab selects the last. */
  readonly selectedIndex = model(0);
  /**
   * The template every tab's body renders from, given the tab as `let-tab`. Takes precedence over
   * a projected `<ng-template nxsTabBody>`.
   */
  readonly body = input<TemplateRef<NxsTabBodyContext> | null>(null);
  /**
   * Called with the selected tab and its position whenever the selection changes — the user
   * choosing a tab, or the host moving `selectedIndex` — but not for the first selection.
   */
  readonly selectHandler = input<((tab: NxsTab, index: number) => void) | null>(null);

  /** The tab the user (or the host) selected, by ID. */
  readonly selectedTabChange = output<NxsTab>();

  private readonly projectedBody = contentChild(NxsTabBodyDirective);
  protected readonly bodyTemplate = computed(
    () => this.body() ?? this.projectedBody()?.template ?? null,
  );
  protected readonly ownLabel = computed(() => this.label().trim());

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    afterRenderEffect(() => {
      this.tabs();
      const tabList = this.host.nativeElement.querySelector<HTMLElement>(
        '.mat-mdc-tab-list[role="tablist"]',
      );
      if (!tabList || tabList.hasAttribute(TABLIST_KEYDOWN_ATTR)) return;
      if (!tabList.hasAttribute('onkeydown')) {
        tabList.setAttribute('onkeydown', TABLIST_INERT_ONKEYDOWN);
      }
      tabList.setAttribute(TABLIST_KEYDOWN_ATTR, 'true');
    });
  }

  protected select(index: number): void {
    this.selectedIndex.set(index);
    const tab = this.tabs()[index];
    if (!tab) return;
    this.selectedTabChange.emit(tab);
    this.selectHandler()?.(tab, index);
  }
}
