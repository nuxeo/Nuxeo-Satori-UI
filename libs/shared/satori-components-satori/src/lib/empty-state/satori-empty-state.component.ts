import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  input,
  type InputSignal,
  type TemplateRef,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { SatEmptyState } from '@hylandsoftware/satori-ui/empty-state';
import type { NxsEmptyStateInputs, NxsHeadingLevel } from '@nuxeo/satori-platform/components';

/**
 * `nxs.primitives.emptyState` on Satori's `sat-empty-state`.
 *
 * Satori centres the illustration, headline, description and action in a column with its own
 * measure, so the same four inputs read as Satori's empty state rather than ours re-themed.
 *
 * ## One status region, not two
 *
 * `sat-empty-state` carries `role="status"` as a host attribute of its own, so this wrapper's host
 * deliberately does **not** — two nested status regions would announce the same text twice. The
 * Material implementation puts the role on its own host, so what matches across the two is the
 * thing that matters: exactly one live region announcing the emptiness, which the spec asserts
 * rather than asserting the element it sits on.
 *
 * Satori also wraps its illustration slot in `aria-hidden="true"` itself, so the icon needs no
 * hiding here — decorative in both implementations either way.
 *
 * The blank tests are `message()` and `icon()` as written, not trimmed: the Material
 * implementation renders on truthiness, so a message of only spaces draws an empty line there and
 * has to here too. Trimming would be the better behaviour and is deliberately not introduced on one
 * side only.
 *
 * Registered over the Material empty state by `provideNxsSatoriComponents()`. The action arrives as
 * a template, because the outlet that renders an ID projects no content; content projected by a host
 * that uses the element is passed through to the same slot, after the template.
 */
@Component({
  selector: 'nxs-satori-empty-state',
  standalone: true,
  templateUrl: './satori-empty-state.component.html',
  styleUrl: './satori-empty-state.component.scss',
  // Only `SatEmptyState`. Its four slots — illustration, headline, description, action — are
  // `ng-content select` attribute matches with no directives behind them, unlike the pre-configured
  // error states' `SatErrorState*` markers, so the attributes in the template are all that is
  // needed. Importing names that do not exist put `undefined` in this array and failed at runtime
  // with NG0919 rather than at compile time.
  imports: [NgTemplateOutlet, MatIconModule, SatEmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-satori-empty-state' },
})
export class NxsSatoriEmptyStateComponent implements NxsEmptyStateInputs {
  /** What is empty, in one line, already translated. */
  readonly heading = input.required<string>();
  /**
   * The heading's level in the page outline, rendered as the native `<h1>`–`<h6>`. Annotated rather
   * than inferred, as the Material implementation is: an inferred union is declared in the
   * compiler's type order, which moves with unrelated code.
   */
  readonly headingLevel: InputSignal<NxsHeadingLevel> = input<NxsHeadingLevel>(2);
  /** An optional second line, already translated. Not rendered when blank. */
  readonly message = input('');
  /** An optional Material icon ligature or registered SVG name. Decorative. */
  readonly icon = input('');
  /** Buttons rendered under the message, such as "Create folder". */
  readonly actions = input<TemplateRef<unknown> | null>(null);
}
