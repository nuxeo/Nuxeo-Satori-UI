import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';

import {
  NXS_PUBLISH_DIALOG_ID,
  NxsPublishDialogComponent,
} from '@nuxeo/satori-platform/components';
import { ExtensionComponentRegistry } from '@nuxeo/satori-platform/extensions';
import { SelectionService } from '@nuxeo/satori-platform/nuxeo-client';

import { BulkPublishActionService } from './bulk-action.services';

@Component({ selector: 'app-custom-publish-dialog', template: '' })
class CustomPublishDialogComponent {}

describe('BulkPublishActionService', () => {
  let selected: { id: string; name: string }[];
  let dialog: { open: jasmine.Spy };
  let snackBar: { open: jasmine.Spy };

  const settle = () => new Promise((resolve) => setTimeout(resolve));
  const lastOpen = () => dialog.open.calls.mostRecent().args as [unknown, { data: unknown }];

  beforeEach(() => {
    selected = [{ id: 'doc-1', name: 'Quarterly report' }];
    dialog = {
      open: jasmine.createSpy('open').and.returnValue({ afterClosed: () => of(undefined) }),
    };
    snackBar = { open: jasmine.createSpy('open') };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: SelectionService, useValue: { selectedItems: () => selected } },
        { provide: MatDialog, useValue: dialog },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: TranslateService, useValue: { instant: (key: string) => `t:${key}` } },
      ],
    });
  });

  it('opens the packaged publish dialog for the selected document, with translated renditions', async () => {
    TestBed.inject(BulkPublishActionService).execute();
    await settle();

    const [component, config] = lastOpen();
    expect(component).toBe(NxsPublishDialogComponent);
    expect(config.data).toEqual({
      documentUid: 'doc-1',
      documentTitle: 'Quarterly report',
      renditions: [
        { name: 'thumbnail', label: 't:rendition.thumbnail' },
        { name: 'pdf', label: 't:rendition.pdf' },
        { name: 'zipExport', label: 't:rendition.zip-export' },
        { name: 'xmlExport', label: 't:rendition.xml-export' },
      ],
    });
    expect(snackBar.open).not.toHaveBeenCalled();
  });

  it('opens what is registered under the publish dialog ID instead', async () => {
    TestBed.inject(ExtensionComponentRegistry).register({
      [NXS_PUBLISH_DIALOG_ID]: CustomPublishDialogComponent,
    });

    TestBed.inject(BulkPublishActionService).execute();
    await settle();

    expect(lastOpen()[0]).toBe(CustomPublishDialogComponent);
  });

  it('says it is publishing the first of several, and opens the dialog for that one', async () => {
    selected = [
      { id: 'doc-1', name: 'Quarterly report' },
      { id: 'doc-2', name: 'Annual report' },
    ];

    TestBed.inject(BulkPublishActionService).execute();
    await settle();

    expect(snackBar.open).toHaveBeenCalledWith(
      't:app.message.opening-publish-dialog-for-the-first-selected',
      't:common.dismiss',
      { duration: 3000 },
    );
    expect(lastOpen()[1].data).toEqual(jasmine.objectContaining({ documentUid: 'doc-1' }));
  });

  it('does nothing with an empty selection', async () => {
    selected = [];

    TestBed.inject(BulkPublishActionService).execute();
    await settle();

    expect(dialog.open).not.toHaveBeenCalled();
  });
});
