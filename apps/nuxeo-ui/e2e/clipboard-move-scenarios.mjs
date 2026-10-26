/**
 * NXSAT-183 — Clipboard Move parity test (Web UI vs Satori).
 *
 * Run:
 *   $env:NUXEO_TEST_USER="<username>"
 *   $env:NUXEO_TEST_PASSWORD="<password>"
 *   node apps/nuxeo-ui/e2e/clipboard-move-scenarios.mjs
 *
 * Requires: nx serve nuxeo-ui (:4200) and Nuxeo (:8080)
 */
import { chromium } from 'playwright';

const BASE = process.env.AGENTIC_UI_BASE_URL ?? 'http://localhost:4200';
const NUXEO = process.env.NUXEO_BASE_URL ?? 'http://localhost:8080/nuxeo';
const user = process.env.NUXEO_TEST_USER;
const pass = process.env.NUXEO_TEST_PASSWORD;

if (!user || !pass) {
  console.error(
    'Set NUXEO_TEST_USER and NUXEO_TEST_PASSWORD environment variables before running this script.',
  );
  process.exit(1);
}

const results = [];

function log(step, status, detail = '') {
  const line = `[${status}] ${step}${detail ? ` — ${detail}` : ''}`;
  console.log(line);
  results.push({ step, status, detail });
}

async function nuxeoFetch(pathname, init = {}) {
  const auth = Buffer.from(`${user}:${pass}`).toString('base64');
  const res = await fetch(`${NUXEO}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${pathname} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function login(page) {
  await page.goto(`${BASE}/#/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.locator('input[autocomplete="username"]').fill(user);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('input[autocomplete="current-password"]').fill(pass);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL(/#\/(dashboard|browse|doc)/, { timeout: 60_000 });
}

async function waitForSnackbar(page, pattern, timeout = 20_000) {
  const snack = page.locator('.mat-mdc-snack-bar-container');
  await snack.waitFor({ timeout });
  const text = (await snack.textContent()) ?? '';
  if (!pattern.test(text)) {
    throw new Error(`Snackbar mismatch. Expected ${pattern}, got: ${text}`);
  }
  return text.trim();
}

async function resolveWorkspacePath() {
  try {
    const doc = await nuxeoFetch('/api/v1/path/default-domain/workspaces');
    if (doc?.path) return doc.path;
  } catch {
    // fall through
  }
  const list = await nuxeoFetch('/api/v1/path/default-domain/workspaces/@children?pageSize=10');
  const entry = list.entries?.find((e) => e.type === 'Workspace') ?? list.entries?.[0];
  if (!entry?.path) throw new Error('Could not resolve a workspace');
  return entry.path;
}

async function ensureFolder(parentPath, name) {
  const children = await nuxeoFetch(
    `/api/v1/path${encodeURI(parentPath)}/@children?pageSize=50`,
  );
  const existing = children.entries?.find((e) => e.title === name && e.type === 'Folder');
  if (existing) return existing;

  return nuxeoFetch('/api/v1/automation/Document.Create', {
    method: 'POST',
    body: JSON.stringify({
      params: {
        type: 'Folder',
        name,
        properties: { 'dc:title': name },
      },
      context: {},
      input: `doc:${(await nuxeoFetch(`/api/v1/path${encodeURI(parentPath)}`)).uid}`,
    }),
  });
}

async function createTestFile(parentUid, title) {
  return nuxeoFetch('/api/v1/automation/Document.Create', {
    method: 'POST',
    body: JSON.stringify({
      params: {
        type: 'File',
        name: title.replace(/\s+/g, '-').toLowerCase(),
        properties: { 'dc:title': title },
      },
      context: {},
      input: `doc:${parentUid}`,
    }),
  });
}

async function folderContainsTitle(folderPath, title) {
  const children = await nuxeoFetch(
    `/api/v1/path${encodeURI(folderPath)}/@children?pageSize=100`,
  );
  return children.entries?.some((e) => e.title === title) ?? false;
}

async function findBrowseFolderWithFiles(page) {
  const browsePaths = [
    '/#/browse/default-domain/workspaces',
    '/#/browse/default-domain/UserWorkspaces',
    '/#/browse/default-domain',
  ];

  for (const browsePath of browsePaths) {
    await page.goto(`${BASE}${browsePath}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    for (let depth = 0; depth < 4; depth++) {
      const rowCheckboxes = page.locator('.browse-table tbody .cell-checkbox mat-checkbox');
      if ((await rowCheckboxes.count()) >= 1) {
        const breadcrumb = await page.locator('sat-breadcrumbs').innerText().catch(() => '');
        return { breadcrumb: breadcrumb.trim(), url: page.url() };
      }
      const folderRows = page.locator('.browse-table tbody tr.browse-row--folder');
      if ((await folderRows.count()) === 0) break;
      await folderRows.first().click();
      await page.waitForTimeout(2000);
    }
  }
  return null;
}

async function main() {
  const stamp = Date.now();
  const fileTitle = `NXSAT-183-move-${stamp}`;
  const sourceFolderName = `nxsat183-source-${stamp}`;
  const targetFolderName = `nxsat183-target-${stamp}`;

  log('Setup', 'RUN', 'Creating source/target folders and test file via Nuxeo API');
  const workspacePath = await resolveWorkspacePath();
  const sourceFolder = await ensureFolder(workspacePath, sourceFolderName);
  const targetFolder = await ensureFolder(workspacePath, targetFolderName);
  const testFile = await createTestFile(sourceFolder.uid, fileTitle);
  log('Setup', 'PASS', `file "${fileTitle}" in ${sourceFolder.path}`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const apiCalls = [];
  page.on('response', (res) => {
    const url = res.url();
    if (url.includes('/automation/Document.Move') || url.includes('/automation/Document.Copy')) {
      apiCalls.push({ url, status: res.status(), op: url.includes('Move') ? 'Move' : 'Copy' });
    }
  });

  try {
    await login(page);
    log('Login', 'PASS', 'Authenticated');

    const sourceBrowseUrl = `${BASE}/#/browse${sourceFolder.path}`;
    await page.goto(sourceBrowseUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);

    const fileRow = page.locator('.browse-table tbody tr').filter({ hasText: fileTitle }).first();
    if (!(await fileRow.isVisible({ timeout: 10_000 }).catch(() => false))) {
      throw new Error(`Test file "${fileTitle}" not visible in source folder browse view`);
    }

    const checkbox = fileRow.locator('.cell-checkbox mat-checkbox');
    await checkbox.click();
    await page.waitForTimeout(500);

    const addClipboardBtn = page.locator('button[aria-label="Add to Clipboard"]').first();
    await addClipboardBtn.waitFor({ state: 'visible', timeout: 5000 });
    await addClipboardBtn.click();
    await page.waitForTimeout(800);
    log('Add to clipboard', 'PASS', fileTitle);

    const badge = page.locator('a[sat-platform-nav-menu-item].nav-item--clipboard-badge').first();
    const badgeVisible = await badge.isVisible({ timeout: 3000 }).catch(() => false);
    log('Clipboard nav badge', badgeVisible ? 'PASS' : 'FAIL', badgeVisible ? 'visible on nav icon' : 'missing');

    const targetBrowseUrl = `${BASE}/#/browse${targetFolder.path}`;
    await page.goto(targetBrowseUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    log('Navigate target', 'PASS', targetFolder.path);

    await page.locator('a[sat-platform-nav-menu-item]').filter({ hasText: 'Clipboard' }).first().click();
    await page.waitForTimeout(1200);

    const moveBtn = page.locator('.clipboard-action-btn').filter({ hasText: 'Move' }).first();
    const copyBtn = page.locator('.clipboard-action-btn').filter({ hasText: 'Copy' }).first();

    const moveEnabled = await moveBtn.isEnabled().catch(() => false);
    const copyEnabled = await copyBtn.isEnabled().catch(() => false);
    log('Paste target buttons', moveEnabled && copyEnabled ? 'PASS' : 'FAIL', `Copy=${copyEnabled}, Move=${moveEnabled}`);

    if (!moveEnabled) {
      throw new Error('Move button disabled — clipboard target not set on folder browse');
    }

    const countBefore = await page.locator('.result-count').textContent().catch(() => '0');
    await moveBtn.click();

    const snackText = await waitForSnackbar(page, /Moved/i);
    log('Move snackbar', 'PASS', snackText);

    const moveApi = apiCalls.find((c) => c.op === 'Move');
    if (!moveApi) {
      log('Move API call', 'FAIL', 'Document.Move not observed');
    } else {
      log('Move API call', moveApi.status >= 200 && moveApi.status < 300 ? 'PASS' : 'FAIL', `${moveApi.status}`);
    }

    await page.waitForTimeout(2000);

    const emptyClipboard = page.locator('.clipboard-panel').filter({ hasText: 'Clipboard is empty' });
    const clipboardCleared = await emptyClipboard.isVisible({ timeout: 5000 }).catch(() => false);
    log('Clipboard cleared', clipboardCleared ? 'PASS' : 'FAIL', clipboardCleared ? 'empty state shown' : 'items remain');

    const countAfter = await page.locator('.result-count').textContent().catch(() => '');
    const beforeNum = parseInt((countBefore ?? '').replace(/\D/g, ''), 10);
    const afterNum = parseInt((countAfter ?? '').replace(/\D/g, ''), 10);
    const uiShowsNewFile = await page.locator('.browse-table tbody tr').filter({ hasText: fileTitle }).isVisible({ timeout: 5000 }).catch(() => false);

    if (uiShowsNewFile) {
      log('Target folder UI refresh', 'PASS', `listing shows "${fileTitle}" (${countBefore} → ${countAfter})`);
    } else if (Number.isFinite(beforeNum) && Number.isFinite(afterNum) && afterNum > beforeNum) {
      log('Target folder UI refresh', 'PASS', `result count ${beforeNum} → ${afterNum}`);
    } else {
      log('Target folder UI refresh', 'FAIL', `file not visible without manual refresh (${countBefore} → ${countAfter})`);
    }

    const inTarget = await folderContainsTitle(targetFolder.path, fileTitle);
    const inSource = await folderContainsTitle(sourceFolder.path, fileTitle);
    log('Document in target (API)', inTarget ? 'PASS' : 'FAIL', targetFolder.path);
    log('Document removed from source (API)', !inSource ? 'PASS' : 'FAIL', sourceFolder.path);

    // Web UI parity: Move empties clipboard and removes from source; Copy keeps source copy.
    log('Web UI parity', inTarget && !inSource && clipboardCleared ? 'PASS' : 'PARTIAL', 'Move removes source + clears clipboard');

    const failures = results.filter((r) => r.status === 'FAIL');
    console.log('\n=== Summary ===');
    for (const r of results) {
      console.log(`  ${r.status.padEnd(6)} ${r.step}${r.detail ? `: ${r.detail}` : ''}`);
    }
    if (failures.length > 0) {
      process.exitCode = 1;
      console.log(`\n${failures.length} failure(s)`);
    } else {
      console.log('\nAll checks passed');
    }
  } catch (err) {
    log('Fatal', 'FAIL', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
