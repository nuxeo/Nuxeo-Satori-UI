import { CdkAriaLive } from '@angular/cdk/a11y';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';

import type { NxsActionBarInputs } from '../primitives';

/** One control on a document toolbar, already resolved by the host. */
export interface NxsToolbarAction {
  /** The action's registered ID; rendered as `data-action-id`. */
  readonly id: string;
  /**
   * What the control says, already translated. An icon button's accessible name starts with it
   * and goes on with its tooltip when that says more.
   */
  readonly label: string;
  /** A Material icon ligature. Decorative; an inline control without one shows its label. */
  readonly icon?: string;
  /** Hover and focus text, already translated. Falls back to `label`. */
  readonly tooltip?: string | null;
  /** Shown but not runnable — the action's enabled rule said no. */
  readonly disabled?: boolean;
  /** Drawn in its "on" colour, as the padlock of a locked document is. */
  readonly active?: boolean;
  /** Behind the "More actions" menu rather than inline. */
  readonly overflow?: boolean;
}

/**
 * The action row of a document page — Web UI's `nuxeo-actions-menu` in the document header.
 *
 * Presentational: the host resolves its slot's descriptors (labels translated, rules and enabled
 * rules evaluated, tooltips chosen) and runs the action `selected` names, so the library takes no
 * dependency on the extensions barrel. Inline entries are icon buttons that stay focusable while
 * disabled, so their tooltip — "Locked by Jane on 3 May" — is reachable from the keyboard; the rest
 * sit behind one "More actions" button. Content projected into it renders before the actions.
 *
 * The Material implementation of `nxs.primitives.actionBar`. A host rendering that ID through
 * `lib-extension-outlet` passes `actionHandler`, since the outlet binds no outputs.
 */
@Component({
  selector: 'nxs-document-toolbar',
  standalone: true,
  templateUrl: './document-toolbar.component.html',
  styleUrl: './document-toolbar.component.scss',
  imports: [
    CdkAriaLive,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatTooltipModule,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'nxs-document-toolbar' },
})
export class NxsDocumentToolbarComponent implements NxsActionBarInputs {
  /** Every entry, in display order; `overflow` decides which group each one is in. */
  readonly actions = input.required<readonly NxsToolbarAction[]>();
  /**
   * The group's accessible name, already translated. Blank falls back to the library's own
   * "Document actions".
   */
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

  /** A tooltip only when there is one to show: Material renders an empty one as a blank bubble. */
  protected tooltipOf(action: NxsToolbarAction): string {
    return (action.tooltip ?? '').trim() || action.label;
  }

  /** What the tooltip adds to the label, if anything — "Locked by Jane on 3 May" on Unlock. */
  protected extraOf(action: NxsToolbarAction): string {
    const tip = (action.tooltip ?? '').trim();
    return tip && tip !== action.label ? tip : '';
  }

  /**
   * An icon button's accessible name: its label, then what its tooltip adds, so a keyboard or
   * screen-reader user hears the lock owner a mouse user reads.
   */
  protected nameOf(action: NxsToolbarAction): string {
    const extra = this.extraOf(action);
    return extra ? `${action.label}. ${extra}` : action.label;
  }

  /**
   * Inline buttons are `disabledInteractive`, so a click on a disabled one still arrives here and
   * is refused here.
   */
  protected run(action: NxsToolbarAction): void {
    if (action.disabled) return;
    this.selected.emit(action);
    this.actionHandler()?.(action);
  }
}
