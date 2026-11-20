import { type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { expect } from './fixtures';

/**
 * Documents the write-path specs create for themselves, so they never depend on one instance's
 * content and never touch anyone else's. Every title carries a per-run suffix, and `dispose`
 * deletes what was made even when the spec fails half way.
 */
export interface MadeDoc {
  uid: string;
  title: string;
}

/** A workspace the test account can create in, discovered rather than named. */
export async function aWorkspacePath(api: APIRequestContext): Promise<string> {
  const response = await api.get('/nuxeo/api/v1/search/lang/NXQL/execute', {
    params: {
      query: 'SELECT * FROM Workspace WHERE ecm:isTrashed = 0 AND ecm:isVersion = 0',
      pageSize: 20,
    },
  });
  expect(response.status(), 'the NXQL query for a workspace should answer').toBe(200);
  const entries: { path: string; contextParameters?: unknown }[] =
    (await response.json()).entries ?? [];
  expect(
    entries.length,
    'no Workspace exists, so nothing can be created for the spec',
  ).toBeGreaterThan(0);
  for (const entry of entries) {
    // System areas (`/management/...`) are not for test content. A workspace is usable only if
    // the account can create in it AND write to what it created: restoring from the trash needs
    // Write, and on some workspaces the account can add children but not restore them (403).
    if (entry.path.startsWith('/management')) continue;
    const probe = await createFile(api, entry.path, `e2e-probe-${randomUUID().slice(0, 8)}`);
    if (!probe) continue;
    const read = await api.get(`/nuxeo/api/v1/id/${probe.uid}`, {
      headers: { 'X-NXenrichers.document': 'permissions' },
    });
    const permissions: string[] = (await read.json()).contextParameters?.permissions ?? [];
    await removeDoc(api, probe.uid);
    if (permissions.includes('Write')) return entry.path;
  }
  throw new Error('the test account cannot create a File in any Workspace on this instance');
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

export function uniqueTitle(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}
