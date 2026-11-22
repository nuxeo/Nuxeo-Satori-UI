/**
 * The form a branding image's source must have: version 1's rules, unchanged. A configured image
 * address has the same hazards in `app.json` as in version 1's bootstrap, and version 1's checks
 * have been corrected four times; a fresh set would not have had those corrections. So this is a
 * copy of `describeLogoSrcForm` in `libs/shared/app-config/src/lib/bootstrap-config.ts`, which
 * cannot be imported here without Angular, and `image-source.spec.ts` fails the moment the two
 * differ.
 *
 * Version 1 still decides at run time, where it also knows the server's address and refuses an
 * image that points back at Nuxeo. This is the part a package can be held to before it ships.
 *
 * Returns why the source is refused, or `null` when its form is accepted.
 */
export function describeLogoSrcForm(src: string): string | null {
  // `readLogo` already discards a blank, so this branch changes no verdict — it exists so a
  // value that was written and is blank can be reported rather than passed over in silence.
  if (src.trim() === '') {
    return 'it is blank, so it names no file';
  }
  // Split rather than reported together: these are different mistakes, and a log line that cannot
  // say which one it was does not help the administrator who wrote the value (review of PR 512).
  if (src.includes('\\')) {
    return 'it contains a backslash, which the URL parser rewrites as a path separator';
  }
  if ([...src].some((char) => char < ' ' || char === '\u007f')) {
    return 'it contains a control character, which the URL parser drops, so the value is not what it looks like';
  }
  // `#` starts a fragment, so a payload that begins with it is empty.
  if (/^data:/i.test(src)) {
    return /^data:image\/[a-z0-9.+-]+(?:;[^,#]*)?,[^#]/i.test(src)
      ? null
      : 'it is a data: URI that is not an image, or that carries no payload';
  }
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(src)?.[1];
  if (scheme !== undefined) {
    // The scheme is named rather than just refused. `javascript:` and `http:` are very different
    // mistakes and used to produce one message, so a log line could not tell an insecure address
    // from an attempt to put script in a configuration value (review of PR 512).
    if (scheme.toLowerCase() !== 'https') {
      return `only https: is allowed for an absolute address, and this one uses "${scheme.toLowerCase()}:"`;
    }
    if (!/^https:\/\/[^/]/i.test(src)) {
      return 'an absolute https: address must name a host';
    }
    try {
      new URL(src);
      return null;
    } catch {
      return 'it is not a valid URL';
    }
  }
  if (src.startsWith('/')) {
    return 'an absolute path is not allowed; use a path relative to the configuration directory';
  }
  const path = src.split(/[?#]/, 1)[0] ?? '';
  // A query or fragment alone resolves to bootstrap.json itself, which no <img> can render.
  if (!path) {
    return 'it has no path, so it would load bootstrap.json itself';
  }
  // States the rule, not an outcome: a `..` is refused wherever it resolves to, because the
  // server may read the path differently from the browser. `assets/../acme.svg` carries one and
  // lands *inside* the configuration directory, so the old wording — "would leave the
  // configuration directory" — was untrue for it (review of PR 512).
  return path.replace(/%2e/gi, '.').split('/').includes('..')
    ? 'it contains a parent-directory segment (".."), which is not allowed in a relative path however it resolves'
    : null;
}
