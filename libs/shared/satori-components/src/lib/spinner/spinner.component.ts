import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  numberAttribute,
} from '@angular/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { nxsVisibleText } from '../visible-text';

/**
 * The indeterminate loader for a region waiting on data — a list, a tab, a panel, a dialog body.
 *
 * It is either named or decorative, never neither. With a `label` it is a progressbar carrying that
 * accessible name. Without one it is hidden from assistive technology, so use it bare only where
 * visible text beside it already says what is loading ("Checking Nuxeo Drive…"). A progressbar with
 * no name fails axe's `aria-progressbar-name`.
 *
 * Not for inside a button: a spinner there reflows the label. Rotate the button's icon instead —
 * `AGENTS/08-bug-patterns.md`, pattern 15.
 */
@Component({
  selector: 'nxs-spinner',
  standalone: true,
  templateUrl: './spinner.component.html',
  styleUrl: './spinner.component.scss',
  imports: [MatProgressSpinnerModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-spinner' },
})
export class NxsSpinnerComponent {
  /** Diameter in pixels. Accepts a static attribute, `diameter="36"`. */
  readonly diameter = input(32, { transform: numberAttribute });
  /** What is loading, already translated. Blank makes the spinner decorative. */
  readonly label = input('');

  /** The accessible name as a reader gets it: whitespace or zero-width characters alone are no name. */
  protected readonly name = computed(() => nxsVisibleText(this.label()));
}
