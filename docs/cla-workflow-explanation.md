# CLA (Contributor License Agreement) Workflow

## Overview

**CLA signing happens BEFORE merge** - this is already working correctly in this repository.

## How It Works (Already Configured)

### 1. CLA Assistant Bot (Active)

The repository uses **CLA Assistant** (https://cla-assistant.io/):

- ✅ Automatically checks every PR when opened/updated
- ✅ Identifies all commit authors
- ✅ Verifies each author has signed the CLA
- ✅ Blocks merge until all authors sign

### 2. When You Open a PR

```
┌─────────────────┐
│ Developer opens │
│   PR #123       │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────┐
│ CLA Assistant bot checks        │
│ all commit authors              │
└────────┬────────────────────────┘
         │
         ├─── ✅ All signed ──────► "All committers have signed the CLA"
         │                         PR can be merged
         │
         └─── ❌ Not signed ─────► "Please sign our CLA"
                                    Bot posts link to sign
                                    PR blocked until signed
```

### 3. Signing the CLA (For New Contributors)

If you haven't signed:

1. CLA bot posts a comment with a link
2. Click the link: `https://cla-assistant.io/nuxeo/Nuxeo-Satori-UI?pullRequest=<number>`
3. Sign in with GitHub
4. Review and sign the CLA
5. Bot automatically re-checks
6. Comment updates to "All committers have signed" ✅

### 4. Example from PR #145

```
CLAassistant commented on Sep 7, 2026:
"All committers have signed the CLA." ✅
```

**This means:**

- All human contributors already signed
- PR is approved for merge (from CLA perspective)
- No action needed

## CLA vs GPG: Two Different Things

| Check           | When           | Purpose             | Blocks Merge?         |
| --------------- | -------------- | ------------------- | --------------------- |
| **CLA Signing** | PR opened      | Legal agreement     | ✅ Yes (until signed) |
| **GPG Signing** | Commit created | Cryptographic proof | ❌ No (optional)      |

### CLA Signing (Legal)

- **Who signs:** Human contributors
- **When:** Before first contribution (once per contributor)
- **Why:** Legal protection for both contributor and project
- **Enforced:** Yes - bot blocks merge

### GPG Signing (Technical)

- **Who signs:** All commits (human + bot)
- **When:** Every commit
- **Why:** Prove commit authenticity
- **Enforced:** Optional (we just enabled it)

## AI Bots and CLA

### The Issue

AI coding assistants add `Co-authored-by` lines:

```
feat: add feature

Co-authored-by: Cursor <cursoragent@cursor.com>
Co-authored-by: Claude Sonnet 4.5 <noreply@anthropic.com>
```

**GitHub treats these as real contributors**, triggering CLA checks.

### The Solution: Allowlist Bots

Add AI bots to CLA Assistant allowlist so they're exempted:

1. Go to: https://cla-assistant.io/
2. Sign in → Select `nuxeo/Nuxeo-Satori-UI`
3. Go to "Allowlist"
4. Add:
   - `cursoragent`
   - `claude`
   - `*[bot]` (pattern for all bot accounts)
5. Save

**Why this is OK:**

- AI bots can't sign legal agreements (not legal entities)
- Human contributor is responsible for all code
- Similar to how `dependabot[bot]` is allowlisted

## Branch Protection (Optional)

You can enforce CLA signing via branch protection:

1. Go to repository **Settings** → **Branches**
2. Edit `main` branch protection
3. Enable **"Require status checks to pass before merging"**
4. Search for and add: `licence/cla`
5. Save changes

**Result:** PRs cannot be merged until CLA check passes.

## Checking CLA Status

### For a Specific PR

```bash
gh pr view <number> --json comments --jq '.comments[] | select(.user.login == "CLAassistant")'
```

### For a User

Visit: `https://cla-assistant.io/nuxeo/Nuxeo-Satori-UI`

- Shows list of all contributors who signed
- Shows pending signatures

## Troubleshooting

### CLA Bot Not Commenting

**Check if installed:**

1. Go to repository **Settings** → **Integrations**
2. Look for "CLA Assistant"
3. If missing, install from: https://github.com/apps/cla-assistant

### "Not all committers have signed"

**Identify unsigned authors:**

```bash
gh pr view <number> --json commits --jq '.commits[].authors[].login' | sort -u
```

Each person must sign individually at the link provided by the bot.

### Bot Shows Old Status

**Trigger re-check:**

1. Push a new commit to the PR
2. OR close and reopen the PR
3. Bot will re-scan all commit authors

## Summary

✅ **CLA signing is ALREADY working correctly in this repo**

**Workflow:**

1. Developer opens PR
2. CLA bot checks all authors
3. If unsigned → Bot posts "Please sign" with link
4. Author signs CLA
5. Bot updates to "All signed ✅"
6. PR can be merged

**No configuration needed** - it's already active and checking PRs!

**Next step:** Allowlist AI bots (`cursoragent`, `claude`) so they don't trigger false CLA warnings.

## Resources

- [CLA Assistant Documentation](https://github.com/cla-assistant/cla-assistant)
- [Configure Allowlist](https://cla-assistant.io/nuxeo/Nuxeo-Satori-UI)
- [Example: PR #145](https://github.com/nuxeo/Nuxeo-Satori-UI/pull/145#issuecomment-5570683344)

## Testing

GPG signing test for bot commits.
