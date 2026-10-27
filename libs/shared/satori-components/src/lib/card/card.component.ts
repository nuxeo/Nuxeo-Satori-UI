import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  computed,
  input,
  type TemplateRef,
} from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';

import type { NxsCardInputs } from '../primitives';
import { nxsVisibleText } from '../visible-text';

/**
 * One item in a grid of cards, such as a document in browse's or search's card view.
 *
 * A Material card: the host's media on top (usually the document's thumbnail), then a heading and a
 * subheading, with an optional selection checkbox in the top-left corner, an optional header action
 * in the top-right corner (the two swap in right-to-left text) and an optional row of actions at the
 * foot. It is outlined when it opens something and filled when it does not.
 *
 * With an `openHandler` the heading is a button whose hit area covers the whole card, so a click
 * anywhere but another control opens the item. The checkbox and the actions sit above that area as
 * controls of their own, not inside the button: a control cannot contain a control (WCAG 4.1.2).
 *
 * Registered as `nxs.primitives.card`, so a customer can replace it by ID. The outlet that renders an
 * ID sets inputs and neither projects content nor binds outputs, so everything the card takes from
 * its host is an input — the callbacks and the templates for its media and actions — and it has no
 * outputs: a host using the element passes the same inputs.
 */
@Component({
  selector: 'nxs-card',
  standalone: true,
  templateUrl: './card.component.html',
  styleUrl: './card.component.scss',
  imports: [MatCardModule, MatCheckboxModule, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'nxs-card',
    '[class.nxs-card--selected]': 'selected()',
    '[class.nxs-card--interactive]': 'interactive()',
  },
})
export class NxsCardComponent implements NxsCardInputs {
  /**
   * The card's title, already translated: for a document, its title. When the card opens something
   * it is the accessible name of the control that opens it, so pass a name that is never blank — a
   * document with no title by its path, as the document list names such a row.
   */
  readonly heading = input('');
  /** One line under the heading, already translated, such as the document's type. Blank shows none. */
  readonly subheading = input('');
  /** Whether the item is selected. Accepts a bare attribute, `selected`. */
  readonly selected = input(false, { transform: booleanAttribute });
  /**
   * The selection checkbox's accessible name, already translated, such as "Select Claim 42". Blank,
   * or only whitespace or zero-width characters, renders no checkbox: the card is not selectable.
   */
  readonly selectionLabel = input('');
  /** Called with the checkbox's new state when the user toggles it. */
  readonly selectionHandler = input<((selected: boolean) => void) | null>(null);
  /** Called when the user opens the card. Without it the heading is text and the card opens nothing. */
  readonly openHandler = input<(() => void) | null>(null);
  /** Rendered at the top of the card, in a fixed-height frame: usually the document's thumbnail. */
  readonly media = input<TemplateRef<unknown> | null>(null);
  /** Rendered in the card's top corner opposite the checkbox, over the media: usually a menu button. */
  readonly headerAction = input<TemplateRef<unknown> | null>(null);
  /** Rendered in a row at the foot of the card: buttons such as Favorite and Download. */
  readonly actions = input<TemplateRef<unknown> | null>(null);

  /**
   * Whether the card opens something. Only then is it outlined: in Satori's design an outline says a
   * surface can be pressed, so a card that opens nothing is filled instead.
   */
  protected readonly interactive = computed(() => this.openHandler() !== null);
  /** The checkbox's name as a reader gets it: whitespace or zero-width characters alone are none. */
  protected readonly label = computed(() => nxsVisibleText(this.selectionLabel()));
  protected readonly selectable = computed(() => this.label() !== '');
  protected readonly ownSubheading = computed(() => nxsVisibleText(this.subheading()));
  /**
   * The checkbox and the header action sit in the corners over the media. A card with neither media
   * nor room for them would put them over its heading, so it reserves that room above the text.
   */
  protected readonly bare = computed(
    () => this.media() === null && (this.selectable() || this.headerAction() !== null),
  );

  protected toggle(selected: boolean): void {
    this.selectionHandler()?.(selected);
  }

  protected open(): void {
    this.openHandler()?.();
  }
}
