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
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';

import { NxsTabBodyDirective, type NxsTab } from './tab-body.directive';

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
 * Renders the tabs the host resolved, in order, and every body from the one template the host marks
 * with `nxsTabBody`, so a tab a manifest adds renders through the same template as a packaged one.
 * Selection is by index, two-way (`[(selectedIndex)]`), so the host can switch tabs itself, as the
 * Publications count does; `selectedTabChange` also names the tab by ID, which stays right when a
 * manifest hides or reorders tabs.
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
export class NxsTabsComponent {
  /** The tabs, in display order. */
  readonly tabs = input.required<readonly NxsTab[]>();
  /** The tab list's accessible name, already translated. Optional. */
  readonly label = input('');
  /** The selected tab's position. Two-way. */
  readonly selectedIndex = model(0);

  /** The tab the user (or the host) selected, by ID. */
  readonly selectedTabChange = output<NxsTab>();

  protected readonly body = contentChild(NxsTabBodyDirective);
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
    if (tab) this.selectedTabChange.emit(tab);
  }
}
