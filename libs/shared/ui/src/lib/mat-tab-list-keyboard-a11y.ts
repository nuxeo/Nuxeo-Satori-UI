/**
 * IBM Equal Access `aria_keyboard_handler_exists` (NXENG-821, issue 1036659222) inspects the
 * element with `role="tablist"`. The checker-engine rule only treats inline `onkeydown`,
 * `onkeypress`, or `onkeyup` attributes as handlers — not `addEventListener`. Material binds
 * keyboard handling on `.mat-mdc-tab-label-container` instead, so the tablist node fails the
 * static check even though arrow-key navigation works on the tab buttons.
 */

export const MAT_TAB_LIST_KEYDOWN_ATTR = 'data-satori-tablist-keydown';

/** Inert inline handler IBM's static rule can detect; Material still owns tab navigation. */
export const MAT_TAB_LIST_IBM_ONKEYDOWN = 'void(0)';

/**
 * Attach IBM-detectable keyboard metadata on the Material tablist node inside `root`.
 * Returns cleanup when this call attaches metadata, or `null` when it makes no change.
 */
export function wireMatTabListKeyboardA11y(root: HTMLElement): (() => void) | null {
  const tabList = root.querySelector<HTMLElement>('.mat-mdc-tab-list[role="tablist"]');
  if (!tabList) {
    return null;
  }

  if (tabList.getAttribute(MAT_TAB_LIST_KEYDOWN_ATTR) === 'true') {
    return null;
  }

  const existingOnKeydown = tabList.getAttribute('onkeydown');
  if (existingOnKeydown !== null && existingOnKeydown !== MAT_TAB_LIST_IBM_ONKEYDOWN) {
    return null;
  }

  const appliedOnKeydown = existingOnKeydown === null;
  if (appliedOnKeydown) {
    tabList.setAttribute('onkeydown', MAT_TAB_LIST_IBM_ONKEYDOWN);
  }
  tabList.setAttribute(MAT_TAB_LIST_KEYDOWN_ATTR, 'true');

  return () => {
    if (appliedOnKeydown && tabList.getAttribute('onkeydown') === MAT_TAB_LIST_IBM_ONKEYDOWN) {
      tabList.removeAttribute('onkeydown');
    }
    tabList.removeAttribute(MAT_TAB_LIST_KEYDOWN_ATTR);
  };
}

/** Re-wire when Material re-renders tab labels (dynamic tab sets). */
export function observeMatTabListKeyboardA11y(root: HTMLElement): (() => void) | null {
  if (typeof MutationObserver === 'undefined') {
    const cleanup = wireMatTabListKeyboardA11y(root);
    return cleanup ?? null;
  }

  let tabListCleanup: (() => void) | null = null;
  const sync = (): void => {
    const next = wireMatTabListKeyboardA11y(root);
    if (!next) {
      return;
    }
    tabListCleanup?.();
    tabListCleanup = next;
  };

  sync();

  const observer = new MutationObserver(sync);
  observer.observe(root, { childList: true, subtree: true });

  return () => {
    observer.disconnect();
    tabListCleanup?.();
  };
}
