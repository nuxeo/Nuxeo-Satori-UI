# Bot Co-Author Stripping Setup - Complete

## ✅ What Was Done

### 1. Created Husky Commit-Msg Hook

**File:** [`.husky/commit-msg`](../.husky/commit-msg)

```bash
node scripts/strip-bot-coauthors.mjs "$1"
```

This hook runs **automatically on every commit** for all developers.

### 2. Created Stripping Script

**File:** [`scripts/strip-bot-coauthors.mjs`](../scripts/strip-bot-coauthors.mjs)

**Removes these bot co-authors:**

- `github-actions[bot]`
- `dependabot[bot]`
- `renovate[bot]`
- `Claude Sonnet 4.5` / `claude`
- `Cursor` / `cursoragent`

**Preserves:**

- ALL human co-authors
- Commit message content
- Commit structure

### 3. Created Documentation

**Files:**

- [`docs/bot-coauthor-policy.md`](./bot-coauthor-policy.md) - Full policy explanation
- [`docs/cla-configuration-guide.md`](./cla-configuration-guide.md) - Updated with bot stripping reference

### 4. Tested and Verified

**Test commit:** [`ab52012`](https://github.com/nuxeo/Nuxeo-Satori-UI/commit/ab52012)

**Input (what was typed):**

```
feat: add automatic bot co-author stripping

...message...

Co-authored-by: Claude Sonnet 4.5 <noreply@anthropic.com>
Co-authored-by: github-actions[bot] <github-actions[bot]@users.noreply.github.com>
```

**Output (what was saved):**

```
feat: add automatic bot co-author stripping

...message...

(no co-authors - both bots were stripped)
```

✅ **Hook works correctly!**

---

## How Developers Use This

### For New Developers

```bash
# Clone repo
git clone https://github.com/nuxeo/Nuxeo-Satori-UI.git
cd Nuxeo-Satori-UI

# Install dependencies (this installs hooks automatically)
npm install

# Now all commits automatically strip bot co-authors
git commit -m "feat: my change"
```

**No manual setup required!** The `prepare` script in `package.json` runs `husky` automatically.

### For Existing Developers

```bash
# Update from main
git pull origin main

# Reinstall hooks (if needed)
npm install

# That's it! Hook is now active
```

### Making Commits

**No change to developer workflow:**

```bash
# Write your commit as usual
git commit -m "feat: add feature

Co-authored-by: Claude Sonnet 4.5 <noreply@anthropic.com>
Co-authored-by: Alice Smith <alice@example.com>"

# Hook runs automatically:
# ✓ Removed bot co-authors from commit message

# Commit is saved WITHOUT bot co-authors:
# - Claude Sonnet 4.5: REMOVED
# - Alice Smith: KEPT (human)
```

**Key points:**

- AI tools (Cursor, Claude) can still add co-authors
- The hook strips them silently before commit is created
- Human co-authors are preserved
- No `--no-verify` needed (that's only to bypass ALL hooks)

---

## Verification

### Check Hook Is Installed

```bash
ls -l .husky/commit-msg
# Should exist and be executable

cat .husky/commit-msg
# Should show: node scripts/strip-bot-coauthors.mjs "$1"
```

### Test the Hook

```bash
# Create test commit with bot co-author
echo "test" >> test.txt
git add test.txt
git commit -m "test: verify hook

Co-authored-by: claude <noreply@anthropic.com>"

# Check commit (should NOT have claude)
git log -1 --pretty=fuller
```

### Check Specific Commit

```bash
# View commit with full details
git log -1 <commit-hash> --pretty=fuller

# Check for co-authors
git log -1 <commit-hash> | grep "Co-authored-by"
```

---

## What This Solves

### ✅ Problem: CLA Warnings for AI Bots

**Before:**

```
CLAassistant commented:
"cursoragent has not signed the CLA"
```

**After:**

- Bot co-authors removed from commits
- CLA only sees human contributors
- No false warnings

### ✅ Problem: Noisy Git History

**Before:**

```
Author: John Doe
Co-authored-by: claude <...>
Co-authored-by: github-actions[bot] <...>
Co-authored-by: Alice Smith <...>
```

**After:**

```
Author: John Doe
Co-authored-by: Alice Smith <...>
```

### ✅ Problem: Legal Ambiguity

**Before:** Unclear if AI bots need CLA signatures

**After:** Only humans in git history, only humans need CLA

---

## Edge Cases

### Multiple Bot Co-Authors

**Input:**

```
feat: change

Co-authored-by: claude <...>
Co-authored-by: cursoragent <...>
Co-authored-by: github-actions[bot] <...>
Co-authored-by: Human <...>
```

**Output:**

```
feat: change

Co-authored-by: Human <...>
```

✅ All bots removed, human preserved

### Only Bot Co-Authors

**Input:**

```
feat: change

Co-authored-by: claude <...>
Co-authored-by: cursoragent <...>
```

**Output:**

```
feat: change
```

✅ All bots removed, no co-authors remain

### No Co-Authors

**Input:**

```
feat: change
```

**Output:**

```
feat: change
```

✅ No changes (hook runs but does nothing)

---

## Troubleshooting

### Hook Not Running

**Symptom:** Bot co-authors still in commits

**Fix:**

```bash
# Reinstall hooks
rm -rf .husky/_
npm install

# Verify hook
cat .husky/commit-msg
chmod +x .husky/commit-msg
```

### Hook Fails

**Symptom:** `git commit` fails

**Check:**

```bash
# Node version (must be 20.x)
node --version

# Test script
node scripts/strip-bot-coauthors.mjs /tmp/test.txt

# Check script exists
ls -l scripts/strip-bot-coauthors.mjs
```

### Want to Keep Bot Co-Author (Rare)

```bash
# Skip hook (bypasses ALL hooks)
git commit --no-verify -m "message"
```

⚠️ **Warning:** Also skips linting, formatting, and guardrails

---

## CI/CD Compatibility

### GitHub Actions Workflows

**No changes needed!**

Our workflows use `github-actions[bot]` as the commit author:

```yaml
- name: Configure git
  run: |
    git config user.name "github-actions[bot]"
    git config user.email "github-actions[bot]@users.noreply.github.com"
```

**This is the AUTHOR, not a co-author** - hook doesn't touch it.

### Other CI Systems

If your CI adds co-author trailers, they'll be stripped if they match bot patterns.

**To strip a CI bot co-author:**

Add its pattern to `BOT_PATTERNS` in `scripts/strip-bot-coauthors.mjs`:

```js
const BOT_PATTERNS = [
  // ... existing patterns ...
  /^Co-authored-by:\s+my-ci-bot\s+<.*>$/gim, // Note: use 'gim' flags
];
```

**To preserve a CI bot co-author:**

Simply don't add it to `BOT_PATTERNS`. Only bots matching the patterns are stripped; all others are kept.

---

## Summary

| What                 | Status | Location                                       |
| -------------------- | ------ | ---------------------------------------------- |
| **Hook**             | ✅     | `.husky/commit-msg`                            |
| **Script**           | ✅     | `scripts/strip-bot-coauthors.mjs`              |
| **Documentation**    | ✅     | `docs/bot-coauthor-policy.md`                  |
| **Testing**          | ✅     | Verified with commit `ab52012`                 |
| **Enforcement**      | ✅     | Automatic for all developers after npm install |
| **Human co-authors** | ✅     | Preserved                                      |
| **Bot co-authors**   | ✅     | Stripped automatically                         |

---

## Next Steps

### For This Repository

1. ✅ **Merge this branch** (`revert/gpg-signing`)
2. ✅ **All developers run `npm install`** to get the hook
3. ✅ **CLA warnings for bots disappear** automatically

### For Other Repositories

To add bot stripping to another repo:

```bash
# Copy files
cp .husky/commit-msg <other-repo>/.husky/
cp scripts/strip-bot-coauthors.mjs <other-repo>/scripts/
cp docs/bot-coauthor-policy.md <other-repo>/docs/

# Ensure package.json has:
"scripts": {
  "prepare": "husky"
},
"devDependencies": {
  "husky": "^9.1.7"
}

# Commit and push
git add .husky/ scripts/ docs/ package.json
git commit -m "feat: add automatic bot co-author stripping"
```

---

## References

- [Husky Git Hooks](https://typicode.github.io/husky/)
- [Git Commit Trailers](https://git-scm.com/docs/git-interpret-trailers)
- [GitHub Co-authored-by](https://docs.github.com/en/pull-requests/committing-changes-to-your-project/creating-and-editing-commits/creating-a-commit-with-multiple-authors)

---

## Contact

Questions about this setup? Check:

1. [Bot Co-Author Policy](./bot-coauthor-policy.md) - Full policy details
2. [CLA Configuration Guide](./cla-configuration-guide.md) - CLA + bot interaction
3. Repository maintainers

---

**Date:** 2026-09-08  
**Commits:** `ab52012`, `e94a198`  
**Branch:** `revert/gpg-signing`  
**Status:** ✅ Ready to merge
