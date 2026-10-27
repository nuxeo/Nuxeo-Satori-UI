import type { NxsToolbarAction } from './document-toolbar.component';

/**
 * The text an action bar shows and announces for one entry, shared by every implementation of
 * `nxs.primitives.actionBar` so that a screen-reader user hears the same name whichever is
 * registered.
 */

/** An entry's tooltip: its own, else its label — never blank, which Material draws as an empty bubble. */
export function nxsToolbarActionTooltip(action: NxsToolbarAction): string {
  return (action.tooltip ?? '').trim() || action.label;
}

/** What an entry's tooltip adds to its label, if anything — "Locked by Jane on 3 May" on Unlock. */
export function nxsToolbarActionExtra(action: NxsToolbarAction): string {
  const tip = (action.tooltip ?? '').trim();
  return tip && tip !== action.label ? tip : '';
}

/**
 * An icon button's accessible name: its label, then what its tooltip adds, so a keyboard or
 * screen-reader user hears the lock owner a mouse user reads.
 */
export function nxsToolbarActionName(action: NxsToolbarAction): string {
  const extra = nxsToolbarActionExtra(action);
  return extra ? `${action.label}. ${extra}` : action.label;
}
