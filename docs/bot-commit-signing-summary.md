# Bot Commit Signing - Setup Summary

## What Was Changed

### 1. Modified Workflows

One workflow signs its bot commits:

#### [crowdin-pull.yaml](../.github/workflows/crowdin-pull.yaml)

- Passes `GPG_PRIVATE_KEY` and `GPG_PASSPHRASE` to `crowdin/github-action`, which signs the commit inside its own container
- Refuses to run unless `GPG_BOT_SIGNING_ENABLED` is `true` and both secrets are set

`release.yml` also commits, and has **no** signing step; it needs one, together with its separate
direct-push repair, before the first release. `changelog.yml` was removed.

### 2. How It Works

When enabled, the Crowdin pull workflow will:

1. Import a GPG private key from repository secrets
2. Configure git to automatically sign commits
3. Create commits that show "Verified" badge on GitHub

### 3. Required Setup (Not Yet Complete)

To activate GPG signing, you need to:

1. **Generate a GPG key** (see full guide)
2. **Add repository secrets**:
   - `GPG_PRIVATE_KEY` - The bot's private GPG key
   - `GPG_PASSPHRASE` - The passphrase for the key

3. **Add repository variable**:
   - `GPG_BOT_SIGNING_ENABLED` = `true`

4. **Add public key to GitHub** so commits show "Verified"

## Quick Start

```bash
# 1. Generate GPG key
gpg --full-generate-key
# Use: RSA 4096, no expiration, name: "Nuxeo Agentic UI Bot"

# 2. Export keys
gpg --list-secret-keys --keyid-format=long
gpg --armor --export-secret-keys YOUR_KEY_ID > bot-private.asc
gpg --armor --export YOUR_KEY_ID > bot-public.asc

# 3. Add to GitHub:
# - Settings → Secrets → GPG_PRIVATE_KEY (contents of bot-private.asc)
# - Settings → Secrets → GPG_PASSPHRASE (your passphrase)
# - Settings → Variables → GPG_BOT_SIGNING_ENABLED = true
# - Settings → SSH and GPG keys → Add GPG key (contents of bot-public.asc)
```

## Status

- ✅ Workflows updated to support GPG signing
- ⏳ GPG key generation pending
- ⏳ Repository secrets configuration pending
- ⏳ Public key registration pending

## Next Steps

1. **Review the full guide**: [github-bot-commit-signing.md](./github-bot-commit-signing.md)
2. **Decide on approach**:
   - **Enable signing** (recommended for compliance/security)
   - **Disable bot commits** (use manual changelog updates)
   - **Leave as-is** (unsigned bot commits, simpler but less secure)

3. **If enabling signing**, follow setup steps in the full guide
4. **Test** by dispatching the Crowdin Pull workflow and checking that its commit on `crowdin-translations-update` shows "Verified". It commits only when translations differ from `main`. Do not dispatch `release.yml` to test signing: it has no signing step, and dispatching it performs a real release.

## Security Note

The GPG private key and passphrase are sensitive secrets. Ensure:

- Only repository admins can access secrets
- Use a strong, unique passphrase
- Rotate the key annually
- Keep a secure backup of the key

## Alternative: Disable Bot Commits

If you prefer to avoid bot commits entirely:

1. Remove or disable the `changelog.yml` workflow (done: it has been removed)
2. Update CHANGELOG.md manually as part of releases
3. Consider using GitHub Releases for changelogs instead

See the full guide for detailed alternatives.
