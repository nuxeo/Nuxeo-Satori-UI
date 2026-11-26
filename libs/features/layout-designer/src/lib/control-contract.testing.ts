/**
 * Test support, not part of the library: the keyboard contract of a designer page.
 *
 * Every element the keyboard can reach, or that a script focuses, in document order — which is the
 * order Tab visits them in, since none has a positive `tabindex` — with what a screen reader calls
 * it, and what makes it behave as it does:
 *
 * - the **element**, because a native `button`, `input`, `select`, `textarea`, `summary` or link
 *   is what gives Enter, Space, the arrow keys and typing their behaviour, and a wrapper that put a
 *   `div` or a focusable host in its place would change it;
 * - its **accessible name**, computed as `computeAccessibleName` does for these elements, in this
 *   order: `aria-labelledby`, `aria-label`, the `<label>`s that label it, then its text;
 * - whether it is **disabled**, and any `tabindex` set on it;
 * - what it **holds**: a field's text, and a `select`'s options in order, the chosen one marked
 *   `*`; and whether a field **suggests** from a list.
 *
 * Each page's spec holds the list its state draws, written out in full, so that a change to any
 * control's element, name, state, value, order or options fails there.
 */

const REACHABLE = 'a[href], button, input, select, textarea, summary, [tabindex]';

const squash = (text: string | null | undefined): string =>
  (text ?? '').replace(/\s+/g, ' ').trim();

function accessibleName(element: HTMLElement): string {
  const labelledBy = element.getAttribute('aria-labelledby')?.trim();
  if (labelledBy) {
    return squash(
      labelledBy
        .split(/\s+/)
        .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? '')
        .join(' '),
    );
  }
  const label = squash(element.getAttribute('aria-label'));
  if (label) return label;
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  ) {
    const labels = [...(element.labels ?? [])].map((each) => each.textContent).join(' ');
    if (squash(labels)) return squash(labels);
  }
  return element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement
    ? ''
    : squash(element.textContent);
}

/** One element of the contract, as one line. */
function contractLine(element: HTMLElement): string {
  const parts = [element.tagName.toLowerCase(), `"${accessibleName(element)}"`];
  if ('disabled' in element && element.disabled === true) parts.push('disabled');
  const tabindex = element.getAttribute('tabindex');
  if (tabindex !== null) parts.push(`tabindex=${tabindex}`);
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    parts.push(`= ${JSON.stringify(element.value)}`);
  }
  if (element instanceof HTMLInputElement && element.getAttribute('list')) parts.push('suggests');
  if (element instanceof HTMLSelectElement) {
    const options = [...element.options].map(
      (option) => `${option.selected ? '*' : ''}${squash(option.textContent)}`,
    );
    parts.push(`[${options.join(' | ')}]`);
  }
  return parts.join(' ');
}

/** The keyboard contract of everything under `root`, one line per element, in document order. */
export function controlContract(root: Element): string[] {
  return [...root.querySelectorAll<HTMLElement>(REACHABLE)].map(contractLine);
}
