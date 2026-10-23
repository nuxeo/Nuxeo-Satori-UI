# CI Optimization Proposal

## Current Problem

The CI workflow (`.github/workflows/ci.yml`) runs all checks sequentially in a single job, taking **30+ minutes** to complete. The workflow is currently stuck on the Storybook interactions step.

### Current Workflow Structure

```
Single Job: lint-build-test (~30-40 minutes)
├── Static checks & guardrails (~7 min)
├── Lint (~3 min)
├── Build (~5 min)
├── Test (~10 min)
├── Typecheck (~2 min)
├── Storybook build (~1 min)
├── Storybook interactions (~5-10 min, sometimes longer)
├── Package verification (~3 min)
└── Bundle size check (~2 min)
```

**Total time: ~30-40 minutes** (all sequential)

## Proposed Solution: Parallel Job Execution

Split the monolithic job into **5 independent parallel jobs** that can run simultaneously:

### Optimized Workflow Structure

```
Job 1: static-checks       (~7 min)  ──┐
Job 2: lint-typecheck      (~5 min)  ──┤
Job 3: build               (~8 min)  ──┼─→ All run in parallel
Job 4: test                (~12 min) ──┤
Job 5: storybook           (~10 min) ──┘

Total wall-clock time: ~12-15 minutes (slowest job duration)
```

### Time Savings

- **Current**: 30-40 minutes sequential
- **Optimized**: 12-15 minutes parallel
- **Improvement**: ~60-70% faster (15-25 minutes saved)

## Job Breakdown

### Job 1: static-checks (~7 minutes)

**Purpose**: Fast static analysis and guardrails that don't require builds

- Review guardrails
- Satori rename codemod controls
- i18n guardrail controls
- Crowdin context push controls
- Review-harvest and Confluence link controls
- Static beta gates (lockfile, dependency tree, audit, reference, supply chain, sanitizers)

**Dependencies**: None
**Artifacts**: None

### Job 2: lint-typecheck (~5 minutes)

**Purpose**: Code quality checks without compilation

- Lint affected projects
- Typecheck affected projects

**Dependencies**: None
**Artifacts**: None
**Note**: This is faster than the original because it doesn't wait for other jobs

### Job 3: build (~8 minutes)

**Purpose**: Build projects and verify bundle characteristics

- Build affected projects
- Build nuxeo-ui (production)
- Verify bundle contents and size
- Verify published package (platform build, API surface, publishability, installability, fork, upgrade)

**Dependencies**: None
**Artifacts**: Build outputs (implicitly cached by Nx)
**Note**: Package verification runs here because it needs the platform build

### Job 4: test (~12 minutes)

**Purpose**: Run unit tests for affected projects

- Test specific projects (document-detail, knowledge-discovery, search, browse)
- Test other affected projects

**Dependencies**: None
**Artifacts**: Test results
**Note**: This is typically the longest-running job

### Job 5: storybook (~10 minutes)

**Purpose**: Storybook build and interaction tests

- Build Storybook without GitHub Packages
- Run Storybook interaction tests (Playwright)
- Upload interaction results

**Dependencies**: None
**Artifacts**: Storybook interaction results
**Note**: Isolated to prevent Playwright installation from affecting other jobs

## Implementation Steps

### Option A: Replace Current Workflow (Recommended for Testing)

1. **Backup current workflow**:

   ```bash
   cp .github/workflows/ci.yml .github/workflows/ci-original.yml.bak
   ```

2. **Replace with optimized version**:

   ```bash
   cp .github/workflows/ci-optimized.yml .github/workflows/ci.yml
   ```

3. **Commit and push to a test branch**:

   ```bash
   git checkout -b ci-optimization-test
   git add .github/workflows/ci.yml
   git commit -m "test: optimize CI workflow with parallel jobs"
   git push origin ci-optimization-test
   ```

4. **Create a PR and observe the workflow run**

5. **If successful, merge to main**

### Option B: Run Both Workflows in Parallel (Safer)

Keep the original `ci.yml` and add the optimized one as `ci-parallel.yml` initially. This allows you to compare results before fully switching.

1. **Rename optimized workflow**:

   ```bash
   mv .github/workflows/ci-optimized.yml .github/workflows/ci-parallel.yml
   ```

2. **Update the workflow name** in `ci-parallel.yml`:

   ```yaml
   name: CI (Parallel) # Change from "CI (Optimized)"
   ```

3. **Commit both workflows**:

   ```bash
   git add .github/workflows/ci-parallel.yml
   git commit -m "feat: add parallel CI workflow for testing"
   git push
   ```

4. **Monitor both workflows** for a few PRs

5. **Once confident, remove the old workflow**:
   ```bash
   rm .github/workflows/ci.yml
   mv .github/workflows/ci-parallel.yml .github/workflows/ci.yml
   git add .github/workflows/
   git commit -m "feat: switch to optimized parallel CI workflow"
   git push
   ```

## Additional Optimizations to Consider

### 1. Matrix Strategy for Tests

Split the test job further using a matrix strategy:

```yaml
test:
  strategy:
    matrix:
      project: [document-detail, knowledge-discovery, search, browse, other]
  steps:
    # ... setup ...
    - name: Test ${{ matrix.project }}
      run: |
        if [ "${{ matrix.project }}" = "other" ]; then
          npx nx affected -t test --base=$NX_BASE --head=$NX_HEAD --exclude=browse,document-detail,knowledge-discovery,search
        else
          npx nx run ${{ matrix.project }}:test --output-style=stream
        fi
```

This would create 5 parallel test jobs, reducing test time from ~12 minutes to ~3-4 minutes.

### 2. Cache Optimization

Add explicit caching for node_modules to speed up dependency installation:

```yaml
- name: Cache node modules
  uses: actions/cache@v4
  with:
    path: node_modules
    key: ${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}
    restore-keys: |
      ${{ runner.os }}-node-
```

### 3. Conditional Job Execution

Add more granular conditional execution to skip jobs when not affected:

```yaml
jobs:
  check-affected:
    runs-on: ubuntu-latest
    outputs:
      storybook: ${{ steps.check.outputs.storybook }}
      tests: ${{ steps.check.outputs.tests }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: nrwl/nx-set-shas@v4
      - id: check
        run: |
          echo "storybook=$(npx nx show projects --affected | grep -q satori-components && echo 'true' || echo 'false')" >> $GITHUB_OUTPUT
          echo "tests=$(npx nx show projects --affected -t test | wc -l)" >> $GITHUB_OUTPUT

  storybook:
    needs: check-affected
    if: needs.check-affected.outputs.storybook == 'true'
    # ... rest of job
```

### 4. Storybook Interaction Optimization

Investigate why Storybook interactions are slow:

- Review `scripts/storybook-interactions.mjs` for potential optimizations
- Consider running only changed stories instead of all stories
- Check if Playwright browser installation can be cached
- Consider using `--shard` to split stories across multiple runners:

```yaml
storybook-interactions:
  strategy:
    matrix:
      shard: [1, 2, 3, 4]
  steps:
    # ... setup ...
    - name: Run Storybook interactions (shard ${{ matrix.shard }}/4)
      run: node scripts/storybook-interactions.mjs --shard=${{ matrix.shard }}/4
```

## Monitoring & Rollback

### Success Criteria

- All 5 jobs complete successfully
- Total wall-clock time < 15 minutes
- No false positives or negatives compared to original workflow

### Monitoring

```bash
# Watch workflow runs
gh run list --workflow=ci.yml --limit 10

# View specific run
gh run view <run-id>

# Compare timings
gh run view <original-run-id> --json jobs > original-timing.json
gh run view <optimized-run-id> --json jobs > optimized-timing.json
```

### Rollback Plan

If issues occur:

```bash
git revert <commit-hash>
git push
```

Or restore from backup:

```bash
cp .github/workflows/ci-original.yml.bak .github/workflows/ci.yml
git add .github/workflows/ci.yml
git commit -m "revert: restore original CI workflow"
git push
```

## Cost Considerations

**Runner Minutes Used**:

- **Current**: 1 job × 35 minutes = 35 minutes per run
- **Optimized**: 5 jobs × 12 minutes = 60 minutes per run (more runner minutes, but 60% faster wall-clock time)

**Trade-off**: You'll use ~70% more runner minutes, but PRs will get feedback in ~40% of the time. This is typically worth it for developer productivity.

**Cost optimization**: If runner minutes are a concern, you can:

1. Use self-hosted runners (free runner minutes)
2. Only run the full parallel workflow on `main` and integration branches
3. Use a lighter workflow for draft PRs

## References

- Original workflow: `.github/workflows/ci.yml`
- Optimized workflow: `.github/workflows/ci-optimized.yml`
- GitHub Actions: [Running jobs in parallel](https://docs.github.com/en/actions/using-jobs/using-a-matrix-for-your-jobs)
- Nx: [Running tasks in CI](https://nx.dev/ci/intro/ci-with-nx)
