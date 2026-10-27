import { computed, type OutputEmitterRef, type Signal } from '@angular/core';

import type { NxsToolbarAction } from './document-toolbar.component';
import {
  nxsToolbarActionExtra,
  nxsToolbarActionName,
  nxsToolbarActionTooltip,
} from './toolbar-action-text';

/** The inputs and output an implementation of `nxs.primitives.actionBar` declares. */
export interface NxsActionBarSource {
  readonly actions: Signal<readonly NxsToolbarAction[]>;
  readonly label: Signal<string>;
  readonly moreLabel: Signal<string>;
  readonly actionHandler: Signal<((action: NxsToolbarAction) => void) | null>;
  readonly selected: OutputEmitterRef<NxsToolbarAction>;
}

/** What an action bar's template reads, and the one thing it does: see {@link nxsActionBarView}. */
export interface NxsActionBarView {
  /** The entries shown as buttons, in order. */
  readonly inline: Signal<readonly NxsToolbarAction[]>;
  /** The entries behind "More actions", in order. */
  readonly overflow: Signal<readonly NxsToolbarAction[]>;
  /** The group's own name, trimmed; blank means the library's own. */
  readonly ownLabel: Signal<string>;
  /** The menu button's own name, trimmed; blank means the library's own. */
  readonly ownMoreLabel: Signal<string>;
  readonly tooltipOf: (action: NxsToolbarAction) => string;
  readonly extraOf: (action: NxsToolbarAction) => string;
  readonly nameOf: (action: NxsToolbarAction) => string;
  /** Runs an entry: emits `selected` and calls `actionHandler`. Never for a disabled one. */
  readonly run: (action: NxsToolbarAction) => void;
}

/**
 * Everything an action bar derives from its inputs, in one place, so every implementation of
 * `nxs.primitives.actionBar` groups, names and runs its entries the same way and only its
 * template differs: Material's toolbar and Satori's action bar both use it.
 *
 * A disabled entry is refused in `run` rather than by the browser: an inline button stays
 * focusable while disabled (Material's `disabledInteractive`, Satori's `aria-disabled`), so its
 * tooltip can be read from the keyboard, and so a click on one still arrives.
 */
export function nxsActionBarView(bar: NxsActionBarSource): NxsActionBarView {
  return {
    inline: computed(() => bar.actions().filter((action) => !action.overflow)),
    overflow: computed(() => bar.actions().filter((action) => action.overflow)),
    ownLabel: computed(() => bar.label().trim()),
    ownMoreLabel: computed(() => bar.moreLabel().trim()),
    tooltipOf: nxsToolbarActionTooltip,
    extraOf: nxsToolbarActionExtra,
    nameOf: nxsToolbarActionName,
    run: (action) => {
      if (action.disabled) return;
      bar.selected.emit(action);
      bar.actionHandler()?.(action);
    },
  };
}
