# The old published site, and what it takes to bring it back

`https://nuxeo.github.io/agentic-ui-poc/` returns **404 with no redirect**. The current site,
`https://nuxeo.github.io/Nuxeo-Satori-UI/`, is 200 and current.

## Why the rename did not carry the site with it

GitHub redirects a renamed repository's **repository** URL. It does not redirect that
repository's **Pages** site, because a project Pages URL is derived from the repository name:

| URL                                | Today                                    |
| ---------------------------------- | ---------------------------------------- |
| `github.com/nuxeo/agentic-ui-poc`  | 301 → `github.com/nuxeo/Nuxeo-Satori-UI` |
| `nuxeo.github.io/agentic-ui-poc/`  | **404**, no `Location` header            |
| `nuxeo.github.io/Nuxeo-Satori-UI/` | 200                                      |

In-repo links were corrected in `9953ee175`. Links held anywhere else — Confluence, Jira,
bookmarks, anything a reviewer followed — were not, and **nothing in this repository can fix
them**, because serving the old path needs a repository with the old name.

## The fix, and the cost of it

`index.html` beside this file is the stub, ready to publish. Someone with organisation-admin
rights on `nuxeo` has to:

1. Create a repository named exactly `agentic-ui-poc` in the `nuxeo` organisation.
2. Commit `index.html` from this directory to its default branch.
3. Enable Pages on it, serving from that branch's root.
4. Confirm `curl -o /dev/null -w "%{http_code}" https://nuxeo.github.io/agentic-ui-poc/` is 200.
5. Tell `scripts/beta-harness/published-links.mjs` about it: move the URL out of `KNOWN_DEAD`
   and into `ADVERTISED`. The gate **fails** until that happens, on purpose — a ledger entry that
   silently outlives the problem it records is the drift this repository keeps paying for.

**Step 1 has a cost that has to be accepted, not discovered.** Creating a repository with the old
name **ends the repository-URL redirect**: `github.com/nuxeo/agentic-ui-poc` would stop resolving
to `Nuxeo-Satori-UI` and would resolve to the stub repository instead. So the choice is

- **leave it**: old Pages links stay dead, old repository links keep working; or
- **publish the stub**: old Pages links work, and old repository links land on a stub repository
  whose README has to point at the real one.

Either is defensible. What is not defensible is choosing by accident, which is what happens if
whoever creates the repository has not read this paragraph. If the stub is published, its README
must carry the same two links as `index.html`.

## The gate

`published-links` (in `npm run beta:gate`) curls every URL in both lists on every run:

- an **advertised** URL that stops answering fails the gate — the class of failure behind the
  five-day Storybook blackout of 23–28 October, which was found only because a human opened the
  page;
- a **known-dead** URL that starts answering also fails the gate, so the ledger entry cannot
  silently outlive its own subject.

**What that does not cover.** The gate reads the two lists in `published-links.mjs`. It does not
read this file. If someone deletes the `KNOWN_DEAD` entry and leaves this page in place, the gate
goes green and this page is then wrong with nothing to say so — the entry's `fix:` field points
here, but that is prose, not a mechanism. Delete the two together.

It needs the network. `BETA_SKIP_PUBLISHED_LINKS=1` makes it report NOT RUN, which is never green:
the run is then `pass-incomplete` rather than `pass`.
