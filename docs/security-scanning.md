# Security Scanning

This repository uses two automated security scanning systems to protect against vulnerabilities:

1. **CodeQL** - Semantic code analysis for security vulnerabilities in source code
2. **Dependency Review** - Scans dependency changes in pull requests for known vulnerabilities

---

## CodeQL - Code Scanning

CodeQL is GitHub's semantic code analysis engine that automatically scans for security vulnerabilities and code quality issues in your source code.

### Overview

**Status:** ✅ Configured and active  
**Workflow:** [.github/workflows/codeql.yml](../.github/workflows/codeql.yml)  
**Configuration:** [.github/codeql-config.yml](../.github/codeql-config.yml)  
**Language:** JavaScript/TypeScript  
**Query Suite:** `security-extended` (comprehensive security analysis)

## When It Runs

- **On Push:** Every push to `main`, `integration/**` or `staging/**`, which gives each a baseline
  for its PRs' results
- **On Pull Request:** All PRs targeting `main`, `integration/**` or `staging/**`, analysed on
  `refs/pull/<n>/merge`, the ref the `code-scanning` gate reads
- **Scheduled:** Weekly on Fridays at 06:22 UTC to catch newly disclosed vulnerabilities

## Viewing Results

1. Navigate to the **Security** tab in GitHub
2. Click **Code scanning alerts**
3. Filter by severity, status, or rule
4. Each alert includes:
   - Description of the vulnerability
   - File path and line number
   - Remediation guidance
   - Related CWE/CVE references

## What It Checks

### Security Issues

- Hardcoded credentials or API keys
- SQL injection vulnerabilities
- Cross-site scripting (XSS) vectors
- Command injection risks
- Path traversal vulnerabilities
- Server-side request forgery (SSRF)
- Prototype pollution
- Insecure randomness
- Weak cryptography

### Code Quality Issues (security-extended suite)

- Missing input validation
- Incomplete sanitization
- Resource leaks
- Error handling gaps
- Type confusion

## Scanned Paths

**Included:**

- `apps/` — Application code
- `libs/` — Shared libraries

**Excluded:**

- Test files (`*.spec.ts`, `*.test.ts`)
- Build artifacts (`dist/`, `out-tsc/`, `coverage/`)
- Development tools (`scripts/`, `tools/`)
- Type definitions (`*.d.ts`)
- Mocks and fixtures

## Configuration Details

### Permissions

The workflow runs with least-privilege permissions:

- `actions: read` — Query workflow run history
- `contents: read` — Checkout code
- `packages: read` — Install `@hylandsoftware` dependencies from GitHub Packages
- `security-events: write` — Upload scan results

### Dependencies

The workflow installs npm dependencies before scanning to ensure CodeQL can:

- Resolve imports correctly
- Understand the full data flow
- Detect vulnerabilities in transitive dependencies

This requires the `SATORI_GH_READONLY_TOKEN` secret (already configured for CI).

## First-Time Setup Checklist

✅ CodeQL workflow created  
✅ Configuration file created  
✅ Documentation updated ([AGENTS/07-security.md](../AGENTS/07-security.md))  
⏳ Baseline scan running (first push)  
⏳ Review initial findings  
⏳ Configure fail-on-findings (after baseline established)

## Responding to Findings

### Triage Process

1. Review the finding details in GitHub Security tab
2. Assess severity and exploitability in context
3. Classify as:
   - **True positive** → Fix immediately (high/critical) or schedule (medium/low)
   - **False positive** → Dismiss with justification
   - **Won't fix** → Document reasoning and risk acceptance

### Fix Priority

- **Critical/High:** Block PR merge, fix immediately
- **Medium:** Fix in current sprint
- **Low:** Schedule for upcoming sprint

### Dismissing False Positives

1. Click on the alert
2. Select **Dismiss alert** → Choose reason:
   - False positive
   - Used in tests
   - Won't fix
3. Add comment explaining why

Dismissed alerts remain visible in the Security tab for audit purposes.

## Configuring Fail-on-Findings

Once the initial baseline is reviewed and addressed:

1. Open [.github/workflows/codeql.yml](../.github/workflows/codeql.yml)
2. In the "Perform CodeQL Analysis" step, uncomment:
   ```yaml
   wait-for-processing: true
   ```
3. This will fail the CI build if error-level findings are detected

## Compliance

This setup aligns with Hyland's AI security requirements:  
https://hyland.atlassian.net/wiki/spaces/OGC/pages/3407151959/AI+Use+Requirements

See also: [AGENTS/07-security.md](../AGENTS/07-security.md) for code-level security rules.

## Troubleshooting

### Scan Failed

- Check workflow logs in Actions tab
- Verify `SATORI_GH_READONLY_TOKEN` is still valid
- Ensure Node 20 is compatible with dependencies

### Missing Findings

- CodeQL uses data flow analysis — some patterns require build context
- Review excluded paths in `codeql-config.yml`
- Consider upgrading to `security-and-quality` suite for broader coverage

### Too Many False Positives

- Add query filters to `codeql-config.yml`:
  ```yaml
  query-filters:
    - exclude:
        id: js/angular/missing-explicit-injection-token
  ```
- Document why each filter is needed

---

## Dependency Review - Supply Chain Security

Dependency Review scans for known vulnerabilities in dependencies whenever a pull request changes `package.json` or `package-lock.json`.

### Overview

**Status:** ✅ Configured and active  
**Workflow:** [.github/workflows/dependency-review.yml](../.github/workflows/dependency-review.yml)  
**Purpose:** Prevent vulnerable dependencies from being introduced via PR  
**Fail Threshold:** Moderate severity or higher

### When It Runs

- **On Pull Request:** All PRs targeting `main` that modify dependencies
- **Scope:** Only analyzes changed dependencies, not the entire dependency tree

### What It Checks

- **Known Vulnerabilities:** CVEs in npm packages
- **Severity Levels:** Critical, High, Moderate, Low
- **License Compliance:** Optional deny-list for restricted licenses (disabled by default)

### How It Works

1. Compares dependencies between base and head of PR
2. Queries GitHub Advisory Database for known vulnerabilities
3. Fails the PR check if any moderate+ severity vulnerabilities are found
4. Provides direct links to vulnerability details and remediation guidance

### Viewing Results

Results appear in the PR checks section:

- ✅ **Pass:** No vulnerable dependencies detected
- ❌ **Fail:** Vulnerable dependencies found

Click "Details" to see:

- Which packages introduced vulnerabilities
- CVE numbers and severity levels
- Links to security advisories
- Suggested fixes (usually version updates)

### Responding to Failures

#### Option 1: Update to a Fixed Version

```bash
npm update <package-name>
# or for major version updates
npm install <package-name>@latest
```

#### Option 2: Find Alternative Package

If no fix is available, consider:

- Alternative packages that provide similar functionality
- Removing the dependency if it's not critical

#### Option 3: Accept the Risk (with justification)

For false positives or accepted risks:

1. Document why the vulnerability doesn't apply to your use case
2. Get security team approval
3. Use `npm audit fix --force` or manual overrides with clear comments

**Never bypass Dependency Review without documented justification.**

### Difference from `npm audit`

| Feature      | Dependency Review         | npm audit              |
| ------------ | ------------------------- | ---------------------- |
| **When**     | PR time (prevents merge)  | After merge (advisory) |
| **Scope**    | Changed dependencies only | Entire dependency tree |
| **Blocking** | Yes (fails PR check)      | No (informational)     |
| **Coverage** | GitHub Advisory Database  | npm Registry + GitHub  |

Both tools are complementary:

- **Dependency Review** prevents new vulnerabilities from entering
- **npm audit** (via `beta:supply-chain`) catches existing vulnerabilities

### Configuration Options

Edit [.github/workflows/dependency-review.yml](../.github/workflows/dependency-review.yml):

```yaml
with:
  # Severity threshold (low, moderate, high, critical)
  fail-on-severity: moderate

  # Fail on specific licenses (uncomment to enable)
  # deny-licenses: GPL-2.0, LGPL-2.0

  # Allow specific licenses only
  # allow-licenses: MIT, Apache-2.0, BSD-3-Clause

  # Allow vulnerabilities in dev dependencies (not recommended)
  # fail-on-scopes: runtime
```

---

## Resources

### CodeQL

- [GitHub CodeQL Documentation](https://docs.github.com/en/code-security/code-scanning)
- [CodeQL Query Suite Reference](https://docs.github.com/en/code-security/code-scanning/managing-your-code-scanning-configuration/codeql-query-suites)
- [JavaScript/TypeScript Queries](https://codeql.github.com/codeql-query-help/javascript/)
- [Configuring Code Scanning](https://docs.github.com/en/code-security/code-scanning/automatically-scanning-your-code-for-vulnerabilities-and-errors/configuring-code-scanning)

### Dependency Review

- [Dependency Review Action](https://github.com/actions/dependency-review-action)
- [GitHub Advisory Database](https://github.com/advisories)
- [Configuring Dependency Review](https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/about-dependency-review)
