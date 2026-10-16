import type { Provider } from '@angular/core';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { of, throwError, type Observable } from 'rxjs';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { BrowseService, type NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';

import { NxsDocumentTreeComponent } from './document-tree.component';

function folder(uid: string, path: string, title: string, type = 'Folder'): NuxeoDocument {
  return {
    uid,
    title,
    type,
    path,
    lastModified: '',
    properties: {},
    facets: ['Folderish'],
  } as NuxeoDocument;
}

const ROOT = {
  uid: 'root',
  title: 'Root',
  type: 'Root',
  path: '/',
  lastModified: '',
  properties: {},
} as NuxeoDocument;
const DOMAINS = [
  folder('domain', '/default-domain', 'Domain', 'Domain'),
  folder('archive-domain', '/archive-domain', 'Archive domain', 'Domain'),
];
const CHILDREN: Record<string, NuxeoDocument[]> = {
  domain: [
    folder('workspaces', '/default-domain/workspaces', 'Workspaces', 'WorkspaceRoot'),
    folder('sections', '/default-domain/sections', 'Sections', 'SectionRoot'),
  ],
  workspaces: [
    folder('claims', '/default-domain/workspaces/claims', 'Claims', 'Workspace'),
    folder('legal', '/default-domain/workspaces/legal', 'Legal', 'Workspace'),
  ],
  claims: [folder('2026', '/default-domain/workspaces/claims/2026', '2026')],
};
const HOLD_FOLDERS = new Set(['domain', 'workspaces', 'claims']);

/** A repository answered from memory; `fail` names a folder whose folders fail with that status. */
function repository(fail?: { uid: string; status: number }, rootStatus?: number): Provider {
  return {
    provide: BrowseService,
    useValue: {
      getNavTreeBootstrap: (): Observable<unknown> =>
        rootStatus
          ? throwError(() => ({ status: rootStatus }))
          : of({ root: ROOT, entries: DOMAINS }),
      getNavTreeChildren: (doc: NuxeoDocument): Observable<unknown> =>
        fail?.uid === doc.uid
          ? throwError(() => ({ status: fail.status }))
          : of({ entries: CHILDREN[doc.uid] ?? [] }),
      getFolderIdsWithSubfolders: (uids: readonly string[]) =>
        of(new Set(uids.filter((uid) => HOLD_FOLDERS.has(uid)))),
    },
  };
}

/**
 * The repository's folders, expanded down to the folder on screen, which is marked as the current
 * page. These stories answer from memory instead of Nuxeo; choosing a folder only records it.
 */
const meta: Meta<NxsDocumentTreeComponent> = {
  title: 'Navigation/Document tree',
  component: NxsDocumentTreeComponent,
  tags: ['autodocs'],
  decorators: [applicationConfig({ providers: [repository()] })],
  parameters: { layout: 'padded' },
  args: { label: 'Folders', currentPath: '/', navigate: fn() },
  argTypes: {
    label: {
      control: 'text',
      description: 'The tree’s accessible name, already translated. Required.',
    },
    currentPath: {
      control: 'select',
      options: [
        '/',
        '/default-domain',
        '/default-domain/workspaces',
        '/default-domain/workspaces/claims',
      ],
      description: 'The folder on screen: the tree expands to it and marks it.',
    },
    navigate: { control: false, description: 'The folder chosen. The root arrives with path "/".' },
  },
  render: (args) => ({
    props: args,
    template: `<div style="width: 280px"><nxs-document-tree [label]="label" [currentPath]="currentPath" (navigate)="navigate($event)" /></div>`,
  }),
};

export default meta;

type Story = StoryObj<NxsDocumentTreeComponent>;

/** At the repository root: the root and its domains, the root marked. */
export const AtTheRoot: Story = {};

/** Inside a domain: that domain's branch, expanded to Claims, which is marked as the current page. */
export const InsideADomain: Story = {
  args: { currentPath: '/default-domain/workspaces/claims' },
};

/** From the keyboard: Down to Legal, Enter opens it. */
export const FromTheKeyboard: Story = {
  args: { currentPath: '/default-domain/workspaces/claims' },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const current = await canvas.findByRole('treeitem', { current: 'page' });
    current.focus();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    const legal = canvas.getByText('Legal').closest('[role="treeitem"]');
    await waitFor(() => expect(legal).toHaveFocus());
    await userEvent.keyboard('{Enter}');
    await expect(args.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/default-domain/workspaces/legal' }),
    );
  },
};

/** A folder whose folders the server failed to list: a row says so, and activating it retries. */
export const AFolderThatFailed: Story = {
  args: { currentPath: '/default-domain/workspaces' },
  decorators: [applicationConfig({ providers: [repository({ uid: 'workspaces', status: 500 })] })],
};

/** The tree itself refused: it says the user has no access, and offers no Retry. */
export const TreeRefused: Story = {
  decorators: [applicationConfig({ providers: [repository(undefined, 403)] })],
};
