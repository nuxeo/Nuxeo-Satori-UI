import type { Provider } from '@angular/core';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { defer, NEVER, of, switchMap, throwError, timer, type Observable } from 'rxjs';
import { action } from 'storybook/actions';
import { expect, fn, waitFor, within } from 'storybook/test';

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
  /** How many reads fail with `readFails` before one succeeds; every one when unset. */
  readonly failedReads?: number;
  /** The HTTP status every write fails with, when set. */
  readonly writeFails?: number;
  /** Reads never answer, so the panel stays loading. */
  readonly readsHang?: boolean;
  /** How long every read and write takes to answer, in milliseconds. */
  readonly delay?: number;
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
  let reads = 0;
  // `timer`, not `delay`: `delay` holds back values but passes an error straight through.
  const answer = <T>(source: () => Observable<T>): Observable<T> =>
    fixture.delay ? timer(fixture.delay).pipe(switchMap(source)) : defer(source);
  const read = (uid: string): Observable<NuxeoDocument> =>
    answer(() => {
      if (fixture.readsHang) return NEVER;
      reads += 1;
      if (fixture.readFails && reads <= (fixture.failedReads ?? Infinity)) {
        return throwError(() => ({ status: fixture.readFails }));
      }
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
    answer(() => {
      if (fixture.writeFails) return throwError(() => ({ status: fixture.writeFails }));
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

/** The read has not answered: a spinner, in a `status` region, and no table yet. */
export const Loading: Story = {
  decorators: [withDocument({ ...SHARED, readsHang: true })],
  // `findBy`: the catalogue the spinner's name comes from is still loading when the play starts.
  play: async ({ canvas }) => {
    const spinner = await canvas.findByRole('progressbar', { name: 'Loading permissions' });
    await expect(canvas.getByRole('status')).toContainElement(spinner);
    await expect(canvas.queryByRole('table')).toBeNull();
  },
};

/** Nothing is set on the document itself; what it inherits is still listed. */
export const NoLocalEntries: Story = {
  name: 'No Local Entries',
  decorators: [withDocument({ ...SHARED, local: [] })],
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText('No permissions are set on this document itself.'),
    ).toBeVisible();
    await expect(canvas.getAllByRole('table')).toHaveLength(1);
  },
};

/**
 * The read failed for a reason other than permission, so the panel offers Retry. The next read
 * succeeds: select Retry to see the permissions load.
 */
export const ReadFailed: Story = {
  decorators: [withDocument({ ...SHARED, readFails: 500, failedReads: 1 })],
  play: async ({ canvas }) => {
    const alert = await canvas.findByRole('alert');
    await waitFor(() => expect(alert).toHaveTextContent('The permissions could not be loaded.'));
    await expect(canvas.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(canvas.queryByRole('table')).toBeNull();
  },
};

/**
 * The server refuses the write. The panel says which entry it was and how many changes were saved
 * before it, and keeps the refused change staged to save again.
 */
export const SaveFailed: Story = {
  decorators: [withDocument({ ...SHARED, writeFails: 500 })],
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole('button', { name: /^Remove .* for jdoe$/ }));
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }));
    const alert = await canvas.findByRole('alert');
    await expect(alert).toHaveTextContent('Saved 0 of 1 changes. The server refused the next one:');
    await expect(alert).toHaveTextContent('jdoe');
    await expect(alert).toHaveTextContent('HTTP 500');
    await expect(canvas.getByText('1 unsaved change')).toBeVisible();
    await expect(args.permissionsChanged).not.toHaveBeenCalled();
  },
};

/** Add without choosing a user or group: the form says so, and nothing is staged. */
export const InvalidEntry: Story = {
  decorators: [withDocument(SHARED)],
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Add' }));
    const form = await canvas.findByRole('form', { name: 'Add a permission' });
    await userEvent.click(within(form).getByRole('button', { name: 'Add' }));
    await expect(within(form).getByRole('alert')).toHaveTextContent(
      'Choose a user or group from the list.',
    );
    await expect(canvas.queryByText(/unsaved change/)).toBeNull();
  },
};

/**
 * Every read and write answers after a second and a half, so the spinner shows while the panel
 * loads, and Save stays disabled while it writes.
 */
export const SlowServer: Story = {
  decorators: [withDocument({ ...SHARED, delay: 1500 })],
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole('progressbar', { name: 'Loading permissions' }),
    ).toBeVisible();
    await waitFor(() => expect(canvas.getAllByRole('table')).toHaveLength(2), { timeout: 5000 });
  },
};
