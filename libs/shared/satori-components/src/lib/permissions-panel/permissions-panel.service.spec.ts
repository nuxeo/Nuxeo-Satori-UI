import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentDetailService, type NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';

import type { NxsAceRow, NxsPermissionChange } from './permissions-model';
import { NxsPermissionsService } from './permissions-panel.service';

type Ace = { username: string; permission: string; id?: string; granted?: boolean };

function serverDoc(local: Ace[]): NuxeoDocument {
  return {
    uid: 'doc-1',
    title: 'Doc',
    type: 'Folder',
    path: '/d',
    lastModified: '2026-10-01T00:00:00.000Z',
    properties: {},
    contextParameters: {
      permissions: ['Everything', 'Read', 'ReadWrite', 'Write', 'AddChildren', 'Unlock'],
      userVisiblePermissions: ['Read', 'ReadWrite', 'Everything'],
      acls: [
        {
          name: 'local',
          aces: local.map((a) => ({
            id: a.id ?? `${a.username}:${a.permission}:true:Administrator::`,
            username: a.username,
            permission: a.permission,
            granted: a.granted ?? true,
            externalUser: false,
            creator: 'Administrator',
            begin: null,
            end: null,
            status: 'effective',
          })),
        },
      ],
    },
  } as NuxeoDocument;
}

const target = (principal: string, permission: string): NxsAceRow => ({
  id: `${principal}:${permission}:true:Administrator::`,
  principal,
  principalLabel: '',
  permission,
  granted: true,
  begin: null,
  end: null,
  status: 'effective',
  creator: 'Administrator',
  acl: 'local',
});

describe('NxsPermissionsService', () => {
  let documents: {
    getDocumentPermissions: ReturnType<typeof vi.fn>;
    addPermission: ReturnType<typeof vi.fn>;
    replacePermission: ReturnType<typeof vi.fn>;
    removePermissionById: ReturnType<typeof vi.fn>;
    removeAcl: ReturnType<typeof vi.fn>;
    blockPermissionInheritance: ReturnType<typeof vi.fn>;
    unblockPermissionInheritance: ReturnType<typeof vi.fn>;
    searchUsersGroups: ReturnType<typeof vi.fn>;
  };
  let service: NxsPermissionsService;

  beforeEach(() => {
    documents = {
      getDocumentPermissions: vi.fn(),
      addPermission: vi.fn(() => of({})),
      replacePermission: vi.fn(() => of({})),
      removePermissionById: vi.fn(() => of({})),
      removeAcl: vi.fn(() => of({})),
      blockPermissionInheritance: vi.fn(() => of({})),
      unblockPermissionInheritance: vi.fn(() => of({})),
      searchUsersGroups: vi.fn(() => of([{ id: 'jdoe' }])),
    };
    TestBed.configureTestingModule({
      providers: [NxsPermissionsService, { provide: DocumentDetailService, useValue: documents }],
    });
    service = TestBed.inject(NxsPermissionsService);
  });

  it('loads a snapshot through DocumentDetailService.getDocumentPermissions', async () => {
    documents.getDocumentPermissions.mockReturnValue(
      of(serverDoc([{ username: 'members', permission: 'ReadWrite' }])),
    );
    const snapshot = await firstValueFrom(service.load('doc-1'));
    expect(documents.getDocumentPermissions).toHaveBeenCalledWith('doc-1');
    expect(snapshot.local.map((r) => r.principal)).toEqual(['members']);
  });

  it('propagates a load failure for the panel to classify', async () => {
    documents.getDocumentPermissions.mockReturnValue(throwError(() => ({ status: 500 })));
    await expect(firstValueFrom(service.load('doc-1'))).rejects.toEqual({ status: 500 });
  });

  it('writes one ACE per change, never clearing the ACL, and confirms each', async () => {
    const before = serverDoc([
      { username: 'parity-user', permission: 'AddChildren' },
      { username: 'members', permission: 'ReadWrite' },
      { username: 'old', permission: 'Write' },
    ]);
    const after = serverDoc([
      { username: 'parity-user', permission: 'AddChildren' },
      { username: 'members', permission: 'Everything' },
      { username: 'jdoe', permission: 'Unlock' },
    ]);
    documents.getDocumentPermissions.mockReturnValueOnce(of(before)).mockReturnValueOnce(of(after));
    const changes: NxsPermissionChange[] = [
      {
        kind: 'replace',
        target: target('members', 'ReadWrite'),
        permission: 'Everything',
        begin: null,
        end: null,
      },
      { kind: 'add', key: 'a', principal: 'jdoe', permission: 'Unlock', begin: null, end: null },
      { kind: 'remove', target: target('old', 'Write') },
    ];

    const outcome = await firstValueFrom(service.save('doc-1', changes));

    expect(outcome).toMatchObject({ kind: 'saved', count: 3 });
    expect(documents.removeAcl).not.toHaveBeenCalled();
    expect(documents.replacePermission).toHaveBeenCalledWith('doc-1', {
      id: 'members:ReadWrite:true:Administrator::',
      username: 'members',
      permission: 'Everything',
      begin: null,
      end: null,
      notify: false,
    });
    expect(documents.addPermission).toHaveBeenCalledWith('doc-1', {
      username: 'jdoe',
      permission: 'Unlock',
      begin: null,
      end: null,
      notify: false,
    });
    expect(documents.removePermissionById).toHaveBeenCalledWith(
      'doc-1',
      'old:Write:true:Administrator::',
    );
  });

  it('refuses the whole batch, writing nothing, when the fresh read shows a stale target', async () => {
    documents.getDocumentPermissions.mockReturnValue(
      of(serverDoc([{ username: 'members', permission: 'Everything' }])),
    );
    const outcome = await firstValueFrom(
      service.save('doc-1', [
        { kind: 'add', key: 'a', principal: 'jdoe', permission: 'Read', begin: null, end: null },
        { kind: 'remove', target: target('members', 'ReadWrite') },
      ]),
    );
    expect(outcome).toMatchObject({
      kind: 'refused',
      refusals: [{ principal: 'members', permission: 'ReadWrite', reason: 'changed-on-server' }],
    });
    expect(documents.addPermission).not.toHaveBeenCalled();
    expect(documents.removePermissionById).not.toHaveBeenCalled();
  });

  it('stops at the first server refusal and reports what was applied', async () => {
    documents.getDocumentPermissions
      .mockReturnValueOnce(of(serverDoc([])))
      .mockReturnValueOnce(of(serverDoc([{ username: 'jdoe', permission: 'Read' }])));
    const denied = { status: 403, error: { message: "Privilege 'WriteSecurity' is not granted" } };
    documents.addPermission
      .mockReturnValueOnce(of({}))
      .mockReturnValueOnce(throwError(() => denied));
    const changes: NxsPermissionChange[] = [
      { kind: 'add', key: 'a', principal: 'jdoe', permission: 'Read', begin: null, end: null },
      { kind: 'add', key: 'b', principal: 'ann', permission: 'Write', begin: null, end: null },
      { kind: 'add', key: 'c', principal: 'bob', permission: 'Write', begin: null, end: null },
    ];

    const outcome = await firstValueFrom(service.save('doc-1', changes));

    expect(outcome).toMatchObject({
      kind: 'failed',
      applied: 1,
      unconfirmed: [],
      total: 3,
      error: denied,
    });
    expect(outcome.kind === 'failed' && outcome.change).toBe(changes[1]);
    expect(
      outcome.kind === 'failed' ? outcome.snapshot?.local.map((r) => r.principal) : null,
    ).toEqual(['jdoe']);
    expect(documents.addPermission).toHaveBeenCalledTimes(2);
  });

  it('reports an unknown state, not a clean one, when the re-read after a failure fails too', async () => {
    documents.getDocumentPermissions
      .mockReturnValueOnce(of(serverDoc([])))
      .mockReturnValueOnce(throwError(() => ({ status: 503 })));
    documents.addPermission.mockReturnValueOnce(throwError(() => ({ status: 400 })));
    const outcome = await firstValueFrom(
      service.save('doc-1', [
        { kind: 'add', key: 'a', principal: 'jdoe', permission: 'Read', begin: null, end: null },
      ]),
    );
    expect(outcome).toMatchObject({ kind: 'failed', applied: 0, snapshot: null });
  });

  it('counts only the earlier writes the re-read confirms, and names the rest', async () => {
    // Nuxeo answers 200 for a removal by an id it no longer holds, and does nothing.
    const unchanged = serverDoc([{ username: 'old', permission: 'Write' }]);
    documents.getDocumentPermissions
      .mockReturnValueOnce(of(unchanged))
      .mockReturnValueOnce(of(unchanged));
    const denied = { status: 403 };
    documents.addPermission.mockReturnValueOnce(throwError(() => denied));
    const changes: NxsPermissionChange[] = [
      { kind: 'remove', target: target('old', 'Write') },
      { kind: 'add', key: 'a', principal: 'jdoe', permission: 'Read', begin: null, end: null },
    ];

    const outcome = await firstValueFrom(service.save('doc-1', changes));

    expect(outcome).toMatchObject({
      kind: 'failed',
      applied: 0,
      unconfirmed: [{ principal: 'old', permission: 'Write', reason: 'not-applied' }],
      total: 2,
      error: denied,
    });
    expect(outcome.kind === 'failed' && outcome.change).toBe(changes[1]);
  });

  it('counts every 200 and names none when the re-read after a refusal fails', async () => {
    documents.getDocumentPermissions
      .mockReturnValueOnce(of(serverDoc([])))
      .mockReturnValueOnce(throwError(() => ({ status: 503 })));
    documents.addPermission
      .mockReturnValueOnce(of({}))
      .mockReturnValueOnce(throwError(() => ({ status: 400 })));
    const outcome = await firstValueFrom(
      service.save('doc-1', [
        { kind: 'add', key: 'a', principal: 'jdoe', permission: 'Read', begin: null, end: null },
        { kind: 'add', key: 'b', principal: 'ann', permission: 'Read', begin: null, end: null },
      ]),
    );
    expect(outcome).toMatchObject({ kind: 'failed', applied: 1, unconfirmed: [], snapshot: null });
  });

  it('reports a write the server answered and did not apply', async () => {
    const unchanged = serverDoc([{ username: 'members', permission: 'ReadWrite' }]);
    documents.getDocumentPermissions.mockReturnValue(of(unchanged));
    const outcome = await firstValueFrom(
      service.save('doc-1', [{ kind: 'remove', target: target('members', 'ReadWrite') }]),
    );
    expect(outcome).toMatchObject({
      kind: 'unconfirmed',
      refusals: [{ principal: 'members', permission: 'ReadWrite', reason: 'not-applied' }],
    });
  });

  it('reports writes it could not read back as unverified, not as saved', async () => {
    documents.getDocumentPermissions
      .mockReturnValueOnce(of(serverDoc([])))
      .mockReturnValueOnce(throwError(() => ({ status: 503 })));
    const outcome = await firstValueFrom(
      service.save('doc-1', [
        { kind: 'add', key: 'a', principal: 'jdoe', permission: 'Read', begin: null, end: null },
      ]),
    );
    expect(outcome).toMatchObject({ kind: 'unverified', count: 1, error: { status: 503 } });
    expect(documents.addPermission).toHaveBeenCalledTimes(1);
  });

  it('reports a failure of the read before the first write as unread, sending nothing', async () => {
    documents.getDocumentPermissions.mockReturnValue(throwError(() => ({ status: 500 })));
    const outcome = await firstValueFrom(
      service.save('doc-1', [{ kind: 'remove', target: target('a', 'Read') }]),
    );
    expect(outcome).toEqual({ kind: 'unread', error: { status: 500 } });
    expect(documents.removePermissionById).not.toHaveBeenCalled();
  });

  it('blocks and unblocks inheritance, then re-reads', async () => {
    documents.getDocumentPermissions.mockReturnValue(of(serverDoc([])));
    await firstValueFrom(service.setInheritanceBlocked('doc-1', true));
    expect(documents.blockPermissionInheritance).toHaveBeenCalledWith('doc-1');
    await firstValueFrom(service.setInheritanceBlocked('doc-1', false));
    expect(documents.unblockPermissionInheritance).toHaveBeenCalledWith('doc-1');
    expect(documents.getDocumentPermissions).toHaveBeenCalledTimes(2);
  });

  it('emits null, not an error, when inheritance changed but the re-read failed', async () => {
    documents.getDocumentPermissions.mockReturnValue(throwError(() => ({ status: 503 })));
    expect(await firstValueFrom(service.setInheritanceBlocked('doc-1', true))).toBeNull();
  });

  it('propagates a refused inheritance change', async () => {
    documents.blockPermissionInheritance.mockReturnValue(throwError(() => ({ status: 403 })));
    await expect(firstValueFrom(service.setInheritanceBlocked('doc-1', true))).rejects.toEqual({
      status: 403,
    });
  });

  it('searches users and groups through DocumentDetailService', async () => {
    expect(await firstValueFrom(service.searchPrincipals('jd'))).toEqual([{ id: 'jdoe' }]);
    expect(documents.searchUsersGroups).toHaveBeenCalledWith('jd');
  });
});
