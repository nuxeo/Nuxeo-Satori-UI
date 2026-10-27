import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  computed,
  input,
  type TemplateRef,
} from '@angular/core';
import { MatCheckboxModule } from '@angular/material/checkbox';
import {
  SatInteractiveCard,
  SatInteractiveCardActions,
  SatInteractiveCardContent,
  SatInteractiveCardHeaderAction,
  SatInteractiveCardSubtitle,
  SatInteractiveCardTitle,
} from '@hylandsoftware/satori-ui/interactive-card';
import { nxsVisibleText, type NxsCardInputs } from '@nuxeo/satori-platform/components';

/**
 * `nxs.primitives.card` on Satori's `sat-interactive-card`.
 *
 * Satori's card stacks its title and subtitle above the content, where the Material card frames the
 * media on top and puts the text under it, so a grid of these reads as Satori's cards rather than
 * as ours re-themed. What does not change is what a click does, because browse and search render
 * every card through this ID and a host cannot see which implementation answered it.
 *
 * ## Why the checkbox is in the header, not Satori's selection gutter
 *
 * `SatInteractiveCard` listens for a click on itself and, for a target outside
 * `a, input, button, select, textarea`, clicks the projected `satInteractiveCardSelectionControl`
 * if there is one and the `satInteractiveCardTitle` otherwise. Projected into that gutter, our
 * checkbox would make a click on the card's background **select** the document under Satori while
 * the same click **opens** it under Material — one ID, two behaviours, in a customer's card view.
 *
 * So the checkbox shares the header-action slot with the host's own corner control. Satori projects
 * no catch-all `<ng-content>` — content matching none of its five slots is dropped — so leaving the
 * checkbox unslotted is not an option; the slot is the decision.
 *
 * ## What a click does, and where that comes from
 *
 * Not from Satori's listener. The heading carries the Material card's own technique: an `::after`
 * stretched over the card, so the browser delivers a click on the background or the thumbnail to
 * the heading itself, and the corner and the action row sit above it and take their own clicks. The
 * primary behaviour is therefore the same mechanism in both implementations rather than two that
 * have to be kept in agreement.
 *
 * On top of that the checkbox stops its own click, as the search and browse lists' checkboxes do:
 * Material renders a `<div>` touch target over the `<input>`, so a press often lands on an element
 * Satori's early return does not cover, and the fall-through would tick the box **and** open the
 * document.
 *
 * What is left of the fall-through can only be reached by a click on the corner's or the action
 * row's own padding, where it opens the item. That is a wider hit area than the Material card's, in
 * which those few pixels do nothing — never a different action, and the one difference worth
 * knowing about.
 *
 * Unlike Material's, these controls are not faded until the card is hovered: in Satori's layout they
 * sit beside the title rather than over the media, so there is nothing for them to obscure.
 *
 * Registered over the Material card by `provideNxsSatoriComponents()`. Like every implementation of
 * the ID it takes the handlers and the media, header-action and footer templates as inputs and has
 * no outputs, because the outlet that renders an ID sets inputs and binds nothing.
 */
@Component({
  selector: 'nxs-satori-card',
  standalone: true,
  templateUrl: './satori-card.component.html',
  styleUrl: './satori-card.component.scss',
  imports: [
    NgTemplateOutlet,
    MatCheckboxModule,
    SatInteractiveCard,
    SatInteractiveCardActions,
    SatInteractiveCardContent,
    SatInteractiveCardHeaderAction,
    SatInteractiveCardSubtitle,
    SatInteractiveCardTitle,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'nxs-satori-card',
    '[class.nxs-satori-card--selected]': 'selected()',
    '[class.nxs-satori-card--interactive]': 'interactive()',
  },
})
export class NxsSatoriCardComponent implements NxsCardInputs {
  /**
   * The card's title, already translated: for a document, its title. When the card opens something
   * it is the accessible name of the control that opens it, so pass a name that is never blank.
   */
  readonly heading = input('');
  /** One line under the heading, already translated, such as the document's type. Blank shows none. */
  readonly subheading = input('');
  /** Whether the item is selected. Accepts a bare attribute, `selected`. */
  readonly selected = input(false, { transform: booleanAttribute });
  /**
   * The selection checkbox's accessible name, already translated. Blank, or only whitespace or
   * zero-width characters, renders no checkbox: the card is not selectable.
   */
  readonly selectionLabel = input('');
  /** Called with the checkbox's new state when the user toggles it. */
  readonly selectionHandler = input<((selected: boolean) => void) | null>(null);
  /** Called when the user opens the card. Without it the heading is text and the card opens nothing. */
  readonly openHandler = input<(() => void) | null>(null);
  /** Rendered as the card's content, under the heading: usually the document's thumbnail. */
  readonly media = input<TemplateRef<unknown> | null>(null);
  /** Rendered in the card's header beside the checkbox: usually a menu button. */
  readonly headerAction = input<TemplateRef<unknown> | null>(null);
  /** Rendered in a row at the foot of the card: buttons such as Favorite and Download. */
  readonly actions = input<TemplateRef<unknown> | null>(null);

  /**
   * Whether the card opens something. Satori outlines a card it can act on and leaves one it cannot
   * borderless, which is the distinction Material's outlined-versus-filled appearance draws.
   */
  protected readonly interactive = computed(() => this.openHandler() !== null);
  /** The checkbox's name as a reader gets it: whitespace or zero-width characters alone are none. */
  protected readonly label = computed(() => nxsVisibleText(this.selectionLabel()));
  protected readonly selectable = computed(() => this.label() !== '');
  protected readonly ownSubheading = computed(() => nxsVisibleText(this.subheading()));
  /** The header slot is rendered for either control, since Satori gives them one slot between them. */
  protected readonly hasCorner = computed(() => this.selectable() || this.headerAction() !== null);

  protected toggle(selected: boolean): void {
    this.selectionHandler()?.(selected);
  }

  protected open(): void {
    this.openHandler()?.();
  }
}
