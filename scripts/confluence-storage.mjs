/**
 * Markdown → Confluence storage format, and attachment upload, for every publisher in this
 * repository.
 *
 * Kept apart from `publish-confluence.mjs`, which needs credentials before it does anything, so
 * `confluence-storage.selftest.mjs` can exercise it and a second publisher reuses it instead of
 * growing a second converter. What differs between publishers — where a relative link points,
 * how a Mermaid block becomes a picture — is passed in rather than decided here.
 */

// `"` and `'` are escaped because almost every call site puts the result inside a
// double-quoted XML attribute — `ac:alt="…"`, `href="…"`, `ri:content-title="…"`. Without them a
// title containing a quote closes the attribute early and injects the rest as markup. CodeQL's
// `js/incomplete-html-attribute-sanitization` flagged fourteen call sites of this one function.
export const esc = (s) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * The inverse of `esc`, for text that must reach the page raw — i.e. inside CDATA.
 *
 * `&amp;` must be undone LAST or `&amp;quot;` would decode to `"` in two steps rather than to
 * `&quot;` — the double-unescaping mirror of the double-escaping bug that put `Cost &amp;amp; TCO`
 * on a published page.
 */
export const unesc = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

/**
 * Inline formatting. Order matters: code spans are extracted first and restored last, so
 * `**` or `_` inside backticks is not treated as emphasis — the mistake that turns a code
 * sample into mangled bold text.
 *
 * @param {string} text
 * @param {((href: string) => { kind: 'page', title: string, anchor: string | null } | { kind: 'url', url: string }) | undefined} resolveLink
 *   where a non-`http(s)` link points; given the target unescaped. Absent, such a link is an error
 *   rather than a guess.
 */
function inline(text, resolveLink) {
  const codes = [];
  let s = text.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `@@CODE${codes.length - 1}@@`;
  });

  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    if (/^https?:/.test(href)) return `<a href="${esc(href)}">${label}</a>`;

    // `href` has been through `esc()` with the rest of the line, so undo it before resolving.
    if (!resolveLink) throw new Error(`relative link ${unesc(href)} needs a link resolver`);
    const link = resolveLink(unesc(href));

    // Another page in the set → a real Confluence page link, resolved by title.
    if (link.kind === 'page') {
      // The label is UNESCAPED here. `esc()` has already run over the whole string, so a
      // label like "Cost & TCO" arrives as "Cost &amp; TCO" — and CDATA preserves text
      // verbatim, so it would render to the reader as a literal "Cost &amp; TCO". Caught by
      // reading the rendered view rather than the storage format.
      const raw = unesc(label).replace(/]]>/g, ']]]]><![CDATA[>');
      return (
        `<ac:link${link.anchor ? ` ac:anchor="${esc(link.anchor)}"` : ''}>` +
        `<ri:page ri:content-title="${esc(link.title)}" />` +
        `<ac:plain-text-link-body><![CDATA[${raw}]]></ac:plain-text-link-body>` +
        `</ac:link>`
      );
    }

    return `<a href="${esc(link.url)}">${label}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(])_([^_]+)_/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<span style="text-decoration: line-through;">$1</span>');

  return s.replace(/@@CODE(\d+)@@/g, (_, i) => `<code>${esc(codes[Number(i)])}</code>`);
}

/** A Confluence code-block macro. */
export function codeMacro(lang, body) {
  const language =
    { ts: 'typescript', js: 'javascript', jsonc: 'json', sh: 'bash', text: 'text' }[lang] ??
    lang ??
    'text';
  return (
    `<ac:structured-macro ac:name="code" ac:schema-version="1">` +
    `<ac:parameter ac:name="language">${esc(language)}</ac:parameter>` +
    `<ac:plain-text-body><![CDATA[${body.replace(/]]>/g, ']]]]><![CDATA[>')}]]></ac:plain-text-body>` +
    `</ac:structured-macro>`
  );
}

/** An info/note panel, used for blockquotes. */
function panel(kind, body) {
  return (
    `<ac:structured-macro ac:name="${kind}" ac:schema-version="1">` +
    `<ac:rich-text-body>${body}</ac:rich-text-body></ac:structured-macro>`
  );
}

/** A Markdown image alone on its line: `![alt](file.png)` or `![alt](file.png "caption")`. */
const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)\s*$/;

/**
 * A page attachment rendered as an image, with an optional caption.
 *
 * Only a bare file name is accepted: the image is an attachment of the page it appears on, so a
 * path would name a file Confluence cannot see. `ac:width` is set and `ac:original-*` is not, for
 * the reason `mermaidBlock` in `publish-confluence.mjs` gives.
 *
 * @param {{ alt: string, src: string, caption?: string, width?: number }} image
 */
export function imageMacro({ alt, src, caption, width }) {
  if (!/^[\w.-]+$/.test(src)) {
    throw new Error(`image ${src}: only a bare attachment file name is supported`);
  }
  return (
    `<p><ac:image ac:align="center" ac:layout="center"${width ? ` ac:width="${width}"` : ''} ` +
    `ac:alt="${esc(alt)}"><ri:attachment ri:filename="${esc(src)}" />` +
    (caption ? `<ac:caption><p>${inline(caption)}</p></ac:caption>` : '') +
    `</ac:image></p>`
  );
}

/**
 * Convert a Markdown document to Confluence storage format.
 *
 * Deliberately a small, explicit converter rather than a dependency: the input is our own
 * Markdown, written by us, using a known subset. A general-purpose converter would add a
 * package to the lockfile — which in this repository is a gated artifact — to handle syntax
 * we do not use.
 *
 * HTML comments are dropped: they carry markers for generators and notes for maintainers, and
 * neither belongs on the page.
 *
 * @param {string} md
 * @param {{
 *   link?: (href: string) => { kind: 'page', title: string, anchor: string | null } | { kind: 'url', url: string },
 *   mermaid?: (index: number, source: string) => string,
 *   image?: (image: { alt: string, src: string, caption?: string }) => string,
 * }} [options] `mermaid` absent renders the source as a code block; `image` absent renders
 *   `imageMacro` without a width.
 */
export function toStorage(md, { link, mermaid, image } = {}) {
  let mermaidSeen = 0;
  // Strip YAML frontmatter — it is publishing metadata, not content.
  const body = md.replace(/^---\n[\s\S]*?\n---\n/, '');
  const lines = body.split('\n');
  const out = [];
  let i = 0;

  const flushTable = () => {
    const rows = [];
    while (i < lines.length && /^\s*\|/.test(lines[i])) {
      const cells = lines[i]
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((c) => c.trim());
      if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
      i += 1;
    }
    if (!rows.length) return;
    const [head, ...rest] = rows;
    out.push('<table><tbody>');
    out.push('<tr>' + head.map((c) => `<th>${inline(c, link)}</th>`).join('') + '</tr>');
    for (const r of rest)
      out.push('<tr>' + r.map((c) => `<td>${inline(c, link)}</td>`).join('') + '</tr>');
    out.push('</tbody></table>');
  };

  const flushList = (ordered) => {
    const tag = ordered ? 'ol' : 'ul';
    out.push(`<${tag}>`);
    let depth = 0;
    while (i < lines.length && /^\s*([-*]|\d+\.)\s/.test(lines[i])) {
      const indent = (lines[i].match(/^\s*/) ?? [''])[0].length;
      const content = lines[i].replace(/^\s*([-*]|\d+\.)\s+/, '');
      if (indent >= 2 && depth === 0) {
        out.push(`<${tag}>`);
        depth += 1;
      } else if (indent < 2 && depth > 0) {
        out.push(`</${tag}>`);
        depth -= 1;
      }
      out.push(`<li>${inline(content, link)}</li>`);
      i += 1;
    }
    while (depth-- > 0) out.push(`</${tag}>`);
    out.push(`</${tag}>`);
  };

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*<!--/.test(line)) {
      while (i < lines.length && !lines[i].includes('-->')) i += 1;
      i += 1;
      continue;
    }

    if (/^```/.test(line)) {
      const lang = line.replace(/^```/, '').trim();
      i += 1;
      const buf = [];
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i += 1;
      if (lang === 'mermaid') {
        mermaidSeen += 1;
        out.push(
          mermaid ? mermaid(mermaidSeen, buf.join('\n')) : codeMacro('text', buf.join('\n')),
        );
      } else {
        out.push(codeMacro(lang, buf.join('\n')));
      }
      continue;
    }

    const img = IMAGE_LINE.exec(line);
    if (img) {
      const spec = { alt: img[1], src: img[2], ...(img[3] ? { caption: img[3] } : {}) };
      out.push(image ? image(spec) : imageMacro(spec));
      i += 1;
      continue;
    }

    if (/^\s*\|/.test(line)) {
      flushTable();
      continue;
    }

    if (/^\s*([-*]|\d+\.)\s/.test(line)) {
      flushList(/^\s*\d+\./.test(line));
      continue;
    }

    if (/^>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push(panel('info', `<p>${inline(buf.join(' '), link)}</p>`));
      continue;
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      // The document's own H1 is dropped: Confluence renders the page title above the body,
      // so keeping it produces the title twice.
      if (h[1].length === 1 && out.length === 0) {
        i += 1;
        continue;
      }
      out.push(`<h${h[1].length}>${inline(h[2], link)}</h${h[1].length}>`);
      i += 1;
      continue;
    }

    if (/^---+$/.test(line)) {
      out.push('<hr />');
      i += 1;
      continue;
    }

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const buf = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6}\s|```|\s*\||\s*([-*]|\d+\.)\s|>|---+$|!\[|\s*<!--)/.test(lines[i])
    ) {
      buf.push(lines[i++]);
    }
    out.push(`<p>${inline(buf.join(' '), link)}</p>`);
  }

  return out.join('\n');
}

/**
 * Upload a file as a page attachment, or replace the attachment of the same name.
 *
 * `POST .../child/attachment` creates; it rejects a duplicate filename, so on conflict the
 * existing attachment's id is looked up and its data replaced. Without that second path,
 * re-running a publisher would fail on every page that already has the file — which would
 * make the whole thing single-use.
 *
 * @param {{ base: string, auth: string, pageId: string, filename: string, absPath: string,
 *   contentType?: string }} args `auth` is a complete `Authorization` header value.
 * @returns {Promise<'created' | 'replaced'>}
 */
export async function uploadAttachment({
  base,
  auth,
  pageId,
  filename,
  absPath,
  contentType = 'image/png',
}) {
  const { readFileSync } = await import('node:fs');
  const form = () => {
    const body = new FormData();
    body.append('file', new Blob([readFileSync(absPath)], { type: contentType }), filename);
    body.append('minorEdit', 'true');
    return body;
  };
  const headers = { Authorization: auth, 'X-Atlassian-Token': 'no-check' };

  const post = await fetch(`${base}/rest/api/content/${pageId}/child/attachment`, {
    method: 'POST',
    headers,
    body: form(),
  });
  if (post.ok) return 'created';

  const res = await fetch(
    `${base}/rest/api/content/${pageId}/child/attachment?filename=${encodeURIComponent(filename)}`,
    { headers: { Authorization: auth, Accept: 'application/json' } },
  );
  if (!res.ok) {
    throw new Error(`upload ${filename}: ${post.status}, then listing attachments → ${res.status}`);
  }
  const existing = (await res.json()).results?.[0];
  if (!existing) throw new Error(`upload ${filename}: ${post.status} and no existing attachment`);

  const put = await fetch(
    `${base}/rest/api/content/${pageId}/child/attachment/${existing.id}/data`,
    { method: 'POST', headers, body: form() },
  );
  if (!put.ok)
    throw new Error(`replace ${filename}: ${put.status} ${(await put.text()).slice(0, 200)}`);
  return 'replaced';
}
