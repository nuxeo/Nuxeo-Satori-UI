import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { of, throwError } from 'rxjs';
import { action } from 'storybook/actions';
import { expect, within } from 'storybook/test';

import { UserService, type NuxeoGroup, type NuxeoUser } from '@nuxeo/satori-platform/nuxeo-client';

import { NxsAdminUsersGroupsPageComponent } from './admin-users-groups-page.component';

const USERS = [
  {
    id: 'jdoe',
    properties: {
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jdoe@acme.test',
      groups: ['members'],
    },
  },
  {
    id: 'asmith',
    properties: { firstName: 'Alex', lastName: 'Smith', email: 'asmith@acme.test', groups: [] },
  },
] as unknown as NuxeoUser[];

const GROUPS = [
  { groupname: 'members', grouplabel: 'Members', memberUsers: ['jdoe', 'asmith'] },
  { groupname: 'editors', grouplabel: 'Editors', memberUsers: ['a', 'b', 'c', 'd'] },
] as unknown as NuxeoGroup[];

/** The page with a directory that answers from memory. `failUsers` makes the user list fail. */
const withDirectory = (failUsers = false) =>
  applicationConfig({
    providers: [
      {
        provide: UserService,
        useValue: {
          searchUsersPaged: () =>
            failUsers
              ? throwError(() => new Error('down'))
              : of({ 'entity-type': 'users', entries: USERS, totalSize: USERS.length }),
          searchGroupsPaged: () =>
            of({ 'entity-type': 'groups', entries: GROUPS, totalSize: GROUPS.length }),
          getRecentlyCreatedUsersAndGroups: () => of({ entries: [] }),
          deleteUser: (id: string) => {
            action('deleteUser')(id);
            return of({});
          },
          createUser: (body: unknown) => {
            action('createUser')(body);
            return of({});
          },
          updateUser: (...args: unknown[]) => {
            action('updateUser')(args);
            return of({});
          },
          createGroup: (body: unknown) => {
            action('createGroup')(body);
            return of({});
          },
          updateGroup: (...args: unknown[]) => {
            action('updateGroup')(args);
            return of({});
          },
          deleteGroup: (id: string) => {
            action('deleteGroup')(id);
            return of({});
          },
        },
      },
    ],
  });

const meta: Meta<NxsAdminUsersGroupsPageComponent> = {
  title: 'Pages/Users and groups',
  component: NxsAdminUsersGroupsPageComponent,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      api: { types: ['NxsRecentPrincipalRow'] },
      source: {
        language: 'html',
        code: `<nxs-admin-users-groups-page
  [userChosen]="openUser"
  [groupChosen]="openGroup"
/>`,
      },
    },
  },
};

export default meta;

type Story = StoryObj<NxsAdminUsersGroupsPageComponent>;

/** Both lists, with users on the first tab and the recently created table above. */
export const Populated: Story = {
  decorators: [withDirectory()],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('button', { name: 'jdoe' })).toBeInTheDocument();
  },
};

/** The user list fails to load: the tab says so in place of the table. */
export const LoadFailed: Story = {
  decorators: [withDirectory(true)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('alert')).toHaveTextContent('Could not load users.');
  },
};
