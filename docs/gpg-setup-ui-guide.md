# GPG Signing Setup - UI Guide (No Local Terminal)

Complete guide to set up GPG commit signing using only GitHub's web interface.

---

## Overview

```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│ 1. Generate Key │  →   │ 2. Add to GitHub │  →   │ 3. Add Secrets  │
│  (Codespaces)   │      │   (Bot Account)  │      │   (Repository)  │
└─────────────────┘      └──────────────────┘      └─────────────────┘
```

---

## Step 1: Generate GPG Key in GitHub Codespaces

### 1.1 Open Codespaces

1. Go to: https://github.com/nuxeo/Nuxeo-Satori-UI
2. Click the green **"Code"** button
3. Click **"Codespaces"** tab
4. Click **"Create codespace on main"** (or open existing)
5. Wait for VS Code to load in your browser

### 1.2 Open Terminal

- Press `Ctrl + ` (backtick)
- OR: Click **Terminal** → **New Terminal** from menu

### 1.3 Generate Key

Copy-paste this command:

```bash
gpg --full-generate-key
```

Answer the prompts:

| Prompt                                  | Answer                                        |
| --------------------------------------- | --------------------------------------------- |
| Please select what kind of key you want | Type `1` (RSA and RSA)                        |
| What keysize do you want?               | Type `4096`                                   |
| Key is valid for?                       | Type `0` (does not expire)                    |
| Is this correct?                        | Type `y`                                      |
| Real name                               | `nuxeo-webui-jx-bot`                          |
| Email address                           | `nuxeo-webui-jx-bot@users.noreply.github.com` |
| Comment                                 | (leave empty, press Enter)                    |
| Okay?                                   | Type `O`                                      |
| Passphrase                              | Create a **strong password** and save it!     |

✅ Key generated!

### 1.4 Get Key ID

```bash
gpg --list-secret-keys --keyid-format=long
```

**Output will look like:**

```
sec   rsa4096/ABCD1234EFGH5678 2024-01-01 [SC]
      Your-Key-Fingerprint-Goes-Here
uid                 nuxeo-webui-jx-bot <nuxeo-webui-jx-bot@users.noreply.github.com>
```

**Copy the ID:** `ABCD1234EFGH5678` (yours will be different)

### 1.5 Export Private Key

```bash
gpg --armor --export-secret-keys ABCD1234EFGH5678
```

⚠️ **Replace `ABCD1234EFGH5678` with YOUR key ID!**

**Output:**

```
-----BEGIN PGP PRIVATE KEY BLOCK-----

lQdGBGa...
...lots of lines...
=abcd
-----END PGP PRIVATE KEY BLOCK-----
```

1. **Select ALL the text** (including BEGIN/END lines)
2. **Copy it**
3. **Paste into a text file** or keep the Codespaces tab open

🔴 **This is SECRET - don't share it!**

### 1.6 Export Public Key

```bash
gpg --armor --export ABCD1234EFGH5678
```

⚠️ **Again, use YOUR key ID!**

**Output:**

```
-----BEGIN PGP PUBLIC KEY BLOCK-----

mQINBGa...
...lots of lines...
=wxyz
-----END PGP PUBLIC KEY BLOCK-----
```

1. **Select ALL the text**
2. **Copy it**
3. **Keep this separate** from the private key

✅ This is public - safe to share

---

## Step 2: Add Public Key to Bot Account

### 2.1 Switch to Bot Account

1. **Log out** of your current GitHub account
2. **Log in** as: `nuxeo-webui-jx-bot`
3. OR: Open **Incognito/Private window** and log in there

### 2.2 Navigate to GPG Keys

**Direct link:** https://github.com/settings/keys

OR manually:

1. Click your profile picture (top-right)
2. Click **Settings**
3. Scroll down left sidebar
4. Click **SSH and GPG keys**

### 2.3 Add the Public Key

1. Click **"New GPG key"** button
2. In the **"Key"** text box:
   - Paste the **PUBLIC KEY** from Step 1.6
   - Must include `-----BEGIN PGP PUBLIC KEY BLOCK-----` and `-----END PGP PUBLIC KEY BLOCK-----`
3. Click **"Add GPG key"**
4. Confirm with your password if prompted

✅ You should see: "GPG key added successfully"

---

## Step 3: Add Secrets to Repository

### 3.1 Go to Repository Settings

1. **Log in** as your admin account (not the bot)
2. Go to: https://github.com/nuxeo/Nuxeo-Satori-UI/settings/secrets/actions
3. You should see **"Actions secrets and variables"**

### 3.2 Add Private Key Secret

1. Click **"New repository secret"**
2. Fill in:
   - **Name:** `GPG_PRIVATE_KEY`
   - **Secret:** Paste the PRIVATE KEY from Step 1.5 (entire block including BEGIN/END)
3. Click **"Add secret"**

✅ Secret added (you won't be able to view it again)

### 3.3 Add Passphrase Secret

1. Click **"New repository secret"** again
2. Fill in:
   - **Name:** `GPG_PASSPHRASE`
   - **Secret:** The passphrase you created in Step 1.3
3. Click **"Add secret"**

### 3.4 Add Enable Variable

1. Click **"Variables"** tab (at the top)
2. Click **"New repository variable"**
3. Fill in:
   - **Name:** `GPG_BOT_SIGNING_ENABLED`
   - **Value:** `true`
4. Click **"Add variable"**

✅ Configuration complete!

---

## Step 4: Test It

### 4.1 Trigger the Workflow

Make a small change and push to main to trigger the changelog workflow:

```bash
# In Codespaces or your local machine:
echo "test" >> README.md
git add README.md
git commit -m "test: trigger changelog workflow"
git push origin main
```

### 4.2 Check the Result

1. Go to: https://github.com/nuxeo/Nuxeo-Satori-UI/actions
2. Wait for the workflow to complete
3. Check the latest commit on main branch
4. You should see **"Verified ✅"** badge next to the bot's commit

---

## Verification Checklist

- [ ] GPG key generated in Codespaces
- [ ] Public key added to `nuxeo-webui-jx-bot` GitHub account
- [ ] `GPG_PRIVATE_KEY` secret added to repository
- [ ] `GPG_PASSPHRASE` secret added to repository
- [ ] `GPG_BOT_SIGNING_ENABLED` variable set to `true`
- [ ] Workflows updated (already done)
- [ ] Test commit shows "Verified" badge

---

## Troubleshooting

### "gpg: signing failed: No secret key"

- The private key wasn't imported correctly
- Make sure you copied the ENTIRE key including BEGIN/END lines
- Check there are no extra spaces or line breaks

### Commit doesn't show "Verified"

- Public key not added to bot account
- Check: https://github.com/nuxeo-webui-jx-bot (must show GPG key in profile)
- Email in GPG key must match email in git config

### "Wrong passphrase"

- `GPG_PASSPHRASE` secret doesn't match what you set
- Re-add the secret with the correct passphrase

### Can't access Codespaces

- Use online GPG generator: https://pgpkeygen.com
- Less secure but works if Codespaces unavailable
- Follow the same steps for exporting keys

---

## Security Notes

🔴 **NEVER share your private key!**
🔴 **Store passphrase securely** (password manager)
🟢 **Public key is safe to share**
🟢 **Bot commits will now show as verified**

## Next Steps

After setup is complete:

- Test with a real commit
- Enable branch protection to require signed commits (optional)
- Document who has access to the bot account
- Set a reminder to rotate the GPG key annually

---

## Summary

You've configured:

- ✅ GPG key for bot commits
- ✅ GitHub to verify bot signatures
- ✅ Workflows to automatically sign
- ✅ All future bot commits will be verified

Bot commits will now show:

```
nuxeo-webui-jx-bot committed 2 minutes ago  ✅ Verified
chore: update CHANGELOG [skip ci]
```

Instead of:

```
github-actions[bot] committed 2 minutes ago  ⚠️ Unverified
chore: update CHANGELOG [skip ci]
```
