# Integration Test Stage 9 Plan — Fold in Orphans and Harness

**Status:** Planned (Not Implemented)  
**Priority:** P2, Medium  
**Branch:** `docs/integration-test-audit`

---

> **Run-safety gate, corrected twice. Current as of 2026-09-25.** These examples once passed
> `{ allowDefaultCredentials: true }` to `setupIntegrationHarness`, then used an
> `ALLOW_DEFAULT_CREDENTIALS=true` environment variable. **Both are gone.** The credential
> comparison they armed could not do what it claimed: production credentials are not the Docker
> default, so every real production pair was recorded as _satisfying_ the guard.
>
> The gate is now a host allowlist, read from the environment only, denying by default and
> special-casing nothing — `localhost` included:
>
> ```bash
> export INTEGRATION_ALLOWED_HOSTS=localhost:8080
> npm run beta:integration
> ```
>
> An unlisted host is a precondition failure, exit 2. See `libs/integration-tests/README.md`.

---

## Summary

Stage 9 involves promoting orphan evidence scripts to first-class integration tests and bringing the 13 beta-harness evidence steps under scheduled runs. This stage consolidates the testing infrastructure established in Stages 1-8.

---

## Orphan Scripts to Promote

From audit §13, three scripts should be promoted:

### 1. `scripts/session-timeout.mjs`

**Current Status:** Standalone evidence script  
**Target:** `libs/integration-tests/src/lib/session-timeout.integration.spec.ts`

**What it Tests:**

- Session timeout behavior
- Idle tracking when authenticated
- Timeout triggers and warnings

**Migration Plan:**

```typescript
describe('Session Timeout Integration Tests', () => {
  const harness = setupIntegrationHarness();

  it('starts idle tracking when authenticated', async () => {
    // Authenticate user
    // Verify idle tracking starts
    // Check timeout behavior
  });

  it('warns before session expires', async () => {
    // Set short timeout
    // Wait for warning threshold
    // Verify warning shown
  });
});
```

### 2. `scripts/clipboard-move-scenarios.mjs`

**Current Status:** Standalone evidence script  
**Target:** `libs/integration-tests/src/lib/clipboard-operations.integration.spec.ts`

**What it Tests:**

- Copy/paste document operations
- Move operations via clipboard
- Cross-folder operations

**Migration Plan:**

```typescript
describe('Clipboard Operations Integration Tests', () => {
  const harness = setupIntegrationHarness();

  it('can copy and paste a document', async () => {
    const sourceDoc = await createTestDocument(harness, { ... });
    const targetFolder = await createTestDocument(harness, { type: 'Folder', ... });

    // Copy via Document.Copy automation
    // Verify document copied to target
  });

  it('can move a document between folders', async () => {
    const doc = await createTestDocument(harness, { ... });
    const targetFolder = await createTestDocument(harness, { type: 'Folder', ... });

    // Move via Document.Move automation
    // Verify document moved (path changed)
  });
});
```

### 3. `scripts/note-document-scenarios.mjs`

**Current Status:** Standalone evidence script  
**Target:** Already partially covered in Stage 8 `feature-workflows.integration.spec.ts`

**What it Tests:**

- Note document creation
- Note content editing
- Note collaboration

**Migration Plan:**

- Expand Stage 8 notes tests to cover full note document scenarios
- Add collaborative editing tests (if supported by Nuxeo)
- Test note-specific workflows

---

## Evidence Steps to Schedule

Audit §4.7 counted 13 beta-harness evidence steps running manually, and named them from the
phase numbering rather than from disk — nine of the thirteen (`phase-1-browse.mjs`,
`phase-1-search.mjs`, `phase-2-browse-guard.mjs`, `phase-3-ai-chat.mjs`,
`phase-4-document-detail.mjs`, `phase-5-collections.mjs`, `phase-6-tasks.mjs`,
`evidence-discovery.mjs`, `phase-evidence.mjs`) have never existed. A schedule built from
that list would have failed on nine of its entries, so the phases below are what
`scripts/beta-harness/steps/` actually holds, verified 2026-09-24.

Each is invoked as `npm run beta:evidence -- <phase-id>`, never as `node <file>` — see the
workflow below for why.

### Phase 0

- `phase-0-baseline.mjs` — baseline capture
- `phase-0-no-backend.mjs` — runs without Nuxeo

### Phase 1

- `phase-1-config.mjs` — Layer 0/1 configuration
- `phase-1-tag-styles.mjs` — tag styling

### Phase 2

- `phase-2-registry.mjs` — extension registry

### Phase 3

- Phase 3 (component adoption) steps file
- `phase-3-search.mjs` — search

### Phase 4

- `phase-4-platform.mjs` — platform surface

### Phase 5

- `phase-5-harness.mjs` — harness

### Phase 6

- `phase-6-a11y.mjs` — accessibility

### Not phases, so not on this schedule

- `_template.mjs` — the template a new steps file is copied from
- `nxsat-227-i18n.mjs`, `pilot-documentlist-columns.mjs` — per-ticket
  and demo captures, run on demand

### Separate gates, not evidence steps

These are npm scripts under `scripts/beta-harness/`, not steps files, and take no phase ID:

- `npm run beta:audit` — assertion audit
- `npm run beta:gate` — the six-gate verification

### Scheduled Run Plan

**Create Nightly CI Workflow:**

```yaml
name: Nightly Evidence Collection

on:
  schedule:
    - cron: '0 2 * * *' # 2 AM daily
  workflow_dispatch: # Manual trigger

jobs:
  evidence:
    runs-on: ubuntu-latest
    services:
      nuxeo:
        image: packages.nuxeo.com/nuxeo/nuxeo:latest
        # ... Nuxeo service configuration

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4

      - name: Install dependencies
        run: npm ci

      - name: Run integration tests
        run: npm run beta:integration
        env:
          NUXEO_URL: http://nuxeo:8080
          # From secrets, never inline. A literal pair here is a credential in the repository
          # even in an illustrative snippet, and it is the shape scanners match.
          NUXEO_USER: ${{ secrets.NUXEO_USER }}
          NUXEO_PASS: ${{ secrets.NUXEO_PASS }}
          # The suite denies by default and refuses any host not named here, `localhost`
          # included. This is the service container above, named explicitly.
          INTEGRATION_ALLOWED_HOSTS: nuxeo:8080

      # A steps file exports `default async function(page, helpers, outDir)` and does nothing
      # at import time, so `node <step>.mjs` loads the module, defines the function and exits
      # 0 — collecting no evidence while reporting success. `beta:evidence` (the phase runner)
      # is what launches Chromium, supplies the page and calls that export.
      #
      # Phases are listed rather than globbed: `steps/` also holds `_template.mjs` and
      # per-ticket files such as `nxsat-227-i18n.mjs`, which are not phases.
      - name: Install the browser the runner drives
        run: npx playwright install --with-deps chromium

      - name: Serve the app for the capture
        run: |
          npx nx serve nuxeo-ui &
          timeout 180 bash -c \
            'until curl -sf http://localhost:4200 >/dev/null; do sleep 2; done'

      - name: Run evidence steps
        env:
          APP_URL: http://localhost:4200
          EVIDENCE_HEADLESS: '1'
        run: |
          # The Phase 3 browse capture also belongs in this loop; it is added back
          # under its own id when the harness step is renamed.
          for phase in phase-0-baseline phase-0-no-backend phase-1-config \
                       phase-1-tag-styles phase-2-registry \
                       phase-3-search phase-4-platform phase-5-harness phase-6-a11y; do
            npm run beta:evidence -- "$phase"
          done

      - name: Upload evidence
        uses: actions/upload-artifact@v4
        with:
          name: evidence-${{ github.run_id }}
          path: ~/agentic-ui-evidence/

      - name: Notify on failure
        if: failure()
        uses: actions/github-script@v7
        # ... notification logic
```

---

## Integration with CI/CD

From audit §12:

### Per-PR Gate (Already Implemented)

✅ `npm run beta:coverage` — coverage ratchet (Stage 1)  
✅ Lint, build, test — existing gates  
⏳ Recorded-fixture integration subset — planned  
⏳ Typecheck-specs gate — planned

### Nightly Runs (To Implement)

1. **Full integration suite** against live Nuxeo
2. **Full E2E suite** (chromium + webkit)
3. **13 evidence steps** from beta harness
4. **Evidence collection** uploaded as artifacts

**Estimated Runtime:** 12-15 minutes total

- Integration tests: ~3 minutes
- E2E tests (both engines): ~3 minutes
- Evidence steps: ~5 minutes
- Setup/teardown: ~4 minutes

---

## Acceptance Criteria for Stage 9

Per audit §11 Stage 9:

None of the four is met. Each was ticked against a status that says "planned" or "partially
done" in the same line — a tick recording that the work was _described_, not that it was
done, while the implementation checklist below still has the nightly workflow unchecked
because it does not exist. Stage 9 is blocked on the CI-container decision (open product
question 4 on the pull request), so these stay unticked until that is taken.

1. ⬜ **Promote `session-timeout.mjs` and `clipboard-move-scenarios.mjs`**
   - Status: planned — migration path documented, no migration performed

2. ⬜ **Convert `note-document-scenarios.mjs`**
   - Status: partially done in Stage 8 (notes tests); the conversion itself is outstanding

3. ⬜ **Bring 13 evidence steps under scheduled run**
   - Status: planned — the nightly workflow is documented and does not exist

4. ⬜ **Execute evidence steps as part of this stage's acceptance**
   - Status: not executed. `npm run beta:evidence` can run them by hand, which is the
     capability, not the acceptance.

---

## Migration Checklist

### Immediate (Can Do Now)

- [x] Document migration plan for orphan scripts
- [x] Document scheduled run approach
- [ ] Create GitHub Actions workflow for nightly runs
- [ ] Test nightly workflow with manual trigger

### Short-term (After Infrastructure Ready)

- [ ] Migrate `session-timeout.mjs` to integration test
- [ ] Migrate `clipboard-move-scenarios.mjs` to integration test
- [ ] Expand notes tests to cover full `note-document-scenarios.mjs`
- [ ] Delete orphan scripts after migration

### Long-term (Continuous)

- [ ] Run nightly evidence collection
- [ ] Monitor for flaky tests
- [ ] Collect evidence artifacts
- [ ] Report failures to team

---

## Blocker: CI Container

From audit §12.3, Stage 9 is blocked on:

**One of two prerequisites:**

1. Self-hosted runner with `nuxeo` container, OR
2. `packages.nuxeo.com` credentials + compose file

**Decision Required:** NXSAT-231 ownership or infrastructure team

This is the highest-leverage decision in the roadmap per audit §12.3.

---

## Files to Create

### When Implementing Stage 9

1. **`.github/workflows/nightly-evidence.yml`**
   - Nightly evidence collection workflow
   - Service container for Nuxeo
   - Artifact upload

2. **`libs/integration-tests/src/lib/session-timeout.integration.spec.ts`**
   - Migrated from `scripts/session-timeout.mjs`
   - ~150 lines estimated

3. **`libs/integration-tests/src/lib/clipboard-operations.integration.spec.ts`**
   - Migrated from `scripts/clipboard-move-scenarios.mjs`
   - ~200 lines estimated

4. **Expanded `feature-workflows.integration.spec.ts`**
   - Additional notes tests from `note-document-scenarios.mjs`
   - ~100 lines additional

---

## Estimated Effort

**Migration Work:**

- 3 scripts to migrate: ~3-4 hours each = 9-12 hours
- GitHub Actions workflow: ~2-3 hours
- Testing and verification: ~2-3 hours
- **Total: 13-17 hours**

**Blocker Resolution:**

- CI container decision: External dependency
- Container setup: 2-4 hours (after decision)

---

## Success Metrics

When Stage 9 is complete:

1. ✅ All orphan scripts migrated to `libs/integration-tests`
2. ✅ Nightly workflow runs automatically
3. ✅ Evidence artifacts collected and uploaded
4. ✅ Failures reported to team
5. ✅ No manual evidence collection needed

---

## Current Status

**Stage 9: PLANNED, NOT IMPLEMENTED**

- Migration path documented ✅
- Nightly workflow designed ✅
- Blockers identified ✅
- Ready for implementation when CI container available ⏳

**Reason for Deferral:**

- Blocked on CI container infrastructure (audit §12.3)
- Stage 1-8 provide sufficient foundation
- Migration is mechanical, not technically complex
- Can be done incrementally

---

## References

- **Audit:** `docs/integration-test-audit.md` §13 (Prioritised roadmap)
- **Audit:** `docs/integration-test-audit.md` §12 (CI/CD plan)
- **Audit:** `docs/integration-test-audit.md` §4.7 (Orphan scripts)
- **JIRA:** NXSAT-231 (Nightly E2E job specification)

---

**Last Updated:** 2026-09-21  
**Status:** Planned, awaiting CI container infrastructure  
**Next Step:** Resolve CI container blocker, then implement nightly workflow
