#!/usr/bin/env node
/**
 * Negative controls for `storybook-dialog-layout.mjs`, the layout check every `Dialogs/` story runs.
 *
 * A check that cannot fail proves nothing, so each rule has a fixture that breaks it and must be
 * reported, and the rules that could fail a correct dialog have a control that must pass: a dialog
 * laid out with Material's spacing and a shadow, a pill button inside a rounded corner, a visually
 * hidden title, a free-text field scrolling a long value. The fixtures are plain HTML with the
 * class names Material's dialog uses, so they test the check and not Angular.
 *
 * Needs `@playwright/test` and Chromium, as `storybook-interactions.mjs` does:
 *   node --test scripts/storybook-dialog-layout.selftest.mjs
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { checkDialogLayout } from './storybook-dialog-layout.mjs';

const { chromium } = await import('@playwright/test').catch(() => {
  console.error(
    'storybook-dialog-layout.selftest: @playwright/test is not installed; see storybook-interactions.mjs.',
  );
  process.exit(2);
});

/** A dialog laid out as MatDialog lays it out: the control every fixture breaks one part of. */
const BASE_CSS = `
  body { margin: 0; font: 14px/20px sans-serif; background: #fff; }
  #storybook-root { display: flex; justify-content: center; padding: 16px 0; }
  .mat-mdc-dialog-surface {
    display: flex; flex-direction: column; box-sizing: border-box; width: 400px;
    overflow-y: auto; border-radius: 28px; background: #e8e8f0;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
  }
  .mat-mdc-dialog-title { margin: 0; padding: 6px 24px 13px; font-size: 22px; line-height: 28px; }
  .mat-mdc-dialog-title::before { display: inline-block; width: 0; height: 40px; content: ''; }
  .mat-mdc-dialog-content { padding: 0 24px; }
  .mat-mdc-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 16px 24px; }
  button { height: 40px; padding: 0 16px; border: 0; border-radius: 20px; background: #c8c8e0; }
  button:focus-visible { outline: 3px solid #1a3cff; outline-offset: 2px; }
  input { box-sizing: border-box; width: 100%; height: 40px; border: 1px solid #888; }
`;

const dialog = ({
  css = '',
  title = '<h2 class="mat-mdc-dialog-title">Rename</h2>',
  content,
} = {}) => `
  <style>${BASE_CSS}${css}</style>
  <div id="storybook-root">
    <div class="mat-mdc-dialog-surface">
      ${title}
      <div class="mat-mdc-dialog-content">
        ${content ?? '<input class="mat-datepicker-input" aria-label="To" value="2/1/2031" />'}
      </div>
      <div class="mat-mdc-dialog-actions"><button>Cancel</button><button>Rename</button></div>
    </div>
  </div>
`;

let browser;
before(async () => {
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
});

async function check(html, width = 1280) {
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  try {
    await page.setContent(html);
    return await checkDialogLayout(page);
  } finally {
    await page.close();
  }
}

const reports = (failures, pattern) =>
  assert.ok(
    failures.some((failure) => pattern.test(failure)),
    `expected a failure matching ${pattern}, got:\n  ${failures.join('\n  ') || '(none)'}`,
  );

// ---------------------------------------------------------------- controls: must pass

test('a dialog laid out with Material spacing, with a shadow, passes at 1280 and 320 px', async () => {
  assert.deepEqual(await check(dialog()), []);
  assert.deepEqual(
    await check(dialog({ css: '.mat-mdc-dialog-surface { width: auto; max-width: 288px; }' }), 320),
    [],
  );
});

test('a pill button 24 px in and 16 px up sits inside the rounded corner', async () => {
  assert.deepEqual(
    await check(dialog({ css: '.mat-mdc-dialog-actions { justify-content: flex-start; }' })),
    [],
  );
});

test('a visually hidden title in the corner is not judged', async () => {
  const hidden =
    '<h2 class="mat-mdc-dialog-title" style="position: absolute; width: 1px; height: 1px; ' +
    'padding: 0; margin: 0; overflow: hidden; clip: rect(0 0 0 0)">Checking</h2>';
  assert.deepEqual(await check(dialog({ title: hidden })), []);
});

/** A required field that, once left empty, shows its message under it and grows the surface. */
const REVEALS_ON_LEAVE =
  '<input aria-label="To" required onblur="this.nextElementSibling.hidden = this.value !== \'\'" />' +
  '<p hidden style="margin: 4px 0 0; color: #b00020">Required</p>';

test('a message that leaving a required field reveals is not focus painting outside', async () => {
  assert.deepEqual(await check(dialog({ content: REVEALS_ON_LEAVE })), []);
  assert.deepEqual(
    await check(
      dialog({
        content: REVEALS_ON_LEAVE,
        css: '.mat-mdc-dialog-surface { width: auto; max-width: 288px; }',
      }),
      320,
    ),
    [],
  );
});

test('a free-text field scrolling a long value is not judged', async () => {
  const content = '<input aria-label="Title" value="Claim 42 — water damage, final, reviewed" />';
  assert.deepEqual(await check(dialog({ content, css: 'input { width: 120px; }' })), []);
});

test('a focusable element outside the dialog is tabbed past, not judged', async () => {
  // Beside the surface, so its focus ring paints inside the screenshot around it, outside the
  // outline. It is not the dialog's, so it must not count.
  const reset = '<button style="align-self: center">Reset</button>';
  const html = dialog().replace('<div id="storybook-root">', `<div id="storybook-root">${reset}`);
  assert.deepEqual(await check(html), []);
});

test('the surface may be found by a background and any rounded corner', async () => {
  const html = dialog().replace('class="mat-mdc-dialog-surface"', 'class="painted"');
  const css = BASE_CSS.replaceAll('.mat-mdc-dialog-surface', '.painted').replace(
    'border-radius: 28px;',
    'border-radius: 0 0 28px 28px;',
  );
  assert.deepEqual(await check(html.replace(BASE_CSS, css)), []);
});

test('the surface may be found without Material classes, by its background and corners', async () => {
  const html = dialog().replace('class="mat-mdc-dialog-surface"', 'class="painted"');
  const css = BASE_CSS.replaceAll('.mat-mdc-dialog-surface', '.painted');
  assert.deepEqual(await check(html.replace(BASE_CSS, css)), []);
});

test('text-only dialog content is checked for side spacing', async () => {
  // Content with direct text nodes, no child elements: the check must still measure spacing.
  const content = 'This dialog has only text in its content, no elements.';
  assert.deepEqual(await check(dialog({ content })), []);
});

// ---------------------------------------------------------------- each rule: must fail

test('title flush with the surface: in the corner and too close to the edges', async () => {
  const failures = await check(dialog({ css: '.mat-mdc-dialog-title { padding: 0; }' }));
  reports(failures, /title text 0 px from the surface's left edge/);
  reports(failures, /title text -?\d+ px from the surface's top edge/);
  reports(failures, /outside the surface or its rounded corners: <h2/);
});

test('content flush with the sides', async () => {
  const failures = await check(dialog({ css: '.mat-mdc-dialog-content { padding: 0; }' }));
  reports(failures, /content 0 px from the surface's left edge/);
  reports(failures, /content 0 px from the surface's right edge/);
});

test('buttons on the bottom edge and in the corner', async () => {
  const failures = await check(
    dialog({
      css: '.mat-mdc-dialog-actions { padding: 0; justify-content: space-between; }',
    }),
  );
  reports(failures, /"Cancel" 0 px from the surface's bottom edge/);
  reports(failures, /"Cancel" 0 px from the surface's left edge/);
  reports(failures, /"Rename" 0 px from the surface's right edge/);
  reports(failures, /outside the surface or its rounded corners: .*<button/);
});

test('content wider than the surface, with nothing clipping it, widens the page', async () => {
  const failures = await check(
    dialog({
      css: '.mat-mdc-dialog-surface { overflow: visible; }',
      content: '<div style="width: 420px; height: 20px; border: 1px solid #333"></div>',
    }),
    320,
  );
  reports(failures, /outside the surface or its rounded corners: <div/);
  reports(failures, /the page scrolls sideways: \d+ px wide in a 320 px window/);
});

test('content wider than its scroll container scrolls sideways inside the dialog', async () => {
  const failures = await check(
    dialog({
      css: '.mat-mdc-dialog-content { overflow: auto; }',
      content: '<div style="width: 600px; height: 20px; border: 1px solid #333"></div>',
    }),
  );
  reports(failures, /<div.mat-mdc-dialog-content> scrolls sideways: \d+ px of content in \d+ px/);
});

test('a message that leaving a field reveals, wider than its scroll container', async () => {
  // Laid out only after the field is left, so a check of the dialog as it opens never sees it.
  const content =
    '<input aria-label="To" required onblur="this.nextElementSibling.hidden = false" />' +
    '<p hidden style="width: 600px; margin: 4px 0 0">Required</p>';
  const failures = await check(
    dialog({ content, css: '.mat-mdc-dialog-content { overflow: auto; }' }),
  );
  reports(
    failures,
    /after leaving each field: <div.mat-mdc-dialog-content>.* scrolls sideways: \d+ px of content/,
  );
});

test('a date field narrower than its date', async () => {
  const failures = await check(dialog({ css: 'input { width: 40px; }' }));
  reports(failures, /the "To" field cuts off "2\/1\/2031"/);
});

test('a form field truncating its value with an ellipsis', async () => {
  const content =
    '<div class="mat-mdc-form-field"><label>Right</label><span style="display: block; ' +
    'width: 40px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis">Read and write</span></div>';
  reports(await check(dialog({ content })), /the "Right" field truncates "Read and write"/);
});

test('a focus ring painting outside the rounded corner', async () => {
  // Nothing clips the surface, and Cancel sits in its corner: the ring crosses the outline.
  const failures = await check(
    dialog({
      css:
        '.mat-mdc-dialog-surface { overflow: visible; }' +
        '.mat-mdc-dialog-actions { padding: 0; justify-content: flex-start; }',
    }),
  );
  reports(failures, /focusing <button> "Cancel" paints \d+ px outside the surface/);
});

test('a focus ring outside the corner, in a dialog whose fields reveal messages when left', async () => {
  // The unjudged first pass settles the revealed message; it must not settle the ring as well.
  const failures = await check(
    dialog({
      content: REVEALS_ON_LEAVE,
      css:
        '.mat-mdc-dialog-surface { overflow: visible; }' +
        '.mat-mdc-dialog-actions { padding: 0; justify-content: flex-start; }',
    }),
  );
  reports(failures, /focusing <button> "Cancel" paints \d+ px outside the surface/);
});

test('no surface: nothing paints the dialog', async () => {
  const html = dialog().replace('class="mat-mdc-dialog-surface"', 'class="bare"');
  reports(await check(html), /no dialog surface/);
});

test('no dialog on the page', async () => {
  reports(
    await check('<div id="storybook-root"><p>Nothing here</p></div>'),
    /no dialog on the page/,
  );
});

test('a hidden surface is reported, not passed with a zero-rect', async () => {
  const failures = await check(dialog({ css: '.mat-mdc-dialog-surface { display: none; }' }));
  reports(failures, /the dialog surface is hidden/);
});

test('an invisible preview container hides the dialog', async () => {
  // opacity: 0 on the story root makes the dialog invisible while layout measurements pass.
  const failures = await check(dialog({ css: '#storybook-root { opacity: 0; }' }));
  reports(failures, /the dialog surface is hidden/);
});
