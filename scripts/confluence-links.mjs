/**
 * Where a relative Markdown link in `documentation/` should point once the page is on Confluence.
 *
 * Kept apart from `publish-confluence.mjs`, which needs credentials before it does anything, so
 * `confluence-links.selftest.mjs` can exercise it.
 */
import { posix } from 'node:path';

const REPO_URL = 'https://github.com/nuxeo/agentic-ui-poc';

/**
 * @param {string} href the link target as written, e.g. `../../scripts/x.mjs#L35`
 * @param {string} relPath the page it appears on, relative to `documentation/`
 * @param {{ pageTitles: Map<string, string>, branch: string, isDirectory: (path: string) => boolean }} ctx
 *   `isDirectory` takes a repository-relative path (`''` is the root); GitHub serves directories
 *   under `/tree/` and files under `/blob/`.
 * @returns {{ kind: 'page', title: string, anchor: string | null } | { kind: 'url', url: string }}
 *
 * Resolved in **repository** coordinates. The version this replaced resolved against
 * `documentation/` with the prefix stripped and let `..` underflow silently, so `[…](.)` on an
 * engineering page linked `/30-engineering` at the repository root rather than
 * `/documentation/30-engineering`. It also dropped the anchor from every link to a repository
 * file — 18 of the 149 when measured — so `#L35` and section links landed at the top of the file.
 */
export function docLinkTarget(href, relPath, { pageTitles, branch, isDirectory }) {
  const hash = href.indexOf('#');
  const pathPart = hash === -1 ? href : href.slice(0, hash);
  const anchor = hash === -1 ? null : href.slice(hash + 1) || null;
  if (pathPart.startsWith('/')) {
    throw new Error(`${relPath}: link ${href} is absolute; write it relative to the page`);
  }
  const target = pathPart
    ? posix.normalize(posix.join('documentation', posix.dirname(relPath), pathPart))
    : `documentation/${relPath}`;
  if (target === '..' || target.startsWith('../')) {
    throw new Error(`${relPath}: link ${href} resolves outside the repository`);
  }
  if (target.startsWith('documentation/')) {
    const title = pageTitles.get(target.slice('documentation/'.length));
    if (title) return { kind: 'page', title, anchor };
  }
  const path = target === '.' ? '' : target.replace(/\/$/, '');
  const route = isDirectory(path) ? 'tree' : 'blob';
  return {
    kind: 'url',
    url: `${REPO_URL}/${route}/${branch}/${path}${anchor ? `#${anchor}` : ''}`,
  };
}
