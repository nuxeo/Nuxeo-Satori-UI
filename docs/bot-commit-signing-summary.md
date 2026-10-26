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

1. Pass the GPG private key and passphrase from repository secrets to the action
2. Sign the commit inside the action's container
3. Produce a **signed** commit. It does not show GitHub's "Verified" badge yet: the commit
   identity is `github-actions[bot]@users.noreply.github.com`, which no one can attach a GPG key
   to, so GitHub reports `unknown_key`. The badge needs a bot account that owns the public key,
   with a verified email matching the signature, and the workflow's `github_user_name` /
   `github_user_email` set to it. See the KNOWN GAP note in `crowdin-pull.yaml`.

### 3. Required Setup (Not Yet Complete)

To activate GPG signing, you need to:

1. **Generate a GPG key** (see full guide)
2. **Add repository secrets**:
   - `GPG_PRIVATE_KEY` - The bot's private GPG key
   - `GPG_PASSPHRASE` - The passphrase for the key

3. **Add repository variable**:
   - `GPG_BOT_SIGNING_ENABLED` = `true`

4. **Add public key to GitHub**, on a bot account whose verified email matches the commit identity, and set the workflow's commit identity to that account. Uploading the key alone does not make commits show "Verified".

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
4. **Test** by dispatching the Crowdin Pull workflow. It commits only when translations differ from `main`. Check that its commit on `crowdin-translations-update` is signed (`git log --show-signature`, or a `verification.signature` in the commits API). Expect `verified: false` with `reason: unknown_key` until a key-owning bot account is set up as described above; the "Verified" badge is the test for that later step. Do not dispatch `release.yml` to test signing: it has no signing step, and dispatching it performs a real release.

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
