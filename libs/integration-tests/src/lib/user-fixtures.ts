/**
 * Non-administrator user fixtures for RBAC testing.
 *
 * Stage 7 of the integration-test plan: RBAC and Guards.
 * The missing ingredient — fixtures.ts hardcodes isAdministrator=true and groups=[].
 *
 * Creates/deletes non-admin Nuxeo users for permission testing.
 * Each user is scoped to a test run to prevent conflicts.
 *
 * Usage:
 *   const user = await createNonAdminUser(harness, { username: 'testuser' });
 *   // ... run tests with user.credentials ...
 *   await deleteUser(harness, user.username);
 */

import { randomBytes } from 'node:crypto';

import type { NuxeoUser } from '@nuxeo/satori-platform/nuxeo-client';

/**
 * A password for one test user, for one run.
 *
 * The default used to be the literal `TestPass123!`, which is a working credential in the
 * repository for every account this library creates. `deleteUser` can fail — and until this
 * pass it failed quietly — so the combination was a predictable username *and* a predictable
 * password left active on a shared instance.
 *
 * Random per user, so a leaked account is not a usable one. The fixed prefix keeps it inside
 * any password policy that wants an upper, a lower, a digit and a symbol; the entropy is the
 * 24 random bytes after it.
 */
function generatePassword(): string {
  return `Tp1!${randomBytes(24).toString('base64url')}`;
}

export interface TestUser {
  username: string;
  password: string;
  email: string;
  firstName: string;
  lastName: string;
  /** Basic auth header: `Basic ${base64(username:password)}` */
  auth: string;
  /**
   * The user entity Nuxeo answered `POST /api/v1/user` with.
   *
   * `any` until now, on an **exported** type, so every RBAC spec reading through this field
   * read an unchecked shape — `user.nuxeoUser.properties.username` type-checked whatever the
   * model said, and a rename in `NuxeoUser` would not have reached the specs that depend on
   * it. The shared client already publishes the model; there was no reason for a second,
   * untyped spelling of it.
   */
  nuxeoUser: NuxeoUser;
}

export interface CreateUserOptions {
  /** Username (will be prefixed with runId for uniqueness). Default: 'testuser' */
  username?: string;
  /** Password. Default: a fresh random one per user — see `generatePassword`. */
  password?: string;
  /** Email. Default: {username}@test.local */
  email?: string;
  /** First name. Default: 'Test' */
  firstName?: string;
  /** Last name. Default: 'User' */
  lastName?: string;
  /** Groups to add user to. Default: [] (no groups for maximum isolation) */
  groups?: string[];
}

/**
 * Create a non-administrator test user in Nuxeo.
 *
 * The user is scoped to the test run (username prefixed with runId) to prevent conflicts.
 * By default, user has NO groups for maximum isolation and to ensure permission tests work correctly.
 *
 * **Important:** Call `deleteUser()` in test cleanup to remove the user.
 *
 * @param harness Integration test harness (provides nuxeoUrl, auth, runId)
 * @param options User creation options
 * @returns TestUser with credentials and auth header
 */
export async function createNonAdminUser(
  harness: { nuxeoUrl: string; auth: string; runId: string },
  options: CreateUserOptions = {},
): Promise<TestUser> {
  const {
    username = 'testuser',
    password = generatePassword(),
    email,
    firstName = 'Test',
    lastName = 'User',
    groups = [], // NO groups by default for isolation
  } = options;

  // Scope username to test run to prevent conflicts
  const scopedUsername = `${username}-${harness.runId}`;
  const userEmail = email ?? `${scopedUsername}@test.local`;

  // Create user via Nuxeo User Manager API
  const createRes = await fetch(`${harness.nuxeoUrl}/nuxeo/api/v1/user`, {
    method: 'POST',
    headers: {
      Authorization: harness.auth,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      'entity-type': 'user',
      id: scopedUsername,
      properties: {
        username: scopedUsername,
        password,
        email: userEmail,
        firstName,
        lastName,
        groups,
      },
    }),
  });

  if (!createRes.ok) {
    const errorText = await createRes.text();
    throw new Error(
      `Failed to create test user '${scopedUsername}': ${createRes.status} ${errorText}`,
    );
  }

  const nuxeoUser = (await createRes.json()) as NuxeoUser;

  // Generate Basic auth header for this user
  const auth = `Basic ${Buffer.from(`${scopedUsername}:${password}`).toString('base64')}`;

  console.log(`[user-fixtures] Created non-admin user: ${scopedUsername}`);

  return {
    username: scopedUsername,
    password,
    email: userEmail,
    firstName,
    lastName,
    auth,
    nuxeoUser,
  };
}

/**
 * Delete a test user from Nuxeo, and **throw** if it could not be deleted.
 *
 * Should be called in test cleanup to remove users created with `createNonAdminUser()`.
 *
 * A failure used to be a `console.warn`, so `afterEach` could not enforce the user-cleanup
 * criterion the plan records as met: an account left active on a shared instance reported
 * green. A caller that genuinely wants to tolerate that can `catch` — which is a decision
 * written at the call site, rather than one this helper makes for every caller silently.
 *
 * 404 is not a failure: the user is gone, which is the outcome asked for.
 *
 * The **read-back** is what makes this a verification rather than a request. Checking only the
 * `DELETE` response leaves the promise in the first line unkept: an endpoint that acknowledges
 * without applying leaves the account active and every RBAC teardown still reports green — the
 * same shape of false reassurance the `console.warn` had, one layer in. Reported on the pull
 * request. `deleteDataRoot` in the harness already re-reads for exactly this reason, and
 * `rbac.integration.spec.ts`'s dedicated deletion test already demonstrated the invariant on
 * one path; the shared cleanup helper every other path goes through did not enforce it.
 *
 * @param harness Integration test harness (provides nuxeoUrl, auth)
 * @param username Username to delete (the scoped username, not the base name)
 */
export async function deleteUser(
  harness: { nuxeoUrl: string; auth: string },
  username: string,
): Promise<void> {
  const url = `${harness.nuxeoUrl}/nuxeo/api/v1/user/${username}`;
  const deleteRes = await fetch(url, {
    method: 'DELETE',
    headers: {
      Authorization: harness.auth,
    },
  });

  if (!deleteRes.ok && deleteRes.status !== 404) {
    throw new Error(
      `[user-fixtures] Failed to delete test user '${username}': ${deleteRes.status} ` +
        `${await deleteRes.text()}\n` +
        `  The account may still be active on ${harness.nuxeoUrl}. Remove it before the next run.`,
    );
  }

  const confirmRes = await fetch(url, { headers: { Authorization: harness.auth } });
  if (confirmRes.status !== 404) {
    throw new Error(
      `[user-fixtures] Test user '${username}' is still readable after the DELETE ` +
        `(HTTP ${confirmRes.status}).\n` +
        `  Nuxeo answered the DELETE with ${deleteRes.status}, so the call was accepted and\n` +
        `  not applied. The account is still active on ${harness.nuxeoUrl}. Remove it before\n` +
        `  the next run.`,
    );
  }

  console.log(`[user-fixtures] Deleted test user: ${username} (confirmed absent)`);
}

/**
 * Grant ACL entry on a document to a user.
 *
 * @param harness Integration test harness
 * @param docId Document UID to grant permission on
 * @param username Username to grant permission to
 * @param permission Permission to grant (e.g., 'Read', 'ReadWrite', 'Everything')
 */
export async function grantPermission(
  harness: { nuxeoUrl: string; auth: string },
  docId: string,
  username: string,
  permission: string,
): Promise<void> {
  const res = await fetch(
    `${harness.nuxeoUrl}/nuxeo/api/v1/id/${docId}/@op/Document.AddPermission`,
    {
      method: 'POST',
      headers: {
        Authorization: harness.auth,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        params: {
          username,
          permission,
        },
      }),
    },
  );

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(
      `Failed to grant ${permission} to ${username} on ${docId}: ${res.status} ${errorText}`,
    );
  }

  console.log(`[user-fixtures] Granted ${permission} to ${username} on doc ${docId}`);
}

/**
 * Read every ACE on a document, local and inherited, as one flat list.
 *
 * The shape is the reason this exists. `GET /api/v1/id/<uid>/@acl` answers
 * `{ "entity-type": "acls", "acl": [ { "name": "local", "ace": [ … ] } ] }` — the entries are
 * under **`ace`**. Two places read `aclItem.aces`, which is never present, so both got an empty
 * list: `revokePermission` read `acl.entries` (also never present), found nothing to revoke and
 * returned successfully without revoking, and the ACL-reading test counted zero ACEs on a
 * document it had just granted a permission on. A helper that silently returns "nothing here"
 * for every document is worse than one that throws.
 */
export interface DocumentAce {
  id: string;
  username: string;
  permission: string;
  granted: boolean;
  /** The ACL the entry belongs to — `local` for an entry on the document, else inherited. */
  aclName: string;
}

export async function readAces(
  harness: { nuxeoUrl: string; auth: string },
  docId: string,
): Promise<DocumentAce[]> {
  const res = await fetch(`${harness.nuxeoUrl}/nuxeo/api/v1/id/${docId}/@acl`, {
    headers: { Authorization: harness.auth },
  });

  if (!res.ok) {
    throw new Error(`Failed to get ACL for ${docId}: ${res.status} ${await res.text()}`);
  }

  const body: any = await res.json();
  const acls: any[] = body.acl ?? [];

  return acls.flatMap((entry: any) =>
    ((entry.ace ?? entry.aces ?? []) as any[]).map((ace: any) => ({
      id: ace.id,
      username: ace.username,
      permission: ace.permission,
      granted: ace.granted,
      aclName: entry.name,
    })),
  );
}

/**
 * Stop a document inheriting its parents' ACLs, and throw if the server refused.
 *
 * **Not** `Document.SetACL` with `blockInheritance: true`. That is what the RBAC spec used, and
 * on this deployment it answers **HTTP 500** — the operation needs `user` and `permission`
 * parameters it was not given. The spec discarded the response, so the failure was invisible and
 * the document kept its inherited `members:Read` from the repository root; the assertion that
 * followed ("a non-admin cannot read it") then failed for a reason that looked like a product
 * bug. Measured 2026-09-23.
 *
 * `Document.BlockPermissionInheritance` is the operation that does the job: 200, and the
 * document's effective ACL becomes local-only with `Everyone:Everything:false` appended.
 */
export async function blockPermissionInheritance(
  harness: { nuxeoUrl: string; auth: string },
  docId: string,
): Promise<void> {
  const res = await fetch(
    `${harness.nuxeoUrl}/nuxeo/api/v1/id/${docId}/@op/Document.BlockPermissionInheritance`,
    {
      method: 'POST',
      headers: {
        Authorization: harness.auth,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ params: {} }),
    },
  );

  if (!res.ok) {
    throw new Error(
      `Failed to block permission inheritance on ${docId}: ${res.status} ${await res.text()}`,
    );
  }

  console.log(`[user-fixtures] Blocked permission inheritance on doc ${docId}`);
}

/**
 * Remove ACL entry from a document for a user.
 *
 * @param harness Integration test harness
 * @param docId Document UID to remove permission from
 * @param username Username to remove permission from
 */
export async function revokePermission(
  harness: { nuxeoUrl: string; auth: string },
  docId: string,
  username: string,
): Promise<void> {
  // Find the user's ACE. `readAces` reads the field the server actually sends; see its
  // docblock for what the previous `acl.entries` lookup did instead.
  const ace = (await readAces(harness, docId)).find((e) => e.username === username);
  if (!ace) {
    throw new Error(
      `[user-fixtures] No ACE for ${username} on ${docId}, so there is nothing to revoke.\n` +
        `  This used to log and return, which made a revocation that never happened look like\n` +
        `  one that did — grant the permission first, or do not call this.`,
    );
  }

  // Remove via Document.RemovePermission
  const removeRes = await fetch(
    `${harness.nuxeoUrl}/nuxeo/api/v1/id/${docId}/@op/Document.RemovePermission`,
    {
      method: 'POST',
      headers: {
        Authorization: harness.auth,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        params: {
          id: ace.id,
        },
      }),
    },
  );

  if (!removeRes.ok) {
    const errorText = await removeRes.text();
    throw new Error(
      `Failed to revoke permission from ${username} on ${docId}: ${removeRes.status} ${errorText}`,
    );
  }

  console.log(`[user-fixtures] Revoked permission from ${username} on doc ${docId}`);
}

/**
 * Turn an HTTP status into "the server denied this" or an error.
 *
 * `return res.ok` mapped **every** non-2xx to "permission denied": a 500 from a broken
 * server, a 401 from a fixture whose credentials never worked, and a 503 from a Nuxeo still
 * starting all read as a successful RBAC denial. So an `expect(await canRead(...)).toBe(false)`
 * passed hardest exactly when the server was least able to answer — the shape of vacuous pass
 * this library was written to remove.
 *
 * 403 and 404 are the two the permission model actually produces: forbidden, and "you cannot
 * see it, so it does not exist for you". Anything else is the environment, and it throws.
 */
function deniedOrThrow(res: Response, what: string): boolean {
  if (res.ok) return true;
  if (res.status === 403 || res.status === 404) return false;
  throw new Error(
    `[user-fixtures] ${what} answered ${res.status} ${res.statusText}. That is not a permission\n` +
      `  decision, so it cannot be reported as one — a denial and a broken server must not\n` +
      `  look the same to an RBAC assertion.`,
  );
}

/**
 * Check if a user can read a document.
 *
 * @param harness Integration test harness (only needs nuxeoUrl)
 * @param userAuth User's auth header (from TestUser.auth)
 * @param docId Document UID to check
 * @returns true if the read succeeded, false if the server forbade it; throws otherwise
 */
export async function canRead(
  harness: { nuxeoUrl: string },
  userAuth: string,
  docId: string,
): Promise<boolean> {
  const res = await fetch(`${harness.nuxeoUrl}/nuxeo/api/v1/id/${docId}`, {
    headers: {
      Authorization: userAuth,
    },
  });

  return deniedOrThrow(res, `read of ${docId}`);
}

/**
 * Check if a user can write to a document.
 *
 * Performs a property update as the user.
 *
 * @param harness Integration test harness (only needs nuxeoUrl)
 * @param userAuth User's auth header (from TestUser.auth)
 * @param docId Document UID to check
 * @returns true if the write succeeded, false if the server forbade it; throws otherwise
 */
export async function canWrite(
  harness: { nuxeoUrl: string },
  userAuth: string,
  docId: string,
): Promise<boolean> {
  // Try to update a property (dc:description)
  const res = await fetch(`${harness.nuxeoUrl}/nuxeo/api/v1/id/${docId}`, {
    method: 'PUT',
    headers: {
      Authorization: userAuth,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      'entity-type': 'document',
      properties: {
        'dc:description': `Test write check ${Date.now()}`,
      },
    }),
  });

  return deniedOrThrow(res, `write to ${docId}`);
}
