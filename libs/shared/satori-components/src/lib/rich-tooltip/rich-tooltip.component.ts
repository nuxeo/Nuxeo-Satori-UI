import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import type { NxsRichTooltipInputs } from '../primitives';

let nextId = 0;

/** The least gap, in px, the open panel keeps from either side of the viewport. */
const VIEWPORT_MARGIN = 8;

/**
 * An icon button that opens a titled explanation — the Material implementation of
 * `nxs.primitives.richTooltip`.
 *
 * Material's `matTooltip` holds one line of plain text, so this is a toggletip: the button opens a
 * non-modal panel, and Escape or moving focus out of the component closes it. Satori's opens on
 * hover and focus instead; the content contract is the same.
 *
 * Focus stays on the button, as it does on Satori's, and the panel opens inside a live region so a
 * screen reader announces it. It is not a dialog: a dialog takes focus when it opens.
 *
 * The panel opens under the button from its inline-start edge, is never wider than the viewport,
 * and moves sideways when it would cross either side of it, in either direction.
 */
@Component({
  selector: 'nxs-rich-tooltip',
  standalone: true,
  templateUrl: './rich-tooltip.component.html',
  styleUrl: './rich-tooltip.component.scss',
  imports: [MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'nxs-rich-tooltip',
    '(keydown.escape)': 'closeAndRefocus()',
    '(focusout)': 'onFocusOut($event)',
  },
})
export class NxsRichTooltipComponent implements NxsRichTooltipInputs {
  /** The panel's title, already translated. */
  readonly heading = input.required<string>();
  /** The explanation under the title, already translated. Plain text. */
  readonly content = input.required<string>();
  /** The trigger button's accessible name, already translated. The button shows only an icon. */
  readonly triggerLabel = input.required<string>();
  /** The trigger's Material Icons ligature. */
  readonly icon = input('info');

  protected readonly open = signal(false);
  protected readonly panelId = `nxs-rich-tooltip-${nextId++}`;
  /** How far, in px, the open panel is moved sideways to stay inside the viewport. */
  protected readonly shift = signal(0);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly trigger = viewChild.required('trigger', {
    read: ElementRef<HTMLButtonElement>,
  });
  private readonly panel = viewChild('panel', { read: ElementRef<HTMLElement> });

  constructor() {
    afterRenderEffect((onCleanup) => {
      if (!this.open()) return;
      this.place();
      const view = this.host.nativeElement.ownerDocument.defaultView;
      const replace = () => this.place();
      view?.addEventListener('resize', replace);
      onCleanup(() => view?.removeEventListener('resize', replace));
    });
  }

  protected toggle(): void {
    this.open.update((open) => !open);
  }

  protected closeAndRefocus(): void {
    if (!this.open()) return;
    this.open.set(false);
    this.trigger().nativeElement.focus();
  }

  protected onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && this.host.nativeElement.contains(next)) return;
    this.open.set(false);
  }

  /** Measured from the host, so the shift already applied does not feed into the next one. */
  private place(): void {
    const panel = this.panel()?.nativeElement;
    if (!panel) return;
    const host = this.host.nativeElement;
    const anchor = host.getBoundingClientRect();
    const width = panel.offsetWidth;
    const viewport = host.ownerDocument.documentElement.clientWidth;
    const rtl = getComputedStyle(host).direction === 'rtl';
    const left = rtl ? anchor.right - width : anchor.left;
    const furthest = Math.max(VIEWPORT_MARGIN, viewport - VIEWPORT_MARGIN - width);
    const placed = Math.min(Math.max(left, VIEWPORT_MARGIN), furthest);
    this.shift.set(Math.round(placed - left));
  }
}
