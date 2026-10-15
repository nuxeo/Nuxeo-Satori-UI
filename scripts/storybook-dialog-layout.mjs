/**
 * The layout check `storybook-interactions.mjs` runs on every `Dialogs/` story: the preview must lay
 * the dialog out as MatDialog does in the application, at 1280 px and at 320 px (NXSAT-695).
 *
 * A story shows its dialog inline rather than through MatDialog, so nothing else notices when a
 * preview drifts from the dialog a page opens. Six of the seven dialogs once showed their title in
 * the rounded corner and their buttons on the bottom edge, because nothing loaded Material's dialog
 * stylesheet, and every story still passed.
 *
 * Everything is measured in the page, from bounding boxes and computed styles:
 *
 * - **The surface** is the element that paints the dialog: Material's `.mat-mdc-dialog-surface`, or
 *   failing that the nearest ancestor of the title with a background and rounded corners. A page
 *   with neither fails.
 * - **Inside the surface.** Every element that paints (a background, a border, a shadow, text, an
 *   image or a form control) lies inside the surface, rounded corners included. The part of an
 *   element an inner scroll container hides is not counted; the container scrolling sideways is.
 * - **Spacing, Material's dialog spacing.** The title's text at least 24 px inside the left, right
 *   and top edges; whatever the content paints at least 24 px from the sides; every action button
 *   at least 16 px above the bottom and 24 px from the sides.
 * - **No clipped value.** No date, time or number field holds more than it shows, and no select
 *   truncates its value with an ellipsis: a value of a fixed format is read whole, and "2/1/2031"
 *   once showed as "2/1/2". A free-text field scrolls a long value by design and is not judged.
 * - **No sideways scroll.** Neither the page nor anything inside the surface scrolls sideways.
 * - **Focus stays inside.** Tabbing through the dialog, focusing an element changes no pixel outside
 *   the surface's rounded outline. A screenshot around the surface with the element focused is
 *   compared with one taken with nothing focused, so the surface's own shadow and anti-aliasing,
 *   which do not change, are never counted.
 *
 * A title that is visually hidden (Nuxeo Drive's while it checks) names the dialog and paints
 * nothing, so it is not judged.
 *
 * `storybook-dialog-layout.selftest.mjs` holds the negative controls: one fixture per rule that
 * must fail, and a dialog laid out as MatDialog lays it out that must pass.
 */

/** The widths every `Dialogs/` story is checked at: a desktop window, and the narrowest phone. */
export const DIALOG_LAYOUT_WIDTHS = [1280, 320];

/** Material's dialog spacing, from `MatDialogContainer`'s stylesheet, in CSS pixels. */
export const DIALOG_LAYOUT_RULES = Object.freeze({
  titleInset: 24,
  contentInset: 24,
  actionsBottom: 16,
  actionsSide: 24,
  // Layout lands on fractions of a pixel; a box 23.6 px in is 24 px on screen.
  tolerance: 0.5,
});

/** A story is a dialog story when its title is in the `Dialogs` group. */
export const isDialogStory = (story) => /^Dialogs\//.test(story.title ?? '');

/**
 * Runs in the page and returns `{ failures, surface }`. Self-contained, because Playwright sends
 * the function's source and not its scope: every helper is declared inside it.
 *
 * `rules.root` selects the element the dialog is looked for in, `#storybook-root` by default;
 * `rules.index` picks one when the selector matches several, as the previews of a docs page do.
 */
export function measureDialogLayout(rules) {
  const { titleInset, contentInset, actionsBottom, actionsSide, tolerance } = rules;
  const failures = [];
  const px = (n) => `${Math.round(n)} px`;
  const style = (el) => getComputedStyle(el);
  const alpha = (color) => {
    if (!color || color === 'transparent') return 0;
    const slash = color.match(/\/\s*([\d.]+%?)\s*\)$/);
    if (slash) return slash[1].endsWith('%') ? parseFloat(slash[1]) / 100 : parseFloat(slash[1]);
    const rgba = color.match(/^rgba\(([^)]+)\)$/);
    return rgba ? parseFloat(rgba[1].split(',')[3]) : 1;
  };
  const describe = (el) => {
    const name = [...el.classList].find((c) => !/^(ng-|_|cdk-|mdc-)/.test(c));
    const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 30);
    return `<${el.localName}${name ? `.${name}` : ''}>${text ? ` "${text}"` : ''}`;
  };

  const roots = document.querySelectorAll(rules.root ?? '#storybook-root');
  const root = roots[rules.index ?? 0] ?? document.body;
  const titles = [...root.querySelectorAll('.mat-mdc-dialog-title')];
  const anchor =
    titles[0] ?? root.querySelector('.mat-mdc-dialog-content, .mat-mdc-dialog-actions');
  if (!anchor) {
    return { failures: ['no dialog on the page: no dialog title, content or actions'] };
  }
  const painted = (el) => {
    const st = style(el);
    return alpha(st.backgroundColor) > 0 && parseFloat(st.borderTopLeftRadius) > 0;
  };
  let surface = anchor.closest('.mat-mdc-dialog-surface');
  for (let n = anchor.parentElement; !surface && n && n !== document.body; n = n.parentElement) {
    if (painted(n)) surface = n;
  }
  if (!surface) {
    return {
      failures: [
        'no dialog surface: no .mat-mdc-dialog-surface, and no ancestor of the dialog with a ' +
          'background and rounded corners',
      ],
    };
  }

  const s = surface.getBoundingClientRect();
  const surfaceStyle = style(surface);
  const half = Math.min(s.width, s.height) / 2;
  const radius = (value) => Math.min(parseFloat(value) || 0, half);
  const corner = {
    tl: radius(surfaceStyle.borderTopLeftRadius),
    tr: radius(surfaceStyle.borderTopRightRadius),
    br: radius(surfaceStyle.borderBottomRightRadius),
    bl: radius(surfaceStyle.borderBottomLeftRadius),
  };
  /** Whether a point lies inside the surface's rounded outline. */
  const inside = (x, y, slack = tolerance) => {
    if (x < s.left - slack || x > s.right + slack || y < s.top - slack || y > s.bottom + slack) {
      return false;
    }
    const arc = (cx, cy, r) => Math.hypot(x - cx, y - cy) <= r + slack;
    if (x < s.left + corner.tl && y < s.top + corner.tl)
      return arc(s.left + corner.tl, s.top + corner.tl, corner.tl);
    if (x > s.right - corner.tr && y < s.top + corner.tr)
      return arc(s.right - corner.tr, s.top + corner.tr, corner.tr);
    if (x > s.right - corner.br && y > s.bottom - corner.br)
      return arc(s.right - corner.br, s.bottom - corner.br, corner.br);
    if (x < s.left + corner.bl && y > s.bottom - corner.bl)
      return arc(s.left + corner.bl, s.bottom - corner.bl, corner.bl);
    return true;
  };
  /**
   * Whether a box lies inside the outline. The outline is convex, so its corners decide; a corner
   * the box rounds itself is tested along its arc, so a pill button in a corner is not failed for
   * the square corner it does not paint.
   */
  const boxInside = (box, radii = [0, 0, 0, 0]) => {
    const [tl, tr, br, bl] = radii.map((r) =>
      Math.min(r, (box.right - box.left) / 2, (box.bottom - box.top) / 2),
    );
    const points = [];
    const arc = (cx, cy, r, from) => {
      for (let i = 0; i <= 4; i++) {
        const a = from + (i * Math.PI) / 8;
        points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
    };
    arc(box.left + tl, box.top + tl, tl, Math.PI);
    arc(box.right - tr, box.top + tr, tr, 1.5 * Math.PI);
    arc(box.right - br, box.bottom - br, br, 0);
    arc(box.left + bl, box.bottom - bl, bl, 0.5 * Math.PI);
    return points.every(([x, y]) => inside(x, y));
  };

  const hidden = (el) => {
    if (style(el).visibility === 'hidden') return true;
    for (let n = el; n && n !== surface.parentElement; n = n.parentElement) {
      const st = style(n);
      if (st.display === 'none' || parseFloat(st.opacity) === 0) return true;
      // Visually hidden, as `.cdk-visually-hidden` and Nuxeo Drive's checking title are.
      if (/^rect\(0px,? 0px,? 0px,? 0px\)$/.test(st.clip) || st.clipPath === 'inset(50%)') {
        return true;
      }
    }
    return false;
  };
  const isReplaced = (el) =>
    ['img', 'svg', 'video', 'canvas', 'input', 'textarea', 'select', 'iframe'].includes(
      el.localName,
    );
  const paints = (el, st) => {
    if (isReplaced(el)) return true;
    if (alpha(st.backgroundColor) > 0 || st.backgroundImage !== 'none') return true;
    if (st.boxShadow !== 'none') return true;
    return ['Top', 'Right', 'Bottom', 'Left'].some(
      (side) =>
        parseFloat(st[`border${side}Width`]) > 0 &&
        !['none', 'hidden'].includes(st[`border${side}Style`]) &&
        alpha(st[`border${side}Color`]) > 0,
    );
  };
  /** The part of a box its ancestors inside the surface do not clip, or `null` when none is left. */
  const unclipped = (from, box) => {
    let { left, top, right, bottom } = box;
    for (let n = from; n && n !== surface; n = n.parentElement) {
      const st = style(n);
      if (st.overflowX === 'visible' && st.overflowY === 'visible') continue;
      const c = n.getBoundingClientRect();
      if (st.overflowX !== 'visible')
        [left, right] = [Math.max(left, c.left), Math.min(right, c.right)];
      if (st.overflowY !== 'visible')
        [top, bottom] = [Math.max(top, c.top), Math.min(bottom, c.bottom)];
    }
    return right - left > tolerance && bottom - top > tolerance
      ? { left, top, right, bottom }
      : null;
  };
  const textBoxes = (el) => {
    const boxes = [];
    for (const node of el.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const box of range.getClientRects()) {
        if (box.width > 0 && box.height > 0) boxes.push(box);
      }
    }
    return boxes;
  };
  /** What an element paints, as boxes with their own corner radii, minus what is clipped away. */
  const paintedBoxes = (el) => {
    if (el.closest('svg') && el.localName !== 'svg') return [];
    if (hidden(el)) return [];
    const st = style(el);
    const boxes = [];
    if (paints(el, st)) {
      const box = unclipped(el.parentElement, el.getBoundingClientRect());
      const radii = [
        st.borderTopLeftRadius,
        st.borderTopRightRadius,
        st.borderBottomRightRadius,
        st.borderBottomLeftRadius,
      ].map((r) => parseFloat(r) || 0);
      if (box) boxes.push({ box, radii });
    }
    for (const text of textBoxes(el)) {
      const box = unclipped(el, text);
      if (box) boxes.push({ box, radii: [0, 0, 0, 0] });
    }
    return boxes;
  };
  const edges = (box) =>
    `${px(box.left - s.left)} from the left, ${px(s.right - box.right)} from the right, ` +
    `${px(box.top - s.top)} from the top, ${px(s.bottom - box.bottom)} from the bottom`;

  // Inside the surface, rounded corners included.
  const outside = [];
  for (const el of surface.querySelectorAll('*')) {
    const escaped = paintedBoxes(el).find(({ box, radii }) => !boxInside(box, radii));
    if (escaped) outside.push(`${describe(el)} (${edges(escaped.box)})`);
  }
  if (outside.length) {
    failures.push(
      `${outside.length} element(s) outside the surface or its rounded corners: ` +
        `${outside.slice(0, 4).join('; ')}${outside.length > 4 ? '; …' : ''}`,
    );
  }

  // Spacing: the title.
  const title = titles.find((t) => surface.contains(t) && !hidden(t));
  if (title) {
    const boxes = [title, ...title.querySelectorAll('*')]
      .filter((el) => !hidden(el))
      .flatMap(textBoxes);
    if (boxes.length) {
      const left = Math.min(...boxes.map((b) => b.left)) - s.left;
      const right = s.right - Math.max(...boxes.map((b) => b.right));
      const top = Math.min(...boxes.map((b) => b.top)) - s.top;
      for (const [edge, gap] of [
        ['left', left],
        ['right', right],
        ['top', top],
      ]) {
        if (gap < titleInset - tolerance) {
          failures.push(
            `title text ${px(gap)} from the surface's ${edge} edge (MatDialog: ${titleInset})`,
          );
        }
      }
    }
  }

  // Spacing: the content.
  for (const content of surface.querySelectorAll('.mat-mdc-dialog-content')) {
    if (hidden(content)) continue;
    const boxes = [...content.querySelectorAll('*')].flatMap((el) =>
      paintedBoxes(el).map(({ box }) => box),
    );
    if (!boxes.length) continue;
    const left = Math.min(...boxes.map((b) => b.left)) - s.left;
    const right = s.right - Math.max(...boxes.map((b) => b.right));
    for (const [edge, gap] of [
      ['left', left],
      ['right', right],
    ]) {
      if (gap < contentInset - tolerance) {
        failures.push(
          `content ${px(gap)} from the surface's ${edge} edge (MatDialog: ${contentInset})`,
        );
      }
    }
  }

  // Spacing: the action buttons.
  for (const actions of surface.querySelectorAll('.mat-mdc-dialog-actions')) {
    for (const button of actions.querySelectorAll('button, a[href], [role="button"]')) {
      if (hidden(button)) continue;
      const b = button.getBoundingClientRect();
      const gaps = [
        ['bottom', s.bottom - b.bottom, actionsBottom],
        ['left', b.left - s.left, actionsSide],
        ['right', s.right - b.right, actionsSide],
      ];
      for (const [edge, gap, needed] of gaps) {
        if (gap < needed - tolerance) {
          failures.push(
            `${describe(button)} ${px(gap)} from the surface's ${edge} edge (MatDialog: ${needed})`,
          );
        }
      }
    }
  }

  // No clipped value.
  const fieldName = (el) =>
    el.closest('.mat-mdc-form-field')?.querySelector('mat-label, label')?.textContent?.trim() ||
    el.getAttribute('aria-label') ||
    el.getAttribute('name') ||
    describe(el);
  const fixedFormat = (input) =>
    input.classList.contains('mat-datepicker-input') ||
    ['date', 'time', 'datetime-local', 'month', 'week', 'number'].includes(input.type);
  for (const input of surface.querySelectorAll('input')) {
    if (hidden(input) || !input.value || !fixedFormat(input)) continue;
    if (input.scrollWidth > input.clientWidth + 1) {
      failures.push(
        `the "${fieldName(input)}" field cuts off "${input.value}": ` +
          `${input.scrollWidth} px of text in ${input.clientWidth} px`,
      );
    }
  }
  for (const el of surface.querySelectorAll('.mat-mdc-form-field *')) {
    const st = style(el);
    if (st.textOverflow !== 'ellipsis' || st.overflowX === 'visible' || hidden(el)) continue;
    if (el.scrollWidth > el.clientWidth + 1) {
      failures.push(
        `the "${fieldName(el)}" field truncates "${el.textContent.trim()}": ` +
          `${el.scrollWidth} px of text in ${el.clientWidth} px`,
      );
    }
  }

  // No sideways scroll.
  const page = document.documentElement;
  if (page.scrollWidth > window.innerWidth + 1) {
    failures.push(
      `the page scrolls sideways: ${page.scrollWidth} px wide in a ${window.innerWidth} px window`,
    );
  }
  for (const el of [surface, ...surface.querySelectorAll('*')]) {
    if (['input', 'textarea'].includes(el.localName) || hidden(el)) continue;
    const { overflowX } = style(el);
    if (!['auto', 'scroll'].includes(overflowX) || el.scrollWidth <= el.clientWidth + 1) continue;
    failures.push(
      `${el === surface ? 'the surface' : describe(el)} scrolls sideways: ` +
        `${el.scrollWidth} px of content in ${el.clientWidth} px`,
    );
  }

  return {
    failures,
    surface: { left: s.left, top: s.top, right: s.right, bottom: s.bottom, corner },
  };
}

/**
 * Runs in the page: what Tab focused, whether it is inside the surface `measureDialogLayout`
 * found, and where the window is scrolled to.
 */
function focusState(rules) {
  const roots = document.querySelectorAll(rules.root ?? '#storybook-root');
  const root = roots[rules.index ?? 0] ?? document.body;
  const active = document.activeElement;
  const text = (active?.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 30);
  const label = active?.getAttribute('aria-label') ?? active?.getAttribute('name');
  return {
    inside: !!active && active !== document.body && root.contains(active),
    name: active
      ? `<${active.localName}>${text ? ` "${text}"` : ''}${label ? ` [${label}]` : ''}`
      : null,
    id: active ? [...document.querySelectorAll('*')].indexOf(active) : -1,
    scroll: [window.scrollX, window.scrollY],
    tabbable: [
      ...root.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
          'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((el) => el.getClientRects().length > 0).length,
  };
}

/**
 * Runs in the page: how many pixels differ between two screenshots of the same clip, counting
 * only those outside the surface's rounded outline. A pixel within a pixel of the outline is
 * anti-aliasing against the outline itself and is not counted.
 */
async function pixelsChangedOutside({ before, after, clip, surface }) {
  const load = async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, image.width, image.height);
  };
  const [a, b] = await Promise.all([load(before), load(after)]);
  const scale = a.width / clip.width;
  const s = surface;
  const c = surface.corner;
  const inside = (x, y) => {
    const slack = 1;
    if (x < s.left - slack || x > s.right + slack || y < s.top - slack || y > s.bottom + slack) {
      return false;
    }
    const arc = (cx, cy, r) => Math.hypot(x - cx, y - cy) <= r + slack;
    if (x < s.left + c.tl && y < s.top + c.tl) return arc(s.left + c.tl, s.top + c.tl, c.tl);
    if (x > s.right - c.tr && y < s.top + c.tr) return arc(s.right - c.tr, s.top + c.tr, c.tr);
    if (x > s.right - c.br && y > s.bottom - c.br)
      return arc(s.right - c.br, s.bottom - c.br, c.br);
    if (x < s.left + c.bl && y > s.bottom - c.bl) return arc(s.left + c.bl, s.bottom - c.bl, c.bl);
    return true;
  };
  let count = 0;
  let first = null;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const pageX = clip.x + (x + 0.5) / scale;
      const pageY = clip.y + (y + 0.5) / scale;
      if (inside(pageX, pageY)) continue;
      const i = (y * a.width + x) * 4;
      const delta = Math.max(
        Math.abs(a.data[i] - b.data[i]),
        Math.abs(a.data[i + 1] - b.data[i + 1]),
        Math.abs(a.data[i + 2] - b.data[i + 2]),
      );
      if (delta > 8) {
        count++;
        first ??= [Math.round(pageX - s.left), Math.round(pageY - s.top)];
      }
    }
  }
  return { count, first };
}

/** How long a focus indicator takes to appear: Material's state layers fade in. */
const SETTLE_MS = 250;
/** Pixels around the surface the focus screenshots include; a ring rarely reaches 4 px. */
const MARGIN = 12;
/** Tab presses at most, so a dialog that keeps focus cannot hold the run. */
const MAX_TABS = 24;

/**
 * Checks the dialog the page shows: the layout rules, then Tab through it for focus indicators.
 * Returns failure messages; none means the dialog is laid out as MatDialog lays it out.
 */
export async function checkDialogLayout(page, options = {}) {
  const rules = { ...DIALOG_LAYOUT_RULES, ...options };
  await page.evaluate(() => window.scrollTo(0, 0));
  const { failures, surface: measured } = await page.evaluate(measureDialogLayout, rules);
  if (!measured) return failures;
  failures.push(...(await checkFocus(page, rules)));
  return failures;
}

/**
 * Tab through the dialog and fail each element whose focus indicator paints outside the surface.
 *
 * The window is made as tall as the page first, so focusing an element never scrolls it out of
 * the screenshot, and restored after. Tabbing starts from a click beside the surface: after a
 * `blur()` the browser would resume from the element that had focus and skip those before it.
 */
async function checkFocus(page, rules) {
  const failures = [];
  const viewport = page.viewportSize();
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  if (viewport && height > viewport.height) {
    await page.setViewportSize({ width: viewport.width, height });
  }
  try {
    const { surface } = await page.evaluate(measureDialogLayout, rules);
    if (!surface) return failures;
    const size = await page.evaluate(() => [window.innerWidth, window.innerHeight]);
    const left = Math.max(0, Math.floor(surface.left - MARGIN));
    const top = Math.max(0, Math.floor(surface.top - MARGIN));
    const clip = {
      x: left,
      y: top,
      width: Math.min(size[0], Math.ceil(surface.right + MARGIN)) - left,
      height: Math.min(size[1], Math.ceil(surface.bottom + MARGIN)) - top,
    };
    if (clip.width <= 0 || clip.height <= 0) return failures;

    const beside =
      surface.left >= 2 ? [1, Math.max(1, surface.top)] : [1, Math.max(1, surface.top - 2)];
    await page.mouse.click(beside[0], beside[1]);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(SETTLE_MS);
    const start = await page.evaluate(focusState, rules);
    const before = (await page.screenshot({ clip })).toString('base64');
    const seen = new Set();
    for (let i = 0; i < MAX_TABS; i++) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(SETTLE_MS);
      const state = await page.evaluate(focusState, rules);
      if (!state.inside || seen.has(state.id)) break;
      seen.add(state.id);
      if (state.scroll.join() !== start.scroll.join()) {
        await page.evaluate(([x, y]) => window.scrollTo(x, y), start.scroll);
        await page.waitForTimeout(50);
      }
      const after = (await page.screenshot({ clip })).toString('base64');
      const changed = await page.evaluate(pixelsChangedOutside, { before, after, clip, surface });
      if (changed.count > 0) {
        failures.push(
          `focusing ${state.name} paints ${changed.count} px outside the surface ` +
            `(the first ${changed.first[0]} px across and ${changed.first[1]} px down from its ` +
            'top-left corner)',
        );
      }
    }
    if (seen.size === 0 && start.tabbable > 0) {
      failures.push(`Tab never reached the dialog's ${start.tabbable} focusable element(s)`);
    }
  } finally {
    if (viewport && height > viewport.height) await page.setViewportSize(viewport);
  }
  return failures;
}
