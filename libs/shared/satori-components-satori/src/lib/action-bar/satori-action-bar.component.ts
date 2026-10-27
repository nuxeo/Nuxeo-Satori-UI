import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SatActionBarButton } from '@hylandsoftware/satori-ui/action-bar';
import { TranslatePipe } from '@ngx-translate/core';
import {
  nxsToolbarActionExtra,
  nxsToolbarActionName,
  nxsToolbarActionTooltip,
  type NxsActionBarInputs,
  type NxsToolbarAction,
} from '@nuxeo/satori-platform/components';

/**
 * `nxs.primitives.actionBar` on Satori's action-bar button, `button[satActionBarButton]`.
 *
 * Every control is Satori's action-bar button, the one `sat-action-group` is built from, but laid
 * out here rather than by `sat-action-group`, because that group cannot keep the contract: it
 * disables an entry natively, so a disabled entry's tooltip — who holds the lock — cannot be
 * reached from the keyboard; it decides what overflows by width alone, so `overflow` could not
 * keep an entry in the menu; and it renders neither `data-action-id` nor the "on" state.
 */
@Component({
  selector: 'nxs-satori-action-bar',
  standalone: true,
  templateUrl: './satori-action-bar.component.html',
  styleUrl: './satori-action-bar.component.scss',
  imports: [MatIconModule, MatMenuModule, MatTooltipModule, SatActionBarButton, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-satori-action-bar' },
})
export class NxsSatoriActionBarComponent implements NxsActionBarInputs {
  readonly actions = input.required<readonly NxsToolbarAction[]>();
  /** The group's accessible name, already translated. Blank falls back to "Document actions". */
  readonly label = input('');
  /** The menu button's accessible name and tooltip. Blank falls back to "More actions". */
  readonly moreLabel = input('');
  /** Called with the entry the user ran, as `selected` emits it. Never a disabled one. */
  readonly actionHandler = input<((action: NxsToolbarAction) => void) | null>(null);

  /** The entry the user ran. Never a disabled one. */
  readonly selected = output<NxsToolbarAction>();

  protected readonly inline = computed(() => this.actions().filter((action) => !action.overflow));
  protected readonly overflow = computed(() => this.actions().filter((action) => action.overflow));
  protected readonly ownLabel = computed(() => this.label().trim());
  protected readonly ownMoreLabel = computed(() => this.moreLabel().trim());

  // The same text as Material's toolbar, from the same functions, so the accessible names match.
  protected readonly tooltipOf = nxsToolbarActionTooltip;
  protected readonly extraOf = nxsToolbarActionExtra;
  protected readonly nameOf = nxsToolbarActionName;

  /** A disabled inline entry is only `aria-disabled`, so a click still arrives and is refused here. */
  protected run(action: NxsToolbarAction): void {
    if (action.disabled) return;
    this.selected.emit(action);
    this.actionHandler()?.(action);
  }
}
