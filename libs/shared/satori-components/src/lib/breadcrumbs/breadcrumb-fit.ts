/** The breadcrumbs folded into the "…" menu: `count` of them, from the item at `start`. */
export interface BreadcrumbFold {
  readonly start: 0 | 1;
  readonly count: number;
}

const NOTHING_FOLDED: BreadcrumbFold = { start: 1, count: 0 };

/**
 * Which breadcrumbs to fold into the "…" menu so the trail fits on one line.
 *
 * The last item always stays: it is where the user is. Items fold from the second onwards, the ones
 * furthest from the current page first, as Satori's breadcrumbs fold them, so the first — where
 * the trail starts — stays while it fits. When only the first, the "…" and the last are left and
 * they still do not fit with the last cut short to its minimum, the first folds too, rather than
 * shrink to nothing while still being a link. The last item is never hidden, which is what Satori's
 * does at 110 px or narrower.
 *
 * @param widths  each item's rendered width, separator included, in trail order
 * @param overflowWidth  the "…" button's width, separator included
 * @param available  the width the trail may use
 * @param lastMinimum  the narrowest the last item is cut short to; its full width when unknown
 */
export function breadcrumbsToFold(
  widths: readonly number[],
  overflowWidth: number,
  available: number,
  lastMinimum = Number.NaN,
): BreadcrumbFold {
  const count = widths.length;
  if (count <= 2 || !(available > 0)) return NOTHING_FOLDED;
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (total <= available) return NOTHING_FOLDED;
  let shown = total + overflowWidth;
  for (let folded = 1; folded <= count - 2; folded += 1) {
    shown -= widths[folded];
    if (shown <= available) return { start: 1, count: folded };
  }
  const last = widths[count - 1];
  const shortest = Number.isFinite(lastMinimum) ? Math.min(last, lastMinimum) : last;
  return widths[0] + overflowWidth + shortest > available
    ? { start: 0, count: count - 1 }
    : { start: 1, count: count - 2 };
}
