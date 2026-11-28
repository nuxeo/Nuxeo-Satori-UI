import { type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { expect } from './fixtures';
import { runPrefix } from './run-prefix.mjs';

/**
 * Documents the write-path specs create for themselves, so they never depend on one instance's
 * content and never touch anyone else's. Every title carries a per-run suffix, and `dispose`
 * deletes what was made even when the spec fails half way.
 */
export interface MadeDoc {
  uid: string;
  title: string;
}

/**
 * The test account's own personal workspace. It owns everything it creates there, so the specs
 * that write do not depend on the permissions of whatever shared workspace an instance has.
 */
export async function aWorkspacePath(api: APIRequestContext): Promise<string> {
  const response = await api.post('/nuxeo/api/v1/automation/UserWorkspace.Get', {
    data: { params: {}, context: {} },
  });
  expect(response.status(), 'UserWorkspace.Get should answer for the test account').toBe(200);
  const path: string | undefined = (await response.json()).path;
  expect(path, 'the account should have a personal workspace').toBeTruthy();
  return path!;
}

export async function createFile(
  api: APIRequestContext,
  parentPath: string,
  title: string,
): Promise<MadeDoc | null> {
  const response = await api.post(`/nuxeo/api/v1/path${encodeURI(parentPath)}`, {
    data: {
      'entity-type': 'document',
      type: 'File',
      name: title,
      properties: { 'dc:title': title },
    },
  });
  if (!response.ok()) return null;
  const body = await response.json();
  return { uid: body.uid, title };
}

export async function trashDoc(api: APIRequestContext, uid: string): Promise<void> {
  const response = await api.post(`/nuxeo/api/v1/id/${uid}/@op/Document.Trash`, { data: {} });
  expect(response.ok(), `trashing ${uid} through the API should succeed`).toBe(true);
}

export async function isTrashed(api: APIRequestContext, uid: string): Promise<boolean> {
  const response = await api.get(`/nuxeo/api/v1/id/${uid}`);
  expect(response.status(), 'the document should still exist').toBe(200);
  return (await response.json()).isTrashed === true;
}

/** Permanent delete; a missing document is fine, so cleanup can run unconditionally. */
export async function removeDoc(api: APIRequestContext, uid: string): Promise<void> {
  await api.delete(`/nuxeo/api/v1/id/${uid}`);
}

/**
 * A title no other run uses: the run's prefix when CI gives one (`E2E_RUN_PREFIX`, read by
 * `run-prefix.mjs`), then `prefix`, then a random suffix. The pull request
 * smoke run sets the run prefix, so everything it made can be found and trashed at the end
 * (`scripts/beta-harness/e2e-sweep.mjs`) even when a spec never reached its own cleanup. A
 * malformed run prefix throws here, before anything is written.
 */
export function uniqueTitle(prefix: string): string {
  return `${runPrefix()}${prefix}-${randomUUID().slice(0, 8)}`;
}
