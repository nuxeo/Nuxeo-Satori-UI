# GitHub Bot Commit Signing Setup

This guide explains how to set up GPG commit signing for GitHub Actions bot commits to ensure all commits in the repository are properly signed and verified.

## Why This Matters

- **Security**: Signed commits prove authenticity and prevent commit forgery
- **Compliance**: Many organizations require all commits to be signed
- **Trust**: Verified badges on commits show they came from authorized sources
- **Branch Protection**: You can enforce signed commits via branch protection rules

## Current Bot Commits

The following workflows create bot commits that need signing:

- `release.yml` - Version bump and changelog commit on a manual release

`changelog.yml`, which committed CHANGELOG.md updates on every push to `main`, has been removed.

## Setup Steps

### 1. Generate a GPG Key for the Bot

On your local machine or a secure environment:

```bash
# Generate a new GPG key (use a strong passphrase)
gpg --full-generate-key

# Select:
# - (1) RSA and RSA
# - 4096 bits
# - Key does not expire (or set appropriate expiration)
# - Real name: "Nuxeo Agentic UI Bot"
# - Email: "bot@nuxeo-agentic-ui.github.com" (or your preferred bot email)
```

### 2. Export the GPG Key

```bash
# List your keys to find the key ID
gpg --list-secret-keys --keyid-format=long

# Example output:
# sec   rsa4096/ABCD1234EFGH5678 2024-01-01 [SC]
#       Your key fingerprint
# uid                 Nuxeo Agentic UI Bot <bot@example.com>

# Export the private key (replace ABCD1234EFGH5678 with your key ID)
gpg --armor --export-secret-keys ABCD1234EFGH5678 > bot-private-key.asc

# Export the public key
gpg --armor --export ABCD1234EFGH5678 > bot-public-key.asc
```

### 3. Add Secrets to GitHub

Go to your repository settings → Secrets and variables → Actions → Repository secrets:

1. **Add `GPG_PRIVATE_KEY`**:
   - Click "New repository secret"
   - Name: `GPG_PRIVATE_KEY`
   - Value: Paste the entire contents of `bot-private-key.asc` (including BEGIN/END lines)

2. **Add `GPG_PASSPHRASE`**:
   - Click "New repository secret"
   - Name: `GPG_PASSPHRASE`
   - Value: The passphrase you used when creating the GPG key

### 4. Enable the Feature

Go to repository settings → Secrets and variables → Actions → Variables:

1. **Add `GPG_BOT_SIGNING_ENABLED`**:
   - Click "New repository variable"
   - Name: `GPG_BOT_SIGNING_ENABLED`
   - Value: `true`

### 5. Add the Public Key to GitHub

To show the "Verified" badge on bot commits:

1. Go to your repository settings → Deploy keys → Add deploy key
   - OR add it to a bot GitHub user account
   - OR add to organization GPG keys (if using GitHub Enterprise)

2. For a bot user account approach:
   - Create a GitHub account for the bot (e.g., `nuxeo-agentic-ui-bot`)
   - Add the bot as a collaborator with write access
   - Log in as the bot user → Settings → SSH and GPG keys
   - Click "New GPG key" and paste the contents of `bot-public-key.asc`
   - Update the workflow to use the bot user's credentials

### 6. Test the Setup

1. Run the release workflow
2. Let it push its version-bump commit
3. Check that the bot commit shows "Verified" badge
4. Verify with: `git log --show-signature`

## Security Best Practices

- **Passphrase**: Use a strong, unique passphrase for the GPG key
- **Key Rotation**: Rotate the GPG key annually
- **Access Control**: Limit who can modify repository secrets
- **Audit**: Regularly review bot commits and workflow runs
- **Backup**: Securely backup the GPG key (encrypted storage)

## Enabling Branch Protection (Optional)

To require all commits to be signed:

1. Go to repository Settings → Branches
2. Add or edit a branch protection rule for `main`
3. Enable "Require signed commits"
4. Save changes

**Note**: This will block unsigned commits from being pushed directly.

## Alternative: Avoiding Bot Commits Entirely

If you prefer to avoid bot commits in the repository history, consider these alternatives:

### Option A: Manual Changelog Updates

- Remove the automatic changelog workflow (done: `changelog.yml` has been removed)
- Update CHANGELOG.md manually as part of the release process
- Include changelog updates in feature PRs

### Option B: Use GitHub Releases

- Generate changelogs only for GitHub Releases (not in-repo)
- Use tools like `conventional-changelog` or `release-please` as a manual step

### Option C: Changelog in CI Output Only

- Generate changelog during CI but don't commit it
- Publish to GitHub Pages or a separate documentation site
- Keep the repository history clean of bot commits

## Troubleshooting

### Commit Not Showing "Verified"

- Ensure the public key is added to the bot GitHub account
- Check that the commit email matches the GPG key email
- Verify the key hasn't expired: `gpg --list-keys`

### Workflow Fails with "gpg: signing failed"

- Check that `GPG_PRIVATE_KEY` secret is set correctly
- Verify `GPG_PASSPHRASE` is correct
- Ensure the private key includes both BEGIN and END lines

### "No secret key" Error

- The private key wasn't imported correctly
- Re-export and re-add the `GPG_PRIVATE_KEY` secret

## References

- [GitHub: Signing commits](https://docs.github.com/en/authentication/managing-commit-signature-verification/signing-commits)
- [GitHub Actions: ghaction-import-gpg](https://github.com/crazy-max/ghaction-import-gpg)
- [GPG documentation](https://gnupg.org/documentation/)
