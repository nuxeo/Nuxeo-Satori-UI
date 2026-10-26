import {
  Component,
  provideZonelessChangeDetection,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { DocumentDetailService, type NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';
import { of, Subject, throwError, type Observable } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NxsCreateVersionDialogComponent } from '../create-version-dialog/create-version-dialog.component';
import { NxsManageVersionsComponent, nxsVersionLabel } from './manage-versions.component';

const LIVE = 'live-1';

function doc(
  overrides: Partial<NuxeoDocument> = {},
  version: [number, number] = [1, 2],
): NuxeoDocument {
  return {
    uid: LIVE,
    title: 'Contract',
    type: 'File',
    path: '/default-domain/workspaces/ws/Contract',
    facets: ['Versionable'],
    isCheckedOut: false,
    properties: {
      'uid:major_version': version[0],
      'uid:minor_version': version[1],
    },
    contextParameters: { permissions: ['Read', 'Write', 'WriteVersion'] },
    ...overrides,
  } as NuxeoDocument;
}

function versionOf(major: number, minor: number, who = 'jdoe'): NuxeoDocument {
  return doc(
    {
      uid: `v-${major}-${minor}`,
      isVersion: true,
      versionableId: LIVE,
      properties: {
        'uid:major_version': major,
        'uid:minor_version': minor,
        'dc:modified': new Date(Date.now() - 3 * 86_400_000).toISOString(),
        'dc:lastContributor': who,
      },
    },
    [major, minor],
  );
}

@Component({
  standalone: true,
  imports: [NxsManageVersionsComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <nxs-manage-versions
      [document]="document()"
      (versionSelected)="selected.push($event.uid)"
      (latestSelected)="latest = latest + 1"
      (versionCreated)="created.push($event.uid)"
    />
  `,
})
class HostComponent {
  readonly document = signal<NuxeoDocument>(doc());
  readonly selected: string[] = [];
  readonly created: string[] = [];
  latest = 0;
}

describe('NxsManageVersionsComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let documents: {
    getVersionsDirect: ReturnType<typeof vi.fn>;
    restoreVersion: ReturnType<typeof vi.fn>;
  };
  let dialog: { open: ReturnType<typeof vi.fn> };
  let dialogAnswer: NuxeoDocument | undefined;

  const el = (): HTMLElement => fixture.nativeElement;
  const trigger = (): HTMLButtonElement | null =>
    el().querySelector('.nxs-manage-versions__trigger');
  const items = (): HTMLButtonElement[] => [
    ...document.querySelectorAll<HTMLButtonElement>('.nxs-manage-versions__menu [mat-menu-item]'),
  ];
  /** The text a node gives assistive technology, minus what is hidden from it. */
  const nameOf = (node: Element | null): string => {
    const copy = node?.cloneNode(true) as Element;
    copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
    return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
  };
  const itemTexts = (): string[] => items().map(nameOf);
  const settle = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  async function render(document: NuxeoDocument): Promise<void> {
    host.document.set(document);
    await settle();
  }
  async function open(): Promise<void> {
    trigger()?.click();
    await settle();
  }

  beforeEach(async () => {
    documents = {
      getVersionsDirect: vi.fn((): Observable<NuxeoDocument[]> =>
        of([versionOf(1, 0), versionOf(1, 2), versionOf(1, 10), versionOf(0, 1)]),
      ),
      restoreVersion: vi.fn(),
    };
    dialogAnswer = undefined;
    dialog = { open: vi.fn(() => ({ afterClosed: () => of(dialogAnswer) })) };
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: DocumentDetailService, useValue: documents },
      ],
    })
      .overrideProvider(MatDialog, { useValue: dialog })
      .compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await settle();
  });

  afterEach(() => document.querySelectorAll('.cdk-overlay-container').forEach((n) => n.remove()));

  describe('the version number', () => {
    it('names the control "Version 1.2" and does not ask for the list until it opens', () => {
      expect(nameOf(trigger())).toBe('Version 1.2');
      expect(documents.getVersionsDirect).not.toHaveBeenCalled();
    });

    it('reads 1.2+ while the document is checked out, as Web UI', async () => {
      await render(doc({ isCheckedOut: true }));
      expect(nameOf(trigger())).toBe('Version 1.2+');
    });

    it('nxsVersionLabel never adds the + to a version', () => {
      expect(nxsVersionLabel(doc({ isCheckedOut: true }))).toBe('1.2+');
      expect(nxsVersionLabel({ ...versionOf(1, 2), isCheckedOut: true })).toBe('1.2');
    });
  });

  describe('the list', () => {
    it('lists the versions newest first by number, with when and by whom (no empty menu)', async () => {
      await open();
      expect(documents.getVersionsDirect).toHaveBeenCalledWith(LIVE);
      expect(itemTexts()).toEqual([
        '1.10 Modified 3 days ago by jdoe',
        '1.2 Modified 3 days ago by jdoe',
        '1.0 Modified 3 days ago by jdoe',
        '0.1 Modified 3 days ago by jdoe',
      ]);
    });

    it('opens a version the user chooses, and restores nothing', async () => {
      await open();
      items()[1].click();
      expect(host.selected).toEqual(['v-1-2']);
      expect(documents.restoreVersion).not.toHaveBeenCalled();
    });

    it('asks again each time it opens, so a version created meanwhile is listed', async () => {
      await open();
      document.querySelector<HTMLElement>('.cdk-overlay-backdrop')?.click();
      await settle();
      await open();
      expect(documents.getVersionsDirect).toHaveBeenCalledTimes(2);
    });

    it('says when there is nothing to list', async () => {
      documents.getVersionsDirect.mockReturnValue(of([]));
      await open();
      expect(document.querySelector('.nxs-manage-versions__menu')?.textContent).toContain(
        'No previous versions',
      );
    });

    it('says the list could not be read, and Retry asks again without closing', async () => {
      documents.getVersionsDirect.mockReturnValueOnce(throwError(() => ({ status: 500 })));
      await open();
      expect(
        document.querySelector('.nxs-manage-versions__menu [role="alert"]')?.textContent,
      ).toContain('The versions could not be loaded.');
      items()
        .find((item) => item.textContent?.includes('Retry'))
        ?.click();
      await settle();
      expect(documents.getVersionsDirect).toHaveBeenCalledTimes(2);
      expect(itemTexts()[0]).toContain('1.10');
    });
  });

  describe('on a version', () => {
    beforeEach(async () => {
      await render({
        ...versionOf(1, 2),
        contextParameters: { permissions: ['Read', 'Write', 'WriteVersion'] },
      });
      await open();
    });

    it('lists the live document’s versions and marks the one on screen', () => {
      expect(documents.getVersionsDirect).toHaveBeenCalledWith(LIVE);
      const shown = items().filter((item) => item.getAttribute('aria-checked') === 'true');
      expect(shown.map((item) => nameOf(item).split(' ')[0])).toEqual(['1.2']);
      expect(
        items().every(
          (item) =>
            item.getAttribute('role') !== 'menuitemradio' || item.hasAttribute('aria-checked'),
        ),
      ).toBe(true);
    });

    it('leads back to the latest version', () => {
      items()
        .find((item) => item.textContent?.includes('Latest version'))
        ?.click();
      expect(host.latest).toBe(1);
    });

    it('does nothing for the version already on screen', () => {
      items()
        .find((item) => item.getAttribute('aria-checked') === 'true')
        ?.click();
      expect(host.selected).toEqual([]);
    });

    it('offers no Create Version, though the enricher lists WriteVersion', () => {
      expect(itemTexts().some((text) => text.includes('Create Version'))).toBe(false);
    });
  });

  it('drops a list that answers for the document it moved away from', async () => {
    const late = new Subject<NuxeoDocument[]>();
    documents.getVersionsDirect.mockReturnValueOnce(late);
    await open();
    document.querySelector<HTMLElement>('.cdk-overlay-backdrop')?.click();
    await render(doc({ uid: 'other', title: 'Other' }));
    late.next([versionOf(9, 9)]);
    await settle();
    await open();
    expect(itemTexts().some((text) => text.startsWith('9.9'))).toBe(false);
  });

  describe('Create Version', () => {
    it('is the whole control on a versionable document with no version yet', async () => {
      await render(doc({}, [0, 0]));
      const create = el().querySelector<HTMLButtonElement>('button.nxs-manage-versions__create');
      expect(create?.textContent?.trim()).toBe('Create Version');
      expect(trigger()).toBeNull();
    });

    it('opens the dialog for this document and hands the host the version created', async () => {
      await render(doc({}, [0, 0]));
      dialogAnswer = versionOf(1, 0);
      el().querySelector<HTMLButtonElement>('button.nxs-manage-versions__create')?.click();
      expect(dialog.open).toHaveBeenCalledWith(
        NxsCreateVersionDialogComponent,
        expect.objectContaining({
          data: { documentUid: LIVE, documentTitle: 'Contract', major: 0, minor: 0 },
        }),
      );
      expect(host.created).toEqual(['v-1-0']);
    });

    it('emits nothing when the dialog is cancelled', async () => {
      await render(doc({}, [0, 0]));
      el().querySelector<HTMLButtonElement>('button.nxs-manage-versions__create')?.click();
      expect(host.created).toEqual([]);
    });

    it('reads "Unversioned" without WriteVersion, even with Write', async () => {
      await render(doc({ contextParameters: { permissions: ['Read', 'Write'] } }, [0, 0]));
      expect(el().querySelector('button')).toBeNull();
      expect(el().textContent?.trim()).toBe('Unversioned');
    });

    it('reads "Unversioned" on a document without the Versionable facet', async () => {
      await render(doc({ facets: [] }, [0, 0]));
      expect(el().textContent?.trim()).toBe('Unversioned');
    });

    it('reads "Unversioned" on a record', async () => {
      await render({ ...doc({}, [0, 0]), isRecord: true } as NuxeoDocument);
      expect(el().textContent?.trim()).toBe('Unversioned');
    });

    it('is in the list while the document is checked out', async () => {
      await render(doc({ isCheckedOut: true }));
      await open();
      expect(itemTexts()[0]).toBe('Create Version');
      items()[0].click();
      expect(dialog.open).toHaveBeenCalledTimes(1);
    });

    it('is not in the list while the document is checked in: there is nothing new to version', async () => {
      await open();
      expect(itemTexts().some((text) => text.includes('Create Version'))).toBe(false);
    });

    it('is not in the list of a checked-out document without WriteVersion', async () => {
      await render(
        doc({ isCheckedOut: true, contextParameters: { permissions: ['Read', 'Write'] } }),
      );
      await open();
      expect(itemTexts().some((text) => text.includes('Create Version'))).toBe(false);
    });
  });
});
