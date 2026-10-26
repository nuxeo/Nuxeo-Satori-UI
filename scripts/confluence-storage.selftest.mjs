#!/usr/bin/env node
/**
 * Controls for `confluence-storage.mjs`, the Markdown → storage converter every publisher shares.
 *
 * The publishers need credentials CI does not have, so this is the only part of them CI runs.
 *
 * Usage:  node scripts/confluence-storage.selftest.mjs
 */

import { imageMacro, toStorage } from './confluence-storage.mjs';

/** Each control returns the output it judged, or throws; `want` decides. */
const CONTROLS = [
  [
    'an image line becomes an attachment image with its caption',
    () => toStorage('![Avatar & tag](avatar-side-by-side.png "Left: without. Right: with.")'),
    (out) =>
      out ===
      '<p><ac:image ac:align="center" ac:layout="center" ac:alt="Avatar &amp; tag">' +
        '<ri:attachment ri:filename="avatar-side-by-side.png" />' +
        '<ac:caption><p>Left: without. Right: with.</p></ac:caption></ac:image></p>',
  ],
  [
    'a single-quoted caption, as Prettier writes it, is a caption too',
    () => toStorage("![Alt](a.png 'Left (without). Right (with).')"),
    (out) => out.includes('<ac:caption><p>Left (without). Right (with).</p></ac:caption>'),
  ],
  [
    'an image line directly under a paragraph is not swallowed into it',
    () => toStorage('Text above\n![Alt](a.png)'),
    (out) => out.startsWith('<p>Text above</p>\n<p><ac:image') && !out.includes('!['),
  ],
  [
    'an image path is an error, not a broken attachment reference',
    () => toStorage('![Alt](images/a.png)'),
    'throws',
  ],
  [
    'imageMacro sets the width it is given',
    () => imageMacro({ alt: 'A', src: 'a.png', width: 640 }),
    (out) => out.includes('ac:width="640"'),
  ],
  [
    'HTML comments, single and multi-line, are dropped',
    () => toStorage('Before\n<!-- generator:marker -->\n\n<!--\nmulti\nline\n-->\nAfter'),
    (out) => out === '<p>Before</p>\n<p>After</p>',
  ],
  [
    'a relative link with no resolver is an error, not a guess',
    () => toStorage('See [the file](../x.md).'),
    'throws',
  ],
  [
    'a relative link goes through the resolver it is given',
    () =>
      toStorage('See [the file](../x.md).', {
        link: (href) => ({ kind: 'url', url: `https://example.test/${href.split('/').pop()}` }),
      }),
    (out) => out === '<p>See <a href="https://example.test/x.md">the file</a>.</p>',
  ],
  [
    'a Mermaid block goes through the callback it is given',
    () => toStorage('```mermaid\ngraph TD\n```', { mermaid: (i, src) => `[${i}:${src}]` }),
    (out) => out === '[1:graph TD]',
  ],
  [
    'tables survive, and emphasis inside a code span stays literal',
    () => toStorage('| A | B |\n| --- | --- |\n| `**x**` | **y** |'),
    (out) =>
      out ===
      '<table><tbody>\n<tr><th>A</th><th>B</th></tr>\n' +
        '<tr><td><code>**x**</code></td><td><strong>y</strong></td></tr>\n</tbody></table>',
  ],
];

let failed = 0;
for (const [name, run, want] of CONTROLS) {
  let ok;
  let detail;
  try {
    const out = run();
    ok = want !== 'throws' && want(out);
    detail = want === 'throws' ? 'did not throw' : `got ${JSON.stringify(out)}`;
  } catch (error) {
    ok = want === 'throws';
    detail = `threw ${error.message}`;
  }
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` — ${detail}`}`);
}

console.log();
if (failed === 0) console.log(`confluence-storage selftest: pass — ${CONTROLS.length} control(s).`);
else {
  console.error(`confluence-storage selftest: FAIL — ${failed} of ${CONTROLS.length} control(s).`);
  process.exitCode = 1;
}
