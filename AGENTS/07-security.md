# Security Rules

These rules are enforced at code generation time, by the Bug Detection Agent during review,
and by GitHub CodeQL in CI. Violations block PR merge.

---

## Credentials — NEVER hardcode

```typescript
// WRONG ❌
const auth = 'Administrator:Administrator';
const apiKey = 'sk-abc123...';
export const config = { nuxeoAuth: 'admin:admin' };

// CORRECT ✅
const auth = process.env['NUXEO_AUTH'] ?? '';
// Validate at startup — fail fast if missing:
if (!config.nuxeoAuth) {
  console.error('NUXEO_AUTH is required');
  process.exit(1);
}
```

- All sensitive config comes from environment variables
- `.env` files are gitignored — never commit them
- Never use hardcoded fallback credentials (even `'' || 'admin:admin'`)
- If GitHub Secret Scanning flags a commit, rotate the credential immediately

---

## Nuxeo Authentication

```typescript
// CORRECT ✅ — use HttpClient via services (interceptor adds auth header)
this.documentDetailService.fetchThumbnail(uid)
  .pipe(takeUntilDestroyed())
  .subscribe(blob => { ... });

// WRONG ❌ — fetch() bypasses Angular's auth interceptor
fetch(`/nuxeo/api/v1/id/${uid}/@rendition/thumbnail`); // no auth header

// WRONG ❌ — direct img binding bypasses auth interceptor
<img [src]="doc.contextParameters['thumbnail']?.url" />
```

A document's thumbnail is `<nxs-thumbnail [documentId]="doc.uid">`, which fetches it this way and
owns the blob URL: the core slice no longer creates or revokes a thumbnail URL anywhere else.

- NEVER call Nuxeo URLs with the native `fetch()` API
- NEVER add `Authorization` headers manually in components — use the interceptor
- NEVER put credentials in query string parameters

---

## XSS Prevention

```typescript
// CORRECT ✅ — Angular template binding auto-escapes
<p>{{ userContent }}</p>

// WRONG ❌ — bypasses sanitization
element.innerHTML = userContent;
this.renderer.setProperty(el, 'innerHTML', content);

// ONLY acceptable use of DomSanitizer — and only when source is fully controlled
this.sanitizer.bypassSecurityTrustResourceUrl(arenderUrl); // ✅ for known-safe iframes
```

- Never use `innerHTML` or `outerHTML` with user-provided content
- Never use `DomSanitizer.bypassSecurityTrust*` unless the source is server-controlled
- Always use Angular's template binding (`{{ }}`, `[attr]`) for user content

---

## Blob URL Lifecycle

```typescript
// CORRECT ✅ — revoke in ngOnDestroy
private readonly blobUrls: string[] = [];

loadBlob(): void {
  this.service.fetchBlob(uid).subscribe(blob => {
    const url = URL.createObjectURL(blob);
    this.blobUrls.push(url);       // track for cleanup
    this.blobUrl.set(url);
  });
}

ngOnDestroy(): void {
  this.blobUrls.forEach(url => URL.revokeObjectURL(url)); // always clean up
}

// WRONG ❌ — memory leak, especially bad for thumbnails in lists
this.blobUrl.set(URL.createObjectURL(blob)); // never revoked
```

---

## Angular Security Checklist for PR Review

- [ ] No hardcoded credentials, tokens, or API keys
- [ ] No `fetch()` calls to `/nuxeo/` URLs
- [ ] No `<img [src]="nuxeoUrl">` direct bindings
- [ ] No `innerHTML` with user content
- [ ] No `DomSanitizer.bypassSecurityTrust*` without documented justification
- [ ] Every `URL.createObjectURL()` has a corresponding `revokeObjectURL()` in cleanup
- [ ] `.env` files are not staged for commit

---

## Automated Security Scanning

Two automated systems protect against vulnerabilities:

### 1. CodeQL - Code Scanning

Scans source code for security vulnerabilities and code quality issues.

**Configuration:**

- Workflow: [.github/workflows/codeql.yml](.github/workflows/codeql.yml)
- Config: [.github/codeql-config.yml](.github/codeql-config.yml)
- Runs: Push, PR, weekly schedule
- Query suite: `security-extended`

**Common Findings:**

- Hardcoded credentials or API keys
- Insecure use of `innerHTML` or `eval()`
- Missing input validation at system boundaries
- Incomplete URL sanitization
- SSRF via user-controlled URLs
- Prototype pollution

**Viewing Results:** Security tab → Code scanning alerts

### 2. Dependency Review - Supply Chain Security

Prevents vulnerable dependencies from being introduced via pull requests.

**Configuration:**

- Workflow: [.github/workflows/dependency-review.yml](.github/workflows/dependency-review.yml)
- Runs: On PRs that change `package.json` or `package-lock.json`
- Fail threshold: Moderate severity or higher

**What It Checks:**

- Known CVEs in npm packages
- License compliance (optional)

**How to Fix:**

- Update to patched version: `npm update <package>`
- Find alternative package if no fix available
- Document and accept risk only with security team approval

**Never bypass Dependency Review without documented justification.**

See [docs/security-scanning.md](../docs/security-scanning.md) for detailed guidance.

---

## AI Security

The AI backend is **not in this repository** — AI features are Nuxeo Automation operations
provided by a separate marketplace package. HAIP credentials, prompt construction and rate
limiting are that package's responsibility and are configured on the Nuxeo server.

What this repo is responsible for:

- Never hardcode or proxy HAIP credentials. The client only calls
  `/nuxeo/api/v1/automation/AI.*` and relies on the existing auth interceptor.
- Never send credentials, tokens or session data as AI operation parameters.
- Treat AI responses as untrusted content: render through Angular template binding, never
  `innerHTML`, and never `bypassSecurityTrust*`.
- Handle the operation-absent case. If the package is not installed the call returns 500;
  fail closed and show a normal error rather than retrying or degrading silently.
