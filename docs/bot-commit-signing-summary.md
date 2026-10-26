# Bot Commit Signing - Setup Summary

## What Was Changed

### 1. Modified Workflows

One workflow has been updated to support GPG commit signing (`changelog.yml` also was, and has since been removed):

#### [release.yml:42-48](../.github/workflows/release.yml#L42-L48)

- Added `Import GPG key` step before version bump commits
- Conditional on `GPG_BOT_SIGNING_ENABLED` variable

### 2. How It Works

When enabled, the workflow will:

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
4. **Test** by triggering the release workflow

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
