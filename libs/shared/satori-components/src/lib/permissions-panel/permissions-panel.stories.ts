import type { Provider } from '@angular/core';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { defer, of, throwError, type Observable } from 'rxjs';
import { action } from 'storybook/actions';
import { fn } from 'storybook/test';

import {
  DocumentDetailService,
  type NuxeoAce,
  type NuxeoAcl,
  type NuxeoDocument,
  type UserGroupSuggestion,
} from '@nuxeo-satori/platform/nuxeo-client';

import { NxsPermissionsPanelComponent } from './permissions-panel.component';

const ace = (username: string, permission: string, usernameLabel?: string): NuxeoAce => ({
  id: `${username}:${permission}:true:Administrator::`,
  username,
  ...(usernameLabel ? { usernameLabel } : {}),
  externalUser: false,
  permission,
  granted: true,
  creator: 'Administrator',
  begin: null,
  end: null,
  status: 'effective',
});

/** What `Document.BlockPermissionInheritance` writes into the local ACL. */
const BLOCK: NuxeoAce = {
  ...ace('Everyone', 'Everything'),
  id: 'Everyone:Everything:false:Administrator::',
  granted: false,
};

/**
 * The 33 permissions a stock 2025.26.16 server reports to an `Everything` holder, as
 * `permissions-model.spec.ts` records them. A list holding `Everything` is read as the server's
 * whole set, so a shorter one would hide permissions from the panel's select.
 */
const EVERYTHING = [
  'Write',
  'WriteVersion',
  'ReadProperties',
  'ReadCanCollect',
  'ReadSecurity',
  'Remove',
  'ReadVersion',
  'Read',
  'WriteLifeCycle',
  'Everything',
  'Moderate',
  'Version',
  'ManageLegalHold',
  'MakeRecord',
  'WriteColdStorage',
  'ReadChildren',
  'AddChildren',
  'Comment',
  'ReadLifeCycle',
  'RemoveChildren',
  'DataVisualization',
  'ReviewParticipant',
  'UnsetRetention',
  'Unlock',
  'CanAskForPublishing',
  'RestrictedRead',
  'ReadWrite',
  'ReadRemove',
  'Browse',
  'SetRetention',
  'WriteProperties',
  'WriteSecurity',
  'ManageWorkflows',
];

const PRINCIPALS: UserGroupSuggestion[] = [
  {
    id: 'jdoe',
    displayLabel: 'Jane Doe',
    type: 'USER_TYPE',
    prefixed_id: 'user:jdoe',
    username: 'jdoe',
  },
  {
    id: 'members',
    displayLabel: 'Members group',
    type: 'GROUP_TYPE',
    prefixed_id: 'group:members',
    groupname: 'members',
  },
];

interface Fixture {
  readonly local: readonly NuxeoAce[];
  readonly inherited: readonly NuxeoAce[];
  readonly permissions: readonly string[];
  /** The HTTP status every read fails with, when set. */
  readonly readFails?: number;
}

/**
 * `DocumentDetailService` over one document's ACL held in memory, so the panel reads, stages,
 * saves and blocks inheritance as it does against Nuxeo, with nothing sent anywhere.
 */
function inMemoryDocuments(
  fixture: Fixture,
): Pick<
  DocumentDetailService,
  | 'getDocumentPermissions'
  | 'addPermission'
  | 'replacePermission'
  | 'removePermissionById'
  | 'blockPermissionInheritance'
  | 'unblockPermissionInheritance'
  | 'searchUsersGroups'
> {
  let local = [...fixture.local];
  const read = (uid: string): Observable<NuxeoDocument> =>
    defer(() => {
      if (fixture.readFails) return throwError(() => ({ status: fixture.readFails }));
      const blocked = local.some((entry) => entry.id === BLOCK.id);
      const acls: NuxeoAcl[] = [{ name: 'local', aces: local }];
      if (!blocked) acls.push({ name: 'inherited', aces: [...fixture.inherited] });
      const doc: NuxeoDocument = {
        uid,
        title: 'Claims 2026',
        type: 'Folder',
        path: '/default-domain/workspaces/claims-2026',
        lastModified: '2026-10-01T00:00:00.000Z',
        properties: {},
        contextParameters: {
          acls,
          permissions: [...fixture.permissions],
          userVisiblePermissions: ['Read', 'ReadWrite', 'Everything'],
        },
      };
      return of(doc);
    });
  const written = (uid: string, change: () => void): Observable<NuxeoDocument> =>
    defer(() => {
      change();
      return read(uid);
    });
  const entry = (params: {
    username?: string;
    permission: string;
    begin?: string | null;
    end?: string | null;
  }): NuxeoAce => ({
    ...ace(params.username ?? '', params.permission),
    id: `${params.username}:${params.permission}:true:Administrator:${params.begin ?? ''}:${params.end ?? ''}`,
    begin: params.begin ?? null,
    end: params.end ?? null,
  });

  return {
    getDocumentPermissions: logged('getDocumentPermissions', read),
    addPermission: logged('addPermission', (uid, params) =>
      written(uid, () => (local = [...local, entry(params)])),
    ),
    replacePermission: logged('replacePermission', (uid, params) =>
      written(uid, () => (local = local.map((e) => (e.id === params.id ? entry(params) : e)))),
    ),
    removePermissionById: logged('removePermissionById', (uid, id) =>
      written(uid, () => (local = local.filter((e) => e.id !== id))),
    ),
    blockPermissionInheritance: logged('blockPermissionInheritance', (uid) =>
      written(uid, () => (local = [...local, BLOCK])),
    ),
    unblockPermissionInheritance: logged('unblockPermissionInheritance', (uid) =>
      written(uid, () => (local = local.filter((e) => e.id !== BLOCK.id))),
    ),
    searchUsersGroups: logged('searchUsersGroups', (term) =>
      of(PRINCIPALS.filter((p) => p.displayLabel.toLowerCase().includes(term.toLowerCase()))),
    ),
  };
}

/** Logs each call in the Actions panel under `name`, then lets the fake answer it. */
function logged<A extends unknown[], R>(
  name: string,
  method: (...args: A) => R,
): (...args: A) => R {
  return (...args) => {
    action(name)(...args);
    return method(...args);
  };
}

/** A factory, so each render starts from the declared ACL rather than the last render's edits. */
const documentsFor = (fixture: Fixture): Provider => ({
  provide: DocumentDetailService,
  useFactory: () => inMemoryDocuments(fixture),
});

/** The panel's chrome and permission names come from the application's catalogue (`preview.ts`). */
const withDocument = (fixture: Fixture) =>
  applicationConfig({ providers: [documentsFor(fixture)] });

const SHARED: Fixture = {
  local: [ace('jdoe', 'ReadWrite', 'Jane Doe'), ace('members', 'Read', 'Members group')],
  inherited: [ace('Administrator', 'Everything'), ace('members', 'Read', 'Members group')],
  permissions: EVERYTHING,
};

const meta: Meta<NxsPermissionsPanelComponent> = {
  title: 'Panels/Permissions panel',
  component: NxsPermissionsPanelComponent,
  tags: ['autodocs'],
  args: { documentId: 'claims-2026', permissionsChanged: fn() },
  argTypes: {
    documentId: { control: false },
    permissionsChanged: { control: false },
  },
  parameters: { layout: 'padded' },
  render: (args) => ({
    props: args,
    template: `<nxs-permissions-panel [documentId]="documentId" [permissionsChanged]="permissionsChanged" />`,
  }),
};

export default meta;

type Story = StoryObj<NxsPermissionsPanelComponent>;

/** A user holding `Everything`: local entries can be added, edited and removed. */
export const Manageable: Story = { decorators: [withDocument(SHARED)] };

/** Without `WriteSecurity` or `Everything` the same ACL is shown, and nothing offers to change it. */
export const ReadOnly: Story = {
  decorators: [withDocument({ ...SHARED, permissions: ['Read', 'ReadWrite', 'Write'] })],
};

/** Inheritance blocked: the local deny that Nuxeo writes is shown as a state, not as an entry. */
export const InheritanceBlocked: Story = {
  decorators: [withDocument({ ...SHARED, local: [...SHARED.local, BLOCK] })],
};

/** The read is refused: the panel says so rather than showing an empty ACL. */
export const AccessDenied: Story = { decorators: [withDocument({ ...SHARED, readFails: 403 })] };
