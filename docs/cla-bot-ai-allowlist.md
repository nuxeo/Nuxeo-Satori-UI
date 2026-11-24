# CLA Bot and AI Co-Authors

## Problem

When using AI coding assistants (Claude Code, Cursor, GitHub Copilot), commits include `Co-authored-by` trailers that credit the AI:

```
feat: add new feature

Co-authored-by: Cursor <cursoragent@cursor.com>
Co-authored-by: Claude Sonnet 4.5 <noreply@anthropic.com>
```

**GitHub treats these as real contributors**, triggering CLA (Contributor License Agreement) checks for bot accounts that can't sign legal agreements.

## Why It Happens

### In PR #145

Commits had multiple authors:

- ✅ `akoppaka` (human)
- ✅ `narasimhahyland` (human)
- ❌ `cursoragent` (Cursor AI bot)
- ❌ `claude` (Claude AI bot)

The CLA assistant bot flagged the PR because `cursoragent` and `claude` haven't signed the CLA.

### Root Cause

AI coding tools automatically add themselves as co-authors to show their contribution. This is by design:

- Claude Code adds: `Co-authored-by: Claude Sonnet 4.5 <noreply@anthropic.com>`
- Cursor adds: `Co-authored-by: Cursor <cursoragent@cursor.com>`
- GitHub Copilot may add similar trailers

## Solution 1: Allowlist AI Bots in CLA Assistant

### Configure CLA Assistant

1. **Go to CLA Assistant configuration:**
   - https://github.com/nuxeo/Nuxeo-Satori-UI/settings/installations
   - Find "CLA Assistant" app
   - Click "Configure"

2. **Add allowlist pattern:**

   Create or edit `.clabot` file in repository root:

   ```json
   {
     "contributors": ["cursoragent", "claude", "github-actions[bot]", "dependabot[bot]"],
     "pattern": ["*[bot]", "bot*"]
   }
   ```

3. **Or use CLA Assistant web UI:**
   - Go to https://cla-assistant.io/
   - Sign in with GitHub
   - Select `nuxeo/Nuxeo-Satori-UI`
   - Add to allowlist:
     - `cursoragent`
     - `claude`
     - `*[bot]` (pattern to match all bot accounts)

### Common AI Bot Accounts to Allowlist

| Tool           | GitHub Username       | Email                                          |
| -------------- | --------------------- | ---------------------------------------------- |
| Cursor         | `cursoragent`         | `cursoragent@cursor.com`                       |
| Claude Code    | `claude`              | `noreply@anthropic.com`                        |
| GitHub Copilot | (uses your account)   | N/A                                            |
| GitHub Actions | `github-actions[bot]` | `github-actions[bot]@users.noreply.github.com` |

## Solution 2: Remove AI Co-Authors

If you prefer not to credit AI in commits:

### Option A: Git Hook to Strip Co-Authors

Create `.git/hooks/prepare-commit-msg`:

```bash
#!/bin/bash
# Remove AI co-author lines from commit messages

sed -i.bak '/Co-authored-by:.*@anthropic.com/d' "$1"
sed -i.bak '/Co-authored-by:.*cursoragent@cursor.com/d' "$1"
rm "$1.bak"
```

Make it executable:

```bash
chmod +x .git/hooks/prepare-commit-msg
```

### Option B: Configure Claude Code

In `.claude/settings.json`:

```json
{
  "git": {
    "coAuthor": false
  }
}
```

**Note:** This setting may not exist yet - Claude Code typically adds co-author trailers by default.

### Option C: Manual Cleanup

Before pushing, amend the last commit:

```bash
git commit --amend
# Edit message to remove "Co-authored-by" lines
# Save and exit
```

## Solution 3: Disable CLA Bot (Not Recommended)

If your organization doesn't require CLAs:

1. Go to: https://github.com/nuxeo/Nuxeo-Satori-UI/settings/installations
2. Find "CLA Assistant"
3. Click "Configure" → "Uninstall"

⚠️ **Warning**: Only do this if you don't need CLA enforcement.

## Recommended Approach

For `nuxeo/Nuxeo-Satori-UI`:

1. ✅ **Allowlist AI bots** - keeps co-author credits, avoids CLA issues
2. ✅ **Keep GPG signing** - ensures commit authenticity
3. ✅ **Document AI usage** - transparency about AI contributions

### Combined Setup

```
Human commits → GPG signed → CLA signed by human
AI co-authors → GPG signed → Allowlisted (no CLA needed)
Bot commits → GPG signed → Allowlisted (no CLA needed)
```

## Impact on Compliance

### Legal Perspective

**AI bots cannot sign legal agreements** because they:

- Are not legal entities
- Cannot agree to terms
- Cannot be held liable

**Allowlisting is appropriate** because:

- Human contributor is responsible for all code
- AI is a tool, like an IDE or linter
- Human already signed CLA covering all contributions

### Similar to Existing Exceptions

Organizations already allowlist:

- `dependabot[bot]` - automated dependency updates
- `github-actions[bot]` - CI/CD automation
- `renovate[bot]` - dependency management

AI coding assistants fit the same category.

## Alternative: Attribution in PR Description

Instead of `Co-authored-by` in commits, note AI usage in PR descriptions:

```markdown
## AI Assistance

This PR was developed with assistance from:

- Claude Code (Anthropic) - code generation, refactoring
- Cursor - inline suggestions, debugging

All code has been reviewed and approved by human contributors.
```

This provides transparency without triggering CLA checks.

## Status for This Repo

Current state:

- ❓ CLA Assistant is active (showed warning on PR #145)
- ❓ AI bots not allowlisted (triggered CLA check)
- ❓ Configuration needed

Action needed:

1. Decide: Allowlist AI bots **OR** remove co-author trailers
2. Configure CLA Assistant accordingly
3. Document decision in this file

## References

- [CLA Assistant Documentation](https://github.com/cla-assistant/cla-assistant)
- [GitHub Co-authored-by](https://docs.github.com/en/pull-requests/committing-changes-to-your-project/creating-and-editing-commits/creating-a-commit-with-multiple-authors)
- [Claude Code Git Configuration](https://docs.anthropic.com/claude-code)

## Summary

**Problem:** AI co-authors trigger CLA checks  
**Solution:** Allowlist AI bot accounts in CLA Assistant  
**Result:** CLA checks pass, AI contributions credited, legal compliance maintained
