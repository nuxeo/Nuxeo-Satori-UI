import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { of } from 'rxjs';
import { expect, within } from 'storybook/test';

import {
  DocumentDetailService,
  PrincipalPermissionsService,
  UserService,
  type NuxeoGroup,
  type NuxeoUser,
} from '@nuxeo/satori-platform/nuxeo-client';

import { NxsAdminUserDetailsPageComponent } from './admin-user-details-page.component';

const USER = {
  id: 'jdoe',
  properties: {
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jdoe@acme.test',
    company: 'Acme',
    groups: ['members'],
  },
} as unknown as NuxeoUser;

const GROUP = { groupname: 'members', grouplabel: 'Members' } as unknown as NuxeoGroup;

const PERMISSION = {
  documentUid: 'doc-1',
  documentTitle: 'Claims',
  documentPath: '/Claims',
  permission: 'Read',
  acePrincipal: 'jdoe',
  grantedBy: 'admin',
};

const PAGE = {
  rows: [PERMISSION],
  totalDocuments: 1,
  numberOfPages: 1,
  currentPageIndex: 0,
  currentPageSize: 10,
};

/** The page with a directory and permission service that answer from memory. */
const withServices = () =>
  applicationConfig({
    providers: [
      {
        provide: UserService,
        useValue: {
          getUser: () => of(USER),
          getGroup: () => of(GROUP),
          updateUser: () => of({}),
          deleteUser: () => of({}),
        },
      },
      {
        provide: PrincipalPermissionsService,
        useValue: { listLocalPermissionRows: () => of(PAGE) },
      },
      { provide: DocumentDetailService, useValue: { removePermission: () => of({}) } },
    ],
  });

const meta: Meta<NxsAdminUserDetailsPageComponent> = {
  title: 'Pages/User details',
  component: NxsAdminUserDetailsPageComponent,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      api: { types: [] },
      source: {
        language: 'html',
        code: `<nxs-admin-user-details-page
  [userId]="username"
  [deleted]="backToList"
  [groupChosen]="openGroup"
  [documentChosen]="openDocument"
  (documentOpened)="router.navigate(['/doc', $event])"
/>`,
      },
    },
  },
  args: { userId: 'jdoe' },
  decorators: [withServices()],
};

export default meta;

type Story = StoryObj<NxsAdminUserDetailsPageComponent>;

/** A user with one group and a direct permission; the actions are in the header. */
export const Profile: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole('heading', { name: 'jdoe', level: 1 }),
    ).toBeInTheDocument();
  },
};
