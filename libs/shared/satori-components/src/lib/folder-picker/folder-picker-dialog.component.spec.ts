import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BrowseService, type NuxeoDocument } from '@nuxeo-satori/platform/nuxeo-client';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';

import {
  NxsFolderPickerDialogComponent,
  type NxsFolderPickerDialogData,
} from './folder-picker-dialog.component';

function folder(path: string, title: string): NuxeoDocument {
  return {
    uid: path,
    title,
    type: 'Folder',
    path,
    lastModified: '',
    properties: {},
    facets: ['Folderish'],
  } as NuxeoDocument;
}

const TREE: Record<string, NuxeoDocument[]> = {
  '/default-domain/workspaces': [
    folder('/default-domain/workspaces/legal', 'Legal'),
    folder('/default-domain/workspaces/claims', 'Claims'),
    { ...folder('/default-domain/workspaces/readme', 'Readme'), type: 'File', facets: [] },
  ],
  '/default-domain/workspaces/claims': [folder('/default-domain/workspaces/claims/2026', '2026')],
  '/default-domain/workspaces/claims/2026': [],
  '/default-domain': [folder('/default-domain/workspaces', 'Workspaces')],
};

describe('NxsFolderPickerDialogComponent', () => {
  let fixture: ComponentFixture<NxsFolderPickerDialogComponent>;
  const close = vi.fn();
  let browse: { getByPath: ReturnType<typeof vi.fn>; getChildren: ReturnType<typeof vi.fn> };

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const folders = (): string[] =>
    [...el().querySelectorAll('.nxs-folder-picker-dialog__folder-title')].map(
      (node) => node.textContent?.trim() ?? '',
    );
  const choose = (): HTMLButtonElement =>
    [...el().querySelectorAll<HTMLButtonElement>('mat-dialog-actions button')].at(
      -1,
    ) as HTMLButtonElement;
  const up = (): HTMLButtonElement => el().querySelector('nav button') as HTMLButtonElement;
  const trail = (): string =>
    el().querySelector('.nxs-folder-picker-dialog__trail')?.textContent?.trim() ?? '';

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function create(data: Partial<NxsFolderPickerDialogData> = {}): Promise<void> {
    vi.clearAllMocks();
    browse = {
      getByPath: vi.fn((path: string) => of(folder(path, path.split('/').pop() ?? ''))),
      getChildren: vi.fn((path: string) => of({ entries: TREE[path] ?? [] })),
    };
    await TestBed.configureTestingModule({
      imports: [NxsFolderPickerDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MatDialogRef, useValue: { close } },
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            heading: 'Move "Claim 42" to',
            confirmLabel: 'Move here',
            initialPath: '/default-domain/workspaces',
            ...data,
          },
        },
        { provide: BrowseService, useValue: browse },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(NxsFolderPickerDialogComponent);
    await render();
  }

  it('lists the folders in the folder it opens on, sorted, and leaves out documents', async () => {
    await create();
    expect(el().querySelector('h2')?.textContent?.trim()).toBe('Move "Claim 42" to');
    expect(folders()).toEqual(['Claims', 'Legal']);
    expect(trail()).toBe('default-domain › workspaces');
    expect(choose().textContent?.trim()).toBe('Move here');
  });

  it('goes into a folder and back up, and chooses the folder on screen', async () => {
    await create();
    (el().querySelector('.nxs-folder-picker-dialog__folder') as HTMLButtonElement).click();
    await render();
    expect(trail()).toBe('default-domain › workspaces › claims');
    expect(folders()).toEqual(['2026']);
    choose().click();
    expect(close).toHaveBeenCalledWith({
      uid: '/default-domain/workspaces/claims',
      path: '/default-domain/workspaces/claims',
      title: 'claims',
    });

    up().click();
    await render();
    expect(folders()).toEqual(['Claims', 'Legal']);
  });

  it('says when a folder holds no folder, and still lets it be chosen', async () => {
    await create({ initialPath: '/default-domain/workspaces/claims/2026' });
    expect(el().querySelector('.nxs-folder-picker-dialog__empty')?.textContent?.trim()).toBe(
      'No folders here. You can choose this folder.',
    );
    expect(choose().disabled).toBe(false);
  });

  it('does not offer the folder being moved, nor any folder inside it', async () => {
    await create({ excludePath: '/default-domain/workspaces/claims' });
    expect(choose().disabled).toBe(false);
    (el().querySelector('.nxs-folder-picker-dialog__folder') as HTMLButtonElement).click();
    await render();
    expect(choose().disabled).toBe(true);
    expect(el().querySelector('.nxs-folder-picker-dialog__refusal')?.textContent?.trim()).toBe(
      'A folder cannot be moved into itself or into a folder inside it.',
    );
    (el().querySelector('.nxs-folder-picker-dialog__folder') as HTMLButtonElement).click();
    await render();
    expect(choose().disabled).toBe(true);
  });

  it('does not offer the folder the document is already in', async () => {
    await create({ currentParentPath: '/default-domain/workspaces' });
    expect(choose().disabled).toBe(true);
    expect(el().querySelector('.nxs-folder-picker-dialog__refusal')?.textContent?.trim()).toBe(
      'The document is already in this folder.',
    );
  });

  it('cannot go above the domain', async () => {
    await create({ initialPath: '/default-domain' });
    expect(up().disabled).toBe(true);
  });

  it.each([
    [403, 'You do not have access to this folder.'],
    [404, 'This folder no longer exists.'],
  ])('says why a %i folder cannot be opened, with nothing to choose', async (status, message) => {
    await create();
    browse.getByPath.mockReturnValueOnce(throwError(() => ({ status })));
    (el().querySelector('.nxs-folder-picker-dialog__folder') as HTMLButtonElement).click();
    await render();
    expect(el().querySelector('[role="alert"]')?.textContent?.trim()).toBe(message);
    expect(choose().disabled).toBe(true);
    expect(up().disabled).toBe(false);
  });

  it('offers Retry after a server failure, which loads the folder again', async () => {
    await create();
    browse.getChildren.mockReturnValueOnce(throwError(() => ({ status: 500 })));
    (el().querySelector('.nxs-folder-picker-dialog__folder') as HTMLButtonElement).click();
    await render();
    const retry = el().querySelector('[role="alert"] button') as HTMLButtonElement;
    expect(retry.textContent?.trim()).toBe('Retry');
    retry.click();
    await render();
    expect(folders()).toEqual(['2026']);
  });

  it('refuses a location that is not a folder', async () => {
    vi.clearAllMocks();
    await create();
    browse.getByPath.mockReturnValueOnce(
      of({ ...folder('/default-domain/workspaces/readme', 'Readme'), type: 'File', facets: [] }),
    );
    (el().querySelectorAll('.nxs-folder-picker-dialog__folder')[1] as HTMLButtonElement).click();
    await render();
    expect(el().querySelector('[role="alert"]')?.textContent?.trim()).toBe(
      'This is not a folder. Go up and choose a folder.',
    );
    expect(choose().disabled).toBe(true);
  });

  it('closes with nothing on Cancel', async () => {
    await create();
    (el().querySelector('mat-dialog-actions button') as HTMLButtonElement).click();
    expect(close).toHaveBeenCalledWith();
  });
});
