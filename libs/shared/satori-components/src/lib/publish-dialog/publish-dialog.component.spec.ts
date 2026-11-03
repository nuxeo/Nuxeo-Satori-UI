import { HttpErrorResponse } from '@angular/common/http';
import { Component, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ExtensionComponentRegistry } from '@nuxeo/satori-platform/extensions';
import {
  DocumentDetailService,
  type NuxeoDocument,
  type NuxeoDocumentList,
} from '@nuxeo/satori-platform/nuxeo-client';
import { NEVER, of, Subject, throwError, type Observable } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NxsToastService } from '../toast/toast.service';
import {
  NXS_PUBLISH_DIALOG_ID,
  NxsPublishDialogComponent,
  nxsOpenPublishDialog,
  type NxsPublishDialogData,
} from './publish-dialog.component';

function doc(over: Partial<NuxeoDocument> = {}): NuxeoDocument {
  return {
    uid: 'doc-1',
    title: 'Doc',
    type: 'File',
    path: '/default-domain/workspaces/ws/doc',
    lastModified: '2026-08-01T00:00:00.000Z',
    properties: {},
    ...over,
  };
}

const section = (uid: string, path: string, title: string): NuxeoDocument =>
  doc({ uid, path, title, type: 'Section' });

const version = (uid: string, major: number, minor: number): NuxeoDocument =>
  doc({ uid, properties: { 'uid:major_version': major, 'uid:minor_version': minor } });

function list(entries: NuxeoDocument[]): NuxeoDocumentList {
  return {
    entries,
    totalSize: entries.length,
    resultsCount: entries.length,
    currentPageSize: entries.length,
    currentPageIndex: 0,
    numberOfPages: 1,
    isNextPageAvailable: false,
  };
}

/**
 * Two roots under different domains, a child and a grandchild — listed out of tree order, as the
 * server's `ORDER BY dc:title` returns them, so tree order has to come from the paths.
 */
const SECTIONS = [
  section('sec-2026', '/default-domain/sections/news/2026', '2026'),
  section('sec-news', '/default-domain/sections/news', 'News'),
  section('sec-other', '/other-domain/sections', 'Other Sections'),
  section('sec-root', '/default-domain/sections', 'Sections'),
];

const DATA: NxsPublishDialogData = {
  documentUid: 'doc-1',
  documentTitle: 'Quarterly report',
  versionLabel: '1.2',
  versionableUid: 'doc-live',
  renditions: [
    { name: 'pdf', label: 'PDF' },
    { name: 'thumbnail', label: 'Thumbnail' },
  ],
};

describe('NxsPublishDialogComponent', () => {
  let fixture: ComponentFixture<NxsPublishDialogComponent>;
  let documents: {
    getSectionTree: ReturnType<typeof vi.fn<() => Observable<NuxeoDocumentList>>>;
    getVersionsDirect: ReturnType<typeof vi.fn<(uid: string) => Observable<NuxeoDocument[]>>>;
    publishDocument: ReturnType<
      typeof vi.fn<
        (
          uid: string,
          target: string,
          options?: { override?: boolean; renditionName?: string; defaultRendition?: boolean },
        ) => Observable<NuxeoDocument>
      >
    >;
  };
  let ref: { close: ReturnType<typeof vi.fn>; disableClose: boolean };
  let shown: ReturnType<typeof vi.spyOn>;
  let failed: ReturnType<typeof vi.spyOn>;

  const el = (): HTMLElement => fixture.nativeElement;
  const component = (): NxsPublishDialogComponent => fixture.componentInstance;
  const publishButton = (): HTMLButtonElement =>
    el().querySelector('.nxs-publish-dialog__publish') as HTMLButtonElement;
  const settle = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  async function create(data: NxsPublishDialogData = DATA): Promise<void> {
    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: data });
    fixture = TestBed.createComponent(NxsPublishDialogComponent);
    await settle();
  }

  /** Open a mat-select by its class and choose the option whose text is `label`. */
  async function choose(selectClass: string, label: string): Promise<void> {
    (el().querySelector(`.${selectClass} .mat-mdc-select-trigger`) as HTMLElement).click();
    await settle();
    const option = [...document.querySelectorAll<HTMLElement>('mat-option')].find(
      (o) => o.textContent?.trim() === label,
    );
    if (!option) throw new Error(`no option "${label}"`);
    option.click();
    await settle();
  }

  function optionTexts(selectClass: string): string[] {
    (el().querySelector(`.${selectClass} .mat-mdc-select-trigger`) as HTMLElement).click();
    fixture.detectChanges();
    const texts = [...document.querySelectorAll('mat-option')].map((o) => o.textContent!.trim());
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    return texts;
  }

  beforeEach(async () => {
    documents = {
      getSectionTree: vi.fn(() => of(list(SECTIONS))),
      getVersionsDirect: vi.fn(() => of([version('v-1-0', 1, 0), version('v-1-1', 1, 1)])),
      publishDocument: vi.fn(() => of(doc({ uid: 'proxy-1', isProxy: true }))),
    };
    ref = { close: vi.fn(), disableClose: false };
    shown = vi.spyOn(NxsToastService.prototype, 'show').mockImplementation(() => undefined);
    failed = vi.spyOn(NxsToastService.prototype, 'error').mockImplementation(() => undefined);
    await TestBed.configureTestingModule({
      imports: [NxsPublishDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: DocumentDetailService, useValue: documents },
        { provide: MAT_DIALOG_DATA, useValue: DATA },
        { provide: MatDialogRef, useValue: ref },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.querySelectorAll('.cdk-overlay-container').forEach((c) => (c.innerHTML = ''));
  });

  it('names the document in the dialog title', async () => {
    await create();
    expect(el().querySelector('h2[mat-dialog-title]')?.textContent?.trim()).toBe(
      'Publish Quarterly report',
    );
  });

  describe('sections', () => {
    it('shows a named spinner until the sections arrive, with Publish disabled', async () => {
      documents.getSectionTree.mockReturnValue(NEVER);
      await create();
      expect(el().querySelector('nxs-spinner [aria-label]')?.getAttribute('aria-label')).toBe(
        'Loading the sections',
      );
      expect(el().querySelector('.nxs-publish-dialog__section')).toBeNull();
      expect(publishButton().disabled).toBe(true);
    });

    it('lists the sections in tree order, indented by depth', async () => {
      await create();
      // Roots keep the server's order; each child follows its parent, whatever the server's order.
      expect(optionTexts('nxs-publish-dialog__section')).toEqual([
        'Other Sections',
        'Sections',
        'News',
        '2026',
      ]);
      const indents = [
        ...document.querySelectorAll<HTMLElement>('.nxs-publish-dialog__section-title'),
      ].map((s) => s.style.paddingInlineStart);
      expect(indents).toEqual(['0px', '0px', '16px', '32px']);
    });

    it('says there is nowhere to publish when the server lists no section', async () => {
      documents.getSectionTree.mockReturnValue(of(list([])));
      await create();
      expect(el().querySelector('.nxs-publish-dialog__empty')?.textContent?.trim()).toBe(
        'There is no section to publish to.',
      );
      expect(el().querySelector('.nxs-publish-dialog__section')).toBeNull();
      expect(publishButton().disabled).toBe(true);
    });

    it('says the sections failed to load, stops loading, and reads them again on retry', async () => {
      documents.getSectionTree.mockReturnValueOnce(throwError(() => new Error('500')));
      await create();
      expect(el().querySelector('[role="alert"]')?.textContent?.trim()).toBe(
        'The sections could not be loaded.',
      );
      expect(el().querySelector('nxs-spinner')).toBeNull();
      expect(publishButton().disabled).toBe(true);

      (el().querySelector('.nxs-publish-dialog__retry') as HTMLButtonElement).click();
      await settle();

      expect(documents.getSectionTree).toHaveBeenCalledTimes(2);
      expect(el().querySelector('[role="alert"]')).toBeNull();
      expect(el().querySelector('.nxs-publish-dialog__section')).not.toBeNull();
    });
  });

  describe('versions', () => {
    it("offers the document as it is, then its live document's versions newest first", async () => {
      await create();
      expect(documents.getVersionsDirect).toHaveBeenCalledWith('doc-live');
      expect(optionTexts('nxs-publish-dialog__version')).toEqual(['1.2', '1.1', '1.0']);
    });

    it('reads the versions of the document itself when no live document is named', async () => {
      await create({ documentUid: 'doc-1', documentTitle: 'Doc' });
      expect(documents.getVersionsDirect).toHaveBeenCalledWith('doc-1');
    });

    it('does not list a version twice when the document published is that version', async () => {
      await create({ ...DATA, documentUid: 'v-1-1', versionLabel: '1.1' });
      expect(optionTexts('nxs-publish-dialog__version')).toEqual(['1.1', '1.0']);
    });

    it('calls the document "Current version" when it has no label', async () => {
      await create({ documentUid: 'doc-1', documentTitle: 'Doc' });
      expect(optionTexts('nxs-publish-dialog__version')[0]).toBe('Current version');
    });

    it('still offers the document itself when its versions cannot be read', async () => {
      documents.getVersionsDirect.mockReturnValue(throwError(() => new Error('500')));
      await create();
      expect(optionTexts('nxs-publish-dialog__version')).toEqual(['1.2']);
      expect(failed).not.toHaveBeenCalled();
    });
  });

  describe('publish', () => {
    beforeEach(async () => {
      await create();
      await choose('nxs-publish-dialog__section', 'News');
    });

    it('enables Publish once a section is chosen', async () => {
      expect(publishButton().disabled).toBe(false);
    });

    it('publishes the document as it is to the section, with no rendition and no override', () => {
      publishButton().click();
      expect(documents.publishDocument).toHaveBeenCalledWith('doc-1', 'sec-news', {
        override: false,
        renditionName: undefined,
        defaultRendition: false,
      });
    });

    it('publishes the version chosen rather than the document on screen', async () => {
      await choose('nxs-publish-dialog__version', '1.0');
      publishButton().click();
      expect(documents.publishDocument.mock.calls[0][0]).toBe('v-1-0');
    });

    it('forwards the override flag', async () => {
      (el().querySelector('.nxs-publish-dialog__override input') as HTMLInputElement).click();
      await settle();
      publishButton().click();
      expect(documents.publishDocument.mock.calls[0][2]?.override).toBe(true);
    });

    it('sends a named rendition once renditions are shown', async () => {
      expect(el().querySelector('.nxs-publish-dialog__rendition')).toBeNull();
      (
        el().querySelector('.nxs-publish-dialog__show-renditions input') as HTMLInputElement
      ).click();
      await settle();
      await choose('nxs-publish-dialog__rendition', 'PDF');
      publishButton().click();
      expect(documents.publishDocument.mock.calls[0][2]).toMatchObject({
        renditionName: 'pdf',
        defaultRendition: false,
      });
    });

    it('asks for the default rendition rather than a named one', async () => {
      (
        el().querySelector('.nxs-publish-dialog__show-renditions input') as HTMLInputElement
      ).click();
      await settle();
      expect(optionTexts('nxs-publish-dialog__rendition')).toEqual([
        'None',
        'Default rendition',
        'PDF',
        'Thumbnail',
      ]);
      await choose('nxs-publish-dialog__rendition', 'Default rendition');
      publishButton().click();
      expect(documents.publishDocument.mock.calls[0][2]).toMatchObject({
        renditionName: undefined,
        defaultRendition: true,
      });
    });

    it('ignores a rendition chosen and then hidden again', async () => {
      const toggle = (): void =>
        (
          el().querySelector('.nxs-publish-dialog__show-renditions input') as HTMLInputElement
        ).click();
      toggle();
      await settle();
      await choose('nxs-publish-dialog__rendition', 'PDF');
      toggle();
      await settle();
      publishButton().click();
      expect(documents.publishDocument.mock.calls[0][2]).toMatchObject({
        renditionName: undefined,
        defaultRendition: false,
      });
    });

    it('names the document and the section in a toast, and closes with the publication', () => {
      publishButton().click();
      expect(shown).toHaveBeenCalledWith('"Quarterly report" published to News');
      expect(ref.close).toHaveBeenCalledWith(expect.objectContaining({ uid: 'proxy-1' }));
    });

    it('shows progress and refuses a second publish while one is in flight', async () => {
      const pending = new Subject<NuxeoDocument>();
      documents.publishDocument.mockReturnValue(pending);
      publishButton().click();
      await settle();
      expect(publishButton().disabled).toBe(true);
      expect(publishButton().textContent?.trim()).toBe('Publishing');
      component()['publish']();
      expect(documents.publishDocument).toHaveBeenCalledTimes(1);
    });

    it('cannot be dismissed while publishing, so the outcome is never dropped', async () => {
      const pending = new Subject<NuxeoDocument>();
      documents.publishDocument.mockReturnValue(pending);
      const cancel = (): HTMLButtonElement =>
        el().querySelector('[mat-dialog-close]') as HTMLButtonElement;
      expect(cancel().disabled).toBe(false);

      publishButton().click();
      await settle();
      expect(ref.disableClose).toBe(true);
      expect(cancel().disabled).toBe(true);

      pending.next(doc({ uid: 'proxy-2' }));
      expect(ref.close).toHaveBeenCalledWith(expect.objectContaining({ uid: 'proxy-2' }));
    });

    it('can be dismissed again once a publish fails', async () => {
      documents.publishDocument.mockReturnValue(throwError(() => new Error('500')));
      publishButton().click();
      await settle();
      expect(ref.disableClose).toBe(false);
      expect((el().querySelector('[mat-dialog-close]') as HTMLButtonElement).disabled).toBe(false);
    });

    it('reads a refusal as one, re-enables Publish and stays open', async () => {
      documents.publishDocument.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 403 })),
      );
      publishButton().click();
      await settle();
      expect(failed).toHaveBeenCalledWith('You do not have permission to publish to this section.');
      expect(publishButton().disabled).toBe(false);
      expect(ref.close).not.toHaveBeenCalled();
    });

    it('reports any other failure, re-enables Publish and stays open', async () => {
      documents.publishDocument.mockReturnValue(throwError(() => new Error('500')));
      publishButton().click();
      await settle();
      expect(failed).toHaveBeenCalledWith('The document could not be published.');
      expect(publishButton().disabled).toBe(false);
      expect(ref.close).not.toHaveBeenCalled();
    });
  });

  it('keeps Publish disabled and refuses to publish with no section chosen', async () => {
    await create();
    expect(publishButton().disabled).toBe(true);
    component()['publish']();
    expect(documents.publishDocument).not.toHaveBeenCalled();
  });
});

describe('nxsOpenPublishDialog', () => {
  @Component({ selector: 'nxs-test-custom-publish', template: '' })
  class CustomPublishComponent {}

  const DATA_IN: NxsPublishDialogData = { documentUid: 'doc-1', documentTitle: 'Doc' };
  let dialog: { open: ReturnType<typeof vi.fn> };
  let registry: ExtensionComponentRegistry;

  beforeEach(() => {
    dialog = { open: vi.fn(() => ({ afterClosed: () => of(undefined) })) };
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), { provide: MatDialog, useValue: dialog }],
    });
    registry = TestBed.inject(ExtensionComponentRegistry);
  });

  it('opens the packaged dialog when nothing is registered under the ID', async () => {
    await nxsOpenPublishDialog(TestBed.inject(MatDialog), registry, DATA_IN);
    expect(dialog.open).toHaveBeenCalledWith(NxsPublishDialogComponent, {
      width: '600px',
      maxWidth: '95vw',
      data: DATA_IN,
    });
  });

  it('opens what a customer registered under the ID, with the same data', async () => {
    registry.register({ [NXS_PUBLISH_DIALOG_ID]: CustomPublishComponent });
    await nxsOpenPublishDialog(TestBed.inject(MatDialog), registry, DATA_IN);
    expect(dialog.open.mock.calls[0][0]).toBe(CustomPublishComponent);
    expect(dialog.open.mock.calls[0][1].data).toBe(DATA_IN);
  });

  it('loads a lazily registered replacement before opening it', async () => {
    registry.register({ [NXS_PUBLISH_DIALOG_ID]: () => Promise.resolve(CustomPublishComponent) });
    await nxsOpenPublishDialog(TestBed.inject(MatDialog), registry, DATA_IN);
    expect(dialog.open.mock.calls[0][0]).toBe(CustomPublishComponent);
  });

  it('falls back to the packaged dialog when a replacement fails to load', async () => {
    registry.register({ [NXS_PUBLISH_DIALOG_ID]: () => Promise.reject(new Error('chunk')) });
    await nxsOpenPublishDialog(TestBed.inject(MatDialog), registry, DATA_IN);
    expect(dialog.open.mock.calls[0][0]).toBe(NxsPublishDialogComponent);
  });

  it('opens nothing once the caller no longer wants it, as after navigating away', async () => {
    registry.register({ [NXS_PUBLISH_DIALOG_ID]: () => Promise.resolve(CustomPublishComponent) });
    let wanted = true;
    const opening = nxsOpenPublishDialog(TestBed.inject(MatDialog), registry, DATA_IN, {
      stillWanted: () => wanted,
    });
    wanted = false;
    expect(await opening).toBeUndefined();
    expect(dialog.open).not.toHaveBeenCalled();
  });

  it('is the ID the reference documents', () => {
    expect(NXS_PUBLISH_DIALOG_ID).toBe('nxs.components.publishDialog');
  });
});
