import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import type { NxsRichTooltipInputs } from '../primitives';

let nextId = 0;

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
  readonly heading = input.required<string>();
  readonly content = input.required<string>();
  readonly triggerLabel = input.required<string>();
  readonly icon = input('info');

  protected readonly open = signal(false);
  protected readonly panelId = `nxs-rich-tooltip-${nextId++}`;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly trigger = viewChild.required('trigger', {
    read: ElementRef<HTMLButtonElement>,
  });

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
}
