import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  model,
  output,
  viewChildren,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';

/** One view of a details panel — Properties, Comments, Activity — already resolved by the host. */
export interface NxsDetailsPanelTab {
  readonly id: string;
  /** What the tab says, already translated. */
  readonly label: string;
}

let nextId = 0;

/**
 * The side panel of a document page — Web UI's `nuxeo-document-page` side pane, with its
 * Comments and Activity tabs, here with Properties beside them.
 *
 * It owns the frame: a header naming the document with a close button, a strip of ARIA tabs, and
 * one tab panel holding whatever the host projects for the selected view. Which views exist (Web
 * UI offers Comments only on a `Commentable` document) and what each shows are the host's.
 */
@Component({
  selector: 'nxs-details-panel',
  standalone: true,
  templateUrl: './details-panel.component.html',
  styleUrl: './details-panel.component.scss',
  imports: [MatButtonModule, MatIconModule, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-details-panel', '[attr.aria-label]': 'regionLabel()', role: 'complementary' },
})
export class NxsDetailsPanelComponent {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly uid = `nxs-details-panel-${nextId++}`;
  private readonly tabButtons = viewChildren<ElementRef<HTMLButtonElement>>('tabButton');

  /** The header text — usually the document's title or file name. */
  readonly heading = input('');
  /** The panel's accessible name, already translated. Blank falls back to `heading`. */
  readonly label = input('');
  /** The views, in order. */
  readonly tabs = input.required<readonly NxsDetailsPanelTab[]>();
  /** The selected view's ID. Two-way; one that is not in `tabs` selects the first. */
  readonly selected = model('');
  /** The close button's accessible name. Blank falls back to "Close details". */
  readonly closeLabel = input('');

  /** The close button was pressed. The host decides what closing means. */
  readonly closed = output<void>();

  protected readonly regionLabel = computed(
    () => this.label().trim() || this.heading().trim() || null,
  );
  protected readonly ownCloseLabel = computed(() => this.closeLabel().trim());
  protected readonly activeId = computed(() => {
    const tabs = this.tabs();
    return tabs.some((tab) => tab.id === this.selected()) ? this.selected() : (tabs[0]?.id ?? '');
  });
  protected readonly panelId = `${this.uid}-panel`;

  protected tabId(id: string): string {
    return `${this.uid}-tab-${id}`;
  }

  protected select(tab: NxsDetailsPanelTab): void {
    this.selected.set(tab.id);
  }

  /** The ARIA tabs pattern: arrows move and select (automatic activation), Home and End jump. */
  protected onKeydown(event: KeyboardEvent, index: number): void {
    const tabs = this.tabs();
    const last = tabs.length - 1;
    const rtl = getComputedStyle(this.element.nativeElement).direction === 'rtl';
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const back = rtl ? 'ArrowRight' : 'ArrowLeft';
    const target =
      event.key === forward
        ? index === last
          ? 0
          : index + 1
        : event.key === back
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (target === null || !tabs[target]) return;
    event.preventDefault();
    this.select(tabs[target]);
    this.tabButtons()[target]?.nativeElement.focus();
  }
}
