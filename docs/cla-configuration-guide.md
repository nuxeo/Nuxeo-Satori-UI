# CLA Configuration Guide

## Overview

**CLA (Contributor License Agreement)** ensures all human contributors have signed the legal agreement before their code is merged.

## Current Status

✅ **CLA Assistant is active** - Comments on PRs automatically
✅ **Bot co-authors are automatically stripped** - See [Bot Co-Author Policy](./bot-coauthor-policy.md)
❓ **CLA Assistant allowlist** - Repository not appearing in CLA dashboard (needs configuration)

---

## What CLA Should Do

### ✅ Required: Human Contributors

- All **human developers** must sign CLA
- CLA bot checks every PR for human author signatures
- Blocks merge until all humans have signed

### ✅ Allowed: Bot Commits

- **Bot accounts** should be **allowlisted** (exempted)
- Bots that should bypass CLA:
  - `github-actions[bot]` - Workflow automation
  - `dependabot[bot]` - Dependency updates
  - `claude` - AI coding assistant co-author
  - `cursoragent` - Cursor AI co-author
  - `nuxeo-webui-jx-bot` - Custom bot (if used)

---

## Why Allowlist Bots?

**Bots cannot sign legal agreements** because:

- They are not legal entities
- They cannot agree to contract terms
- They cannot be held liable

**Human responsibility:**

- The human developer who used the AI tool is responsible
- Their CLA signature covers all code they contribute
- AI is a tool (like an IDE or compiler)

---

## How to Configure CLA

### Step 1: Access CLA Assistant

1. Go to: https://cla-assistant.io/
2. Click **"Sign in with GitHub"**
3. Select **"nuxeo"** organization
4. Find **"Nuxeo-Satori-UI"** repository

**Repository rename (30 October 2026).** GitHub renamed `nuxeo/agentic-ui-poc` to
`nuxeo/Nuxeo-Satori-UI`, and the URLs on this page name the new one. CLA Assistant resolves it to
the same registration: its readme badge endpoint reports the same signature count for both names,
where a repository it does not know reports zero. That check covers the badge endpoint, not the
dashboard, which answers HTTP 200 for any path — so if the dashboard shows nothing under the new
name, the registration needs re-pointing there.

### Step 2: Configure Allowlist

1. In CLA Assistant dashboard, select `nuxeo/Nuxeo-Satori-UI`
2. Go to **"Settings"** or **"Allowlist"** section
3. Add bot accounts (explicit names only):

```
github-actions[bot]
dependabot[bot]
renovate[bot]
```

**Note:** With automatic bot co-author stripping (see [Bot Co-Author Policy](./bot-coauthor-policy.md)), AI assistant names like `claude` and `cursoragent` are removed from commits before they're created, so they don't need to be allowlisted.

4. Click **"Save"**

**Avoid pattern matching:** Patterns like `*[bot]` or `bot*` have ambiguous semantics and may match unintended accounts. Only use explicit bot names as documented by CLA Assistant.

### Step 3: Verify Configuration

**Note:** With automatic bot co-author stripping enabled, bot co-authors are removed before commits are created. To test CLA allowlist configuration without bot stripping, temporarily disable the hook:

```bash
# Temporarily rename the hook
mv .husky/commit-msg .husky/commit-msg.bak

# Create a test PR with bot author (using actual GitHub bot account)
# Note: Use the exact GitHub login that CLA Assistant checks, not display names
git commit --author="github-actions[bot] <github-actions[bot]@users.noreply.github.com>" \
  -m "test: verify CLA bot allowlist"

# Push and create PR
gh pr create --title "test: CLA bot allowlist"

# Restore the hook
mv .husky/commit-msg.bak .husky/commit-msg
```

**Expected result:**

- ✅ Bot account (`github-actions[bot]`) is NOT flagged for CLA
- ✅ Human author IS checked for CLA
- ✅ PR shows "All committers have signed the CLA"

---

## Alternative: CLA Configuration File

If CLA Assistant supports `.clabot` or `cla.json`:

### Option A: Create `.clabot` File

```json
{
  "contributors": [
    "github-actions[bot]",
    "dependabot[bot]",
    "claude",
    "cursoragent",
    "nuxeo-webui-jx-bot"
  ],
  "message": "Thank you for your contribution! Please sign our CLA before we can merge.",
  "label": "cla-signed"
}
```

### Option B: Create `.github/cla.yml`

```yaml
allowlist:
  - github-actions[bot]
  - dependabot[bot]
  - renovate[bot]
  # Only explicit bot names - avoid glob patterns which may have
  # ambiguous semantics (e.g., *[bot] is a character class in some syntaxes)

require-signed: true
label: cla-signed
```

---

## Testing CLA Configuration

### Test 1: Human Contributor (Should Require CLA)

```bash
# As a human developer
git commit -m "feat: add new feature"
gh pr create

# Expected: CLA bot asks to sign (if not already signed)
```

### Test 2: Bot Co-Author (Should Be Allowed)

**Note:** With bot co-author stripping enabled, this test is no longer needed. Bot co-authors are automatically removed before commits are created.

```bash
# If testing without bot stripping (hook disabled):
git commit -m "feat: AI-assisted feature

Co-authored-by: github-actions[bot] <github-actions[bot]@users.noreply.github.com>"
gh pr create

# Expected: CLA bot allows bot account, only checks human
```

### Test 3: Bot-Only Commit (Should Be Allowed)

```bash
# Triggered by GitHub Actions
# Author: github-actions[bot]

# Expected: CLA bot completely ignores this commit
```

---

## Troubleshooting

### Issue: Bot Triggered CLA Warning

**Symptom:**

```
CLAassistant commented:
"cursoragent has not signed the CLA"
```

**Fix:**

- Add `cursoragent` to CLA allowlist
- OR remove `Co-authored-by` trailers from commits

### Issue: CLA Bot Not Installed

**Symptom:** No CLA comments on PRs

**Fix:**

1. Go to: https://github.com/apps/cla-assistant
2. Click **"Install"**
3. Select **"nuxeo"** organization
4. Choose repositories: **"Nuxeo-Satori-UI"**
5. Click **"Install & Authorize"**

### Issue: Allowlist Not Working

**Check:**

1. Spelling matches exactly: `github-actions[bot]` not `github-actions-bot`
2. CLA Assistant has latest configuration (may need to re-authenticate)
3. Clear cache: Close/reopen the PR to trigger re-check

---

## Current Configuration

### Repository

- **CLA Tool**: CLA Assistant (https://cla-assistant.io/)
- **Status**: ✅ Active (comments on PRs)
- **Allowlist**: ❌ Not configured (needs setup)

### Action Required

1. ✅ **Add bot accounts to allowlist** (primary task)
2. ⏹️ Re-enable branch protection rules
3. ⏹️ Consider GPG signing later (optional)

---

## Branch Protection Compatibility

CLA works independently of branch protection:

| Feature               | Purpose             | Blocks Merge?                               |
| --------------------- | ------------------- | ------------------------------------------- |
| **CLA**               | Legal agreement     | ✅ Yes (until signed)                       |
| **Branch Protection** | Code review, tests  | ✅ Yes (until passed)                       |
| **GPG Signing**       | Commit authenticity | ⚠️ Optional (blocks if required by ruleset) |

**CLA + Branch Protection:**

- CLA checks run **before** merge
- Branch protection allows exemptions (bypass list)
- CLA typically does NOT have bypass (all humans must sign)

---

## Best Practices

### ✅ Do

- Allowlist well-known bots (`dependabot`, `github-actions`)
- Allowlist AI coding assistants used by your team
- Keep allowlist updated when adding new bots
- Document why each bot is allowlisted

### ❌ Don't

- Allowlist human developer accounts
- Allowlist unknown/untrusted bots
- Skip CLA entirely (unless not needed)
- Add wildcards that could match humans (`*` alone)

---

## References

- [CLA Assistant](https://github.com/cla-assistant/cla-assistant)
- [CLA Assistant.io](https://cla-assistant.io/)
- [GitHub Co-authored-by](https://docs.github.com/en/pull-requests/committing-changes-to-your-project/creating-and-editing-commits/creating-a-commit-with-multiple-authors)

---

## Summary

**Goal:** CLA checks humans, allows bots

**Current Approach:**

This repository uses **automatic bot co-author stripping** to reduce CLA allowlist needs:

- ✅ Bot **co-authors** are removed from commits automatically (see [Bot Co-Author Policy](./bot-coauthor-policy.md))
- ✅ CLA checks don't see AI assistant co-authors (claude, cursoragent)
- ⚠️ Bot **authors** (e.g., Dependabot PRs) still need CLA allowlisting

**Note:** The hook strips `Co-authored-by` trailers but doesn't change commit authors. PRs opened by bot accounts (like Dependabot) still require those bots to be allowlisted in CLA Assistant.

**Steps (if CLA allowlist is needed in future):**

1. Access CLA Assistant at https://cla-assistant.io/
2. Add bot accounts to allowlist
3. Test with a PR containing AI co-authors
4. Verify humans are still required to sign

**Result:**

- ✅ Human contributions require CLA signature
- ✅ Bot commits don't appear in git history (stripped automatically)
- ✅ No false warnings about AI co-authors
