import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
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

/** How long, in ms, the pointer rests or focus stays on the button before the panel opens: Satori's `showDelay`. */
const SHOW_DELAY = 200;

/** How long, in ms, the panel stays after the pointer leaves, so it can come back: Satori's `hideDelay`. */
const HIDE_DELAY = 1500;

/** What opened the panel, which decides what closes it. */
type Opener = 'hover' | 'focus' | 'click';

/**
 * An icon button that opens a titled explanation — the Material implementation of
 * `nxs.primitives.richTooltip`.
 *
 * It opens as Satori's does: when the pointer rests on the button or keyboard focus reaches it.
 * Unlike Satori's, a click also opens it, because a touch screen has neither: a tap toggles the
 * panel, and a click keeps open a panel the pointer opened. Escape, or focus moving out of the
 * component, closes it at once; the pointer leaving closes a panel the pointer opened, after a
 * delay long enough to reach the panel.
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
    '(pointerenter)': 'onPointerEnter($event)',
    '(pointerleave)': 'onPointerLeave($event)',
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

  /** What opened the panel while it is open; `null` while it is closed. */
  private opener: Opener | null = null;
  /** What will open the panel once `SHOW_DELAY` has passed. */
  private pending: Opener | null = null;
  private showTimer: ReturnType<typeof setTimeout> | undefined;
  private hideTimer: ReturnType<typeof setTimeout> | undefined;
  /** A pointer is pressing the button, so the focus it gives is the click's to handle. */
  private pressing = false;

  constructor() {
    afterRenderEffect((onCleanup) => {
      if (!this.open()) return;
      this.place();
      const view = this.host.nativeElement.ownerDocument.defaultView;
      const replace = () => this.place();
      view?.addEventListener('resize', replace);
      onCleanup(() => view?.removeEventListener('resize', replace));
    });
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.showTimer);
      clearTimeout(this.hideTimer);
    });
  }

  /** A pointer rests on the button or the panel. A touch has no hover; its tap is a click. */
  protected onPointerEnter(event: PointerEvent): void {
    if (event.pointerType === 'touch') return;
    clearTimeout(this.hideTimer);
    if (!this.open()) this.openSoon('hover');
  }

  protected onPointerLeave(event: PointerEvent): void {
    if (event.pointerType === 'touch') return;
    if (this.pending === 'hover') this.cancelOpening();
    if (this.opener !== 'hover') return;
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.close(), HIDE_DELAY);
  }

  protected onPointerDown(): void {
    this.pressing = true;
  }

  /** Keyboard focus opens the panel. The focus a press gives is left to its click. */
  protected onFocus(): void {
    if (this.pressing) return;
    if (!this.open()) {
      this.openSoon('focus');
    } else if (this.opener === 'hover') {
      clearTimeout(this.hideTimer);
      this.opener = 'focus';
    }
  }

  /**
   * A click, a tap, Enter or Space. A click on a panel the pointer opened keeps it open once the
   * pointer leaves; otherwise activating the button opens or closes the panel.
   */
  protected onClick(): void {
    this.pressing = false;
    this.cancelOpening();
    if (this.open() && this.opener !== 'hover') this.close();
    else this.show('click');
  }

  protected closeAndRefocus(): void {
    this.cancelOpening();
    if (!this.open()) return;
    this.close();
    this.trigger().nativeElement.focus();
  }

  protected onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && this.host.nativeElement.contains(next)) return;
    this.pressing = false;
    this.cancelOpening();
    this.close();
  }

  /** Opens after `SHOW_DELAY`, unless it opens or is cancelled first. Focus outranks hover. */
  private openSoon(opener: Opener): void {
    if (this.pending) {
      if (opener === 'focus') this.pending = opener;
      return;
    }
    this.pending = opener;
    this.showTimer = setTimeout(() => {
      const pending = this.pending;
      this.pending = null;
      if (pending) this.show(pending);
    }, SHOW_DELAY);
  }

  private cancelOpening(): void {
    clearTimeout(this.showTimer);
    this.pending = null;
  }

  private show(opener: Opener): void {
    clearTimeout(this.hideTimer);
    this.opener = opener;
    this.open.set(true);
  }

  private close(): void {
    clearTimeout(this.hideTimer);
    this.opener = null;
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
