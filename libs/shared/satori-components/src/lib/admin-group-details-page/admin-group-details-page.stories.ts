import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { of } from 'rxjs';
import { expect, within } from 'storybook/test';

import {
  DocumentDetailService,
  PrincipalPermissionsService,
  UserService,
  type NuxeoGroup,
} from '@nuxeo/satori-platform/nuxeo-client';

import { NxsAdminGroupDetailsPageComponent } from './admin-group-details-page.component';

const GROUP = {
  groupname: 'editors',
  grouplabel: 'Editors',
  memberUsers: ['jdoe', 'asmith'],
  memberGroups: ['reviewers'],
} as unknown as NuxeoGroup;

const PAGE = {
  rows: [
    {
      documentUid: 'doc-1',
      documentTitle: 'Claims',
      documentPath: '/Claims',
      permission: 'Write',
      acePrincipal: 'editors',
      grantedBy: 'admin',
    },
  ],
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
          getGroup: () => of(GROUP),
          updateGroup: () => of({}),
          deleteGroup: () => of({}),
        },
      },
      {
        provide: PrincipalPermissionsService,
        useValue: { listLocalPermissionRows: () => of(PAGE) },
      },
      { provide: DocumentDetailService, useValue: { removePermission: () => of({}) } },
    ],
  });

const meta: Meta<NxsAdminGroupDetailsPageComponent> = {
  title: 'Pages/Group details',
  component: NxsAdminGroupDetailsPageComponent,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      api: { types: [] },
      source: {
        language: 'html',
        code: `<nxs-admin-group-details-page
  [groupId]="groupName"
  [deleted]="backToList"
  [userChosen]="openUser"
  [groupChosen]="openGroup"
  [documentChosen]="openDocument"
  (documentOpened)="router.navigate(['/doc', $event])"
/>`,
      },
    },
  },
  args: { groupId: 'editors' },
  decorators: [withServices()],
};

export default meta;

type Story = StoryObj<NxsAdminGroupDetailsPageComponent>;

/** A group with two members, one nested group and a permission. */
export const Profile: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole('heading', { name: 'Editors', level: 1 }),
    ).toBeInTheDocument();
  },
};
