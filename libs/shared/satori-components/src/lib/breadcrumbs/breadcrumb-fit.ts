/**
 * How many breadcrumbs to fold into the "…" menu so the trail fits on one line.
 *
 * The first and the last item always stay: the first is where the trail starts, the last is where
 * the user is. Items fold from the second onwards, the ones furthest from the current page first,
 * as Satori's breadcrumbs fold them. When even the first, the "…" and the last do not fit, it folds
 * everything between them and the last item's label is cut short instead — it is never hidden,
 * which is what Satori's does at 110 px or narrower.
 *
 * @param widths  each item's rendered width, separator included, in trail order
 * @param overflowWidth  the "…" button's width, separator included
 * @param available  the width the trail may use
 * @returns how many items, counted from the second, go into the menu
 */
export function breadcrumbsToFold(
  widths: readonly number[],
  overflowWidth: number,
  available: number,
): number {
  const count = widths.length;
  if (count <= 2 || !(available > 0)) return 0;
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (total <= available) return 0;
  let shown = total + overflowWidth;
  for (let folded = 1; folded <= count - 2; folded += 1) {
    shown -= widths[folded];
    if (shown <= available) return folded;
  }
  return count - 2;
}
