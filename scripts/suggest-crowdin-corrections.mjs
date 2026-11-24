/**
 * Narrow Crowdin project-160 suggestion preparation/apply helper.
 *
 * Official API: https://support.crowdin.com/developer/enterprise/api/v2/
 * This helper adds AI-labelled suggestions only. It never changes sources,
 * existing translations, approvals, project settings, or translation memory.
 * Default: read-only preflight. Add --apply to submit the checked suggestions.
 * The only write endpoint permitted is POST /projects/160/translations.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const argumentsList = process.argv.slice(2);
const allowedArguments = new Set(['--apply', '--manifest', '--output']);
for (let index = 0; index < argumentsList.length; index += 1) {
  const argument = argumentsList[index];
  if (!allowedArguments.has(argument)) throw new Error('Unknown command-line argument');
  if (argument !== '--apply') {
    if (!argumentsList[index + 1] || argumentsList[index + 1].startsWith('--')) {
      throw new Error('Missing command-line option value');
    }
    index += 1;
  }
}
function option(name, fallback) {
  const position = argumentsList.indexOf(name);
  return position < 0 ? fallback : argumentsList[position + 1];
}
const apply = argumentsList.includes('--apply');
const manifestPath = resolve(option('--manifest', join(scriptDirectory, 'corrections.json')));
const outputDirectory = resolve(option('--output', 'crowdin-review'));
mkdirSync(outputDirectory, { recursive: true });
const report = {
  generatedAt: new Date().toISOString(),
  projectId: 160,
  mode: apply ? 'add-ai-suggestions' : 'read-only-preflight',
  preflightPassed: false,
  approvalWrites: 0,
  sourceWrites: 0,
  existingTranslationWrites: 0,
  translationMemoryWritesRequested: false,
  entries: [],
};
const saveReport = () => writeFileSync(join(outputDirectory, 'suggestion-audit.json'), `${JSON.stringify(report, null, 2)}\n`);

const apiOrigin = 'https://hyland.api.crowdin.com';
const apiPrefix = '/api/v2/projects/160';
let token;
async function request(resource, { method = 'GET', body } = {}) {
  if (!resource.startsWith(`${apiPrefix}/`)) throw new Error('API resource outside project 160');
  if (method !== 'GET' && !(apply && method === 'POST' && resource === `${apiPrefix}/translations`)) {
    throw new Error('Mutation endpoint is not permitted');
  }
  let response;
  try {
    response = await fetch(`${apiOrigin}${resource}`, {
      method,
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    // Never print fetch objects, authorization headers, raw response bodies or the token.
    throw new Error(`Crowdin ${method} request failed; inspect audit and rerun idempotently`);
  }
  if (!response.ok) throw new Error(`Crowdin ${method} returned HTTP ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new Error('Crowdin returned an invalid JSON response');
  }
}
async function list(resource, parameters = {}) {
  const entries = [];
  const identifiers = new Set();
  let offset = 0;
  for (let page = 0; page < 1000; page += 1) {
    const query = new URLSearchParams({ ...parameters, limit: '500', offset: String(offset) });
    const payload = await request(`${apiPrefix}/${resource}?${query}`);
    if (!Array.isArray(payload.data)) throw new Error('Unexpected Crowdin collection shape');
    const values = payload.data.map((entry) => entry.data);
    for (const value of values) {
      if (!value || !Number.isInteger(value.id) || identifiers.has(value.id)) {
        throw new Error('Unexpected or repeated Crowdin collection identifier');
      }
      identifiers.add(value.id);
      entries.push(value);
    }
    const pageLimit = Number(payload.pagination?.limit ?? 500);
    if (!Number.isInteger(pageLimit) || pageLimit < 1 || pageLimit > 500) {
      throw new Error('Unexpected Crowdin pagination limit');
    }
    if (values.length < pageLimit) return entries;
    offset += values.length;
  }
  throw new Error('Crowdin pagination exceeded the bounded safety limit');
}
const normalizedPath = (value) => String(value ?? '').replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
const placeholders = (value) => [...value.matchAll(/{{\s*([^{}]+?)\s*}}/g)].map((match) => match[1].trim()).sort();
const sameArray = (left, right) => JSON.stringify(left) === JSON.stringify(right);

try {
  if (process.env.CROWDIN_PROJECT_ID !== '160') throw new Error('CROWDIN_PROJECT_ID must be exactly 160');
  token = process.env.CROWDIN_PERSONAL_TOKEN;
  if (!token) throw new Error('CROWDIN_PERSONAL_TOKEN is unavailable');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.version !== 1 || manifest.projectId !== 160 || manifest.sourcePath !== 'apps/nuxeo-ui/public/i18n/en.json') {
    throw new Error('Unexpected manifest version, project or source mapping');
  }
  if (!Array.isArray(manifest.corrections) || manifest.corrections.length !== 39) {
    throw new Error('Expected the 39 reviewed translation corrections');
  }
  const allowedLanguages = new Set(['ar', 'he', 'it', 'sv', 'es']);
  const correctionIdentifiers = new Set();
  for (const correction of manifest.corrections) {
    if (!allowedLanguages.has(correction.languageId)) throw new Error('Unexpected correction language');
    const identifier = `${correction.languageId}:${correction.identifier}`;
    if (correctionIdentifiers.has(identifier)) throw new Error('Duplicate correction');
    correctionIdentifiers.add(identifier);
    for (const field of ['identifier', 'expectedSource', 'expectedTranslation', 'text', 'reason']) {
      if (typeof correction[field] !== 'string' || !correction[field].trim()) throw new Error('Incomplete correction');
    }
    if (correction.text === correction.expectedTranslation) throw new Error('Correction does not change the translation');
    if (!sameArray(placeholders(correction.expectedSource), placeholders(correction.text))) {
      throw new Error('Correction changes source interpolation placeholders');
    }
  }

  const files = await list('files');
  let directories;
  function directoryPath(directoryId) {
    const parts = [];
    const visited = new Set();
    while (directoryId) {
      if (visited.has(directoryId)) throw new Error('Cyclic Crowdin directory hierarchy');
      visited.add(directoryId);
      const directory = directories.find((entry) => entry.id === directoryId);
      if (!directory) throw new Error('Crowdin directory mapping is incomplete');
      parts.unshift(directory.name);
      directoryId = directory.directoryId ?? directory.parentId;
    }
    return parts.join('/');
  }
  if (files.some((file) => file.name === 'en.json' && !file.path)) directories = await list('directories');
  const matchingFiles = files.filter((file) => {
    if (file.name !== 'en.json' || file.branchId) return false;
    const filePath = file.path || `${directoryPath(file.directoryId)}/${file.name}`;
    return normalizedPath(filePath) === manifest.sourcePath;
  });
  if (matchingFiles.length !== 1) throw new Error('Expected exactly one English source file matching the full configured path');
  const fileId = matchingFiles[0].id;
  report.sourceFile = { id: fileId, path: manifest.sourcePath };
  const strings = await list('strings', { fileId: String(fileId) });
  const plan = [];
  for (const correction of manifest.corrections) {
    const matchingStrings = strings.filter((entry) => entry.fileId === fileId && entry.identifier === correction.identifier);
    if (matchingStrings.length !== 1) throw new Error(`Expected one exact source identifier: ${correction.identifier}`);
    const source = matchingStrings[0];
    if (source.text !== correction.expectedSource) throw new Error(`English source changed: ${correction.identifier}`);
    const parameters = { stringId: String(source.id), languageId: correction.languageId };
    const translations = await list('translations', parameters);
    const approvals = await list('approvals', parameters);
    const exactSuggestions = translations.filter((translation) => translation.text === correction.text);
    const expectedTranslations = translations.filter((translation) => translation.text === correction.expectedTranslation);
    const approvedTranslationIds = new Set(approvals.map((approval) => approval.translationId));
    const expectedApproved = expectedTranslations.some((translation) => approvedTranslationIds.has(translation.id));
    if (!exactSuggestions.length && !expectedApproved) {
      throw new Error(`Approved translation changed or is unavailable: ${correction.languageId}:${correction.identifier}`);
    }
    const audit = {
      languageId: correction.languageId,
      identifier: correction.identifier,
      stringId: source.id,
      expectedSource: correction.expectedSource,
      expectedTranslation: correction.expectedTranslation,
      suggestedText: correction.text,
      reason: correction.reason,
      beforeApprovalIds: approvals.map((approval) => approval.id),
      expectedApproved,
      existingSuggestionIds: exactSuggestions.map((translation) => translation.id),
      status: exactSuggestions.length ? 'already-present' : 'preflight-ready',
    };
    report.entries.push(audit);
    plan.push({ correction, source, audit });
  }
  // All 39 source/current-value checks finish before the first mutation.
  report.preflightPassed = true;
  saveReport();
  if (apply) {
    for (const { correction, source, audit } of plan) {
      // Recheck immediately before POST so a rerun after a partial failure cannot duplicate suggestions.
      const parameters = { stringId: String(source.id), languageId: correction.languageId };
      const currentTranslations = await list('translations', parameters);
      const existing = currentTranslations.find((translation) => translation.text === correction.text);
      if (existing) {
        audit.status = 'already-present';
        audit.translationId = existing.id;
        saveReport();
        continue;
      }
      const currentApprovals = await list('approvals', parameters);
      const approvedIds = new Set(currentApprovals.map((approval) => approval.translationId));
      if (!currentTranslations.some((translation) => translation.text === correction.expectedTranslation && approvedIds.has(translation.id))) {
        throw new Error(`Approved translation changed after preflight: ${correction.languageId}:${correction.identifier}`);
      }
      const payload = await request(`${apiPrefix}/translations`, {
        method: 'POST',
        body: { stringId: source.id, languageId: correction.languageId, text: correction.text, provider: 'ai', addToTm: false },
      });
      if (!Number.isInteger(payload.data?.id) || payload.data.text !== correction.text) {
        throw new Error('Unexpected add-suggestion response; inspect audit and rerun idempotently');
      }
      audit.translationId = payload.data.id;
      audit.status = 'added-awaiting-linguistic-review';
      saveReport();
      const afterApprovals = await list('approvals', parameters);
      const afterIds = new Set(afterApprovals.map((approval) => approval.id));
      if (!currentApprovals.every((approval) => afterIds.has(approval.id))) {
        throw new Error('Existing approvals changed unexpectedly; no approval changes were requested');
      }
      if (afterApprovals.some((approval) => approval.translationId === payload.data.id)) {
        audit.status = 'unexpected-project-side-approval';
        throw new Error('Project workflow approved the suggestion unexpectedly; no approval was requested');
      }
      audit.afterApprovalIds = afterApprovals.map((approval) => approval.id);
      saveReport();
    }
  }
  report.completedAt = new Date().toISOString();
  report.success = true;
  saveReport();
  console.log(`${apply ? 'Suggestion submission' : 'Read-only preflight'} completed for ${report.entries.length} entries. No approvals or source changes requested.`);
  console.log(`Audit: ${join(outputDirectory, 'suggestion-audit.json')}`);
} catch (error) {
  report.success = false;
  report.error = error instanceof Error ? error.message : 'Unexpected diagnostic failure';
  saveReport();
  console.error(report.error);
  console.error('Stopped. Existing suggestions/approvals were not deleted; consult the partial audit before an idempotent rerun.');
  process.exitCode = 1;
}
