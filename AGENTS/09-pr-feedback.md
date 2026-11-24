# Handling PR Review Comments

When asked to "fix PR comments", "address review feedback", or "fix all Copilot comments on PR #N":

---

## Step 1 — Fetch All Open Review Comments

```bash
# Get review-level comments (CHANGES_REQUESTED)
gh pr view <PR-number> --json reviews,comments \
  | jq '.reviews[] | select(.state == "CHANGES_REQUESTED") | .body'

# Get inline (line-level) comments
gh api repos/nuxeo/Nuxeo-Satori-UI/pulls/<PR-number>/comments \
  | jq '.[] | { path: .path, line: .line, body: .body, id: .id }'
```

---

## Step 2 — For Each Comment

1. Read the file at the specified line number
2. Understand what the reviewer is asking — do NOT just suppress the lint error
3. Implement the correct fix following all rules in `AGENTS/03-angular-conventions.md`, `AGENTS/07-security.md`, and `AGENTS/08-bug-patterns.md`
4. If the comment is unclear, make a reasonable fix and note what you did

---

## Step 3 — Verify, Commit, Push

```bash
npx nx affected -t lint
npx nx affected -t build
npx nx affected -t test
git commit -m "fix: address PR #<N> review comments"
git push
```

---

## Step 4 — Reply to Comments (Optional but Good Practice)

```bash
gh api repos/nuxeo/Nuxeo-Satori-UI/pulls/<PR-number>/comments/<comment-id>/replies \
  -f body="Fixed: added takeUntilDestroyed() to subscription in search.ts line 145"
```

---

## Common Comment → Fix Mapping

| Copilot comment                                 | What to do                                                             |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| "Missing unsubscribe" / "potential memory leak" | Add `.pipe(takeUntilDestroyed())` to the subscription                  |
| "Object URL not revoked"                        | Add `URL.revokeObjectURL(url)` in `ngOnDestroy`, track URLs in array   |
| "Direct img src to Nuxeo URL"                   | Fetch via `DocumentDetailService.fetchThumbnail()`, use blob URL       |
| "Potential XSS"                                 | Replace `innerHTML` with Angular template binding `{{ }}`              |
| "Hardcoded credential"                          | Move value to `process.env['...']`, add startup validation             |
| "Race condition"                                | Add a `currentUid` check before setting signal after async operation   |
| "Missing error handling"                        | Add `error: () => { this.loading.set(false); this.error.set('...'); }` |
| "Cross-feature import"                          | Move shared code to `libs/shared/`                                     |
| "Using snapshot for route params"               | Switch to `ActivatedRoute.paramMap` observable or `input()` signal     |
| "No accessibility"                              | Replace `<div (click)>` with `<button type="button">`                  |

---

## Automating this

The [`pr-review-responder`](../.cursor/agents/pr-review-responder.md) subagent runs this
workflow end to end when you say "fix PR comments" or "address review feedback on PR #N": it
paginates review threads, reviewer summary bodies and conversation comments, pulls Sonar
issues, verifies each fix against the full gate, then replies citing the commit and resolves
the thread.

`.cursor/skills/fix-pr-comments.md` used to do this and is retired — it fetched with
unpaginated REST, read only `CHANGES_REQUESTED` summaries, and treated replying as optional.
The mapping table above is still the reference for turning a comment into a fix.

## When to stop: Copilot does not approve, ever

`reviewDecision` stays `REVIEW_REQUIRED` no matter how many rounds you run, because
`copilot-pull-request-reviewer` submits its reviews as `COMMENTED`. **In every review sampled here
it has never submitted `APPROVED`** — and that is a sample, not a census: the query below reads the
last 40 pull requests and the first 20 reviews on each, while this repository has more than a
hundred pull requests. It is enough to stop you waiting, and it is not proof of "never".

Waiting for its approval is waiting for something that has not happened yet in any sampled review,
and branch protection needs a human approval regardless — which is the part that does not depend on
the sample at all.

Verify it rather than believing this paragraph:

```bash
gh api graphql -f query='{repository(owner:"nuxeo",name:"Nuxeo-Satori-UI"){pullRequests(last:40,states:[OPEN,MERGED,CLOSED]){nodes{reviews(first:20){nodes{author{login} state}}}}}}' \
  --jq '[.data.repository.pullRequests.nodes[].reviews.nodes[] | select(.author.login=="copilot-pull-request-reviewer")] | group_by(.state) | map({state: .[0].state, count: length})'
```

So the exit condition for the review loop is **a Copilot round that produces no new threads**,
with every thread resolved and CI green. Then hand back for a human approval.

Budget for more than one round. Each round tends to surface defects the previous round's fixes
introduced or exposed, and that is the loop working rather than a sign of trouble: on NXSAT-227,
round four found that the accessible-name gate could not see the parameterised binding the
round-three accessible-name fix had just added, so deleting the new key from the fallback map
passed the gate that exists to prevent exactly that.
