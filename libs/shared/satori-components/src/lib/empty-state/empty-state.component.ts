import { ChangeDetectionStrategy, Component, input, type InputSignal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

import type { NxsHeadingLevel } from '../heading-level';

/**
 * The "nothing here" state for a list, panel or result set.
 *
 * Text arrives already translated — the library ships no catalogue of its own — so a caller
 * binds `[heading]="'browse.empty' | translate"`. Actions are projected, so a "Create" or
 * "Clear filters" button stays the caller's, wired to the caller's action.
 */
@Component({
  selector: 'nxs-empty-state',
  standalone: true,
  templateUrl: './empty-state.component.html',
  styleUrl: './empty-state.component.scss',
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-empty-state', role: 'status' },
})
export class NxsEmptyStateComponent {
  /** What is empty, in one line. */
  readonly heading = input.required<string>();
  /**
   * The heading's level in the page outline, rendered as the native `<h1>`–`<h6>`. Set it to fit
   * where the component sits — one below the heading of the section it empties — so heading
   * navigation stays in order.
   */
  // Annotated rather than inferred: an inferred union is declared in the compiler's type order,
  // which moves with unrelated code and would change the published API snapshot each time.
  readonly headingLevel: InputSignal<NxsHeadingLevel> = input<NxsHeadingLevel>(2);
  /** An optional second line — usually what to do next. Not rendered when blank. */
  readonly message = input('');
  /** An optional Material icon ligature. Decorative, so hidden from assistive technology. */
  readonly icon = input('');
}
