import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  input,
  type InputSignal,
  type TemplateRef,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

import type { NxsHeadingLevel } from '../heading-level';
import type { NxsEmptyStateInputs } from '../primitives';

/**
 * The "nothing here" state for a list, panel or result set.
 *
 * Text arrives already translated — the library ships no catalogue of its own — so a caller
 * binds `[heading]="'browse.empty' | translate"`. Actions are the caller's, wired to the caller's
 * action, and arrive either way: as an `actions` template, which is how a host rendering the ID
 * through `lib-extension-outlet` has to pass them, or projected as content by a host that uses the
 * element. Both render in the same place.
 *
 * Registered as `nxs.primitives.emptyState`, so a customer can replace it by ID.
 */
@Component({
  selector: 'nxs-empty-state',
  standalone: true,
  templateUrl: './empty-state.component.html',
  styleUrl: './empty-state.component.scss',
  imports: [MatIconModule, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-empty-state', role: 'status' },
})
export class NxsEmptyStateComponent implements NxsEmptyStateInputs {
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
  /**
   * Buttons rendered under the message, such as "Create folder" — the alternative to projecting
   * them as content, and the only way a host rendering the ID can pass them, since the outlet
   * projects nothing. Rendered where the host declared it, so it reads the host's own context.
   */
  readonly actions = input<TemplateRef<unknown> | null>(null);
}
