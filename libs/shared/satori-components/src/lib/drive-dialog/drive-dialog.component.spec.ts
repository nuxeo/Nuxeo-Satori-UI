import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog, type MatDialogRef } from '@angular/material/dialog';
import { type MockInstance } from 'vitest';
import {
  CURRENT_USERNAME,
  NUXEO_SERVER_URL,
  NuxeoDriveService,
} from '@nuxeo/satori-platform/nuxeo-client';

import { NxsDriveDialogComponent, type NxsDriveDialogData } from './drive-dialog.component';

const SERVER_URL = 'http://localhost:8080/nuxeo';

describe('NxsDriveDialogComponent', () => {
  let httpMock: HttpTestingController;
  let openDriveUrl: MockInstance<NuxeoDriveService['openDriveUrl']>;
  let ref: MatDialogRef<NxsDriveDialogComponent>;
  let close: MockInstance<MatDialogRef<NxsDriveDialogComponent>['close']>;

  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
  }

  async function open(data?: NxsDriveDialogData): Promise<void> {
    ref = TestBed.inject(MatDialog).open(NxsDriveDialogComponent, { data });
    close = vi.spyOn(ref, 'close');
    await settle();
  }

  async function answerTokenProbe(entries: unknown[]): Promise<void> {
    const req = httpMock.expectOne((r) => r.url.endsWith('/api/v1/token'));
    expect(req.request.params.get('application')).toBe('Nuxeo Drive');
    req.flush({ entries });
    await settle();
  }

  const overlay = (): HTMLElement =>
    document.querySelector('.cdk-overlay-container') as HTMLElement;

  /** The text of whatever names the dialog for assistive technology. */
  const dialogName = (): string | undefined => {
    const container = overlay().querySelector('mat-dialog-container') as HTMLElement;
    const labelledBy = container.getAttribute('aria-labelledby') ?? '';
    return labelledBy ? document.getElementById(labelledBy)?.textContent?.trim() : undefined;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        { provide: NUXEO_SERVER_URL, useValue: SERVER_URL },
        { provide: CURRENT_USERNAME, useValue: () => 'jdoe' },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    openDriveUrl = vi
      .spyOn(TestBed.inject(NuxeoDriveService), 'openDriveUrl')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    httpMock.verify();
    TestBed.inject(MatDialog).closeAll();
  });

  it('says it is checking, in a status region, while the token probe is in flight', async () => {
    await open({ folderPath: '/ws' });
    const status = overlay().querySelector('output.nxs-drive-dialog__checking');
    expect(status?.textContent?.trim()).toBe('Checking Nuxeo Drive...');
    expect(status?.querySelector('nxs-spinner')).not.toBeNull();
    await answerTokenProbe([]);
  });

  it('is a named dialog while the token probe is in flight, not an unnamed one', async () => {
    await open({ folderPath: '/ws' });
    expect(dialogName()).toBe('Nuxeo Drive');
    await answerTokenProbe([]);
  });

  it('launches Drive on the folder through direct-transfer, then closes, when a token exists', async () => {
    await open({ folderPath: '/default-domain/workspaces/ws' });
    await answerTokenProbe([{ id: 'token-1' }]);

    expect(openDriveUrl).toHaveBeenCalledWith(
      'nxdrive://direct-transfer/http/localhost:8080/nuxeo/default-domain/workspaces/ws',
    );
    expect(close).toHaveBeenCalledWith();
  });

  it('never puts a credential in the Drive URL', async () => {
    await open({ folderPath: '/default-domain/workspaces/ws' });
    await answerTokenProbe([{ id: 'token-1' }]);

    const [url] = openDriveUrl.mock.calls[0];
    expect(url).not.toContain('?');
    expect(url).not.toMatch(/password|passwd|token|secret|Basic /i);
  });

  it.each([
    ['no data', undefined],
    ['no folder', {}],
    ['a blank folder', { folderPath: '' }],
  ])('opens the repository root when given %s', async (_, data) => {
    await open(data);
    await answerTokenProbe([{ id: 'token-1' }]);
    expect(openDriveUrl).toHaveBeenCalledWith(
      'nxdrive://direct-transfer/http/localhost:8080/nuxeo/',
    );
  });

  it('offers the three installers, named by its heading, when Drive has no token', async () => {
    await open({ folderPath: '/ws' });
    await answerTokenProbe([]);

    expect(openDriveUrl).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    const links = [...overlay().querySelectorAll<HTMLAnchorElement>('a.nxs-drive-dialog__package')];
    expect(links.map((a) => a.textContent?.trim())).toEqual([
      'Nuxeo-Drive-X86_64.AppImage',
      'Nuxeo-Drive.Dmg',
      'Nuxeo-Drive.Exe',
    ]);
    for (const link of links) {
      expect(
        link.href.startsWith('https://community.nuxeo.com/static/drive-updates/release/'),
      ).toBe(true);
      expect(link.rel).toBe('noopener');
    }

    expect(dialogName()).toBe('Download Nuxeo Drive Client');
  });

  it('offers the installers when the token probe fails', async () => {
    await open({ folderPath: '/ws' });
    httpMock
      .expectOne((r) => r.url.endsWith('/api/v1/token'))
      .flush('boom', { status: 500, statusText: 'Server Error' });
    await settle();

    expect(openDriveUrl).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(overlay().querySelectorAll('a.nxs-drive-dialog__package')).toHaveLength(3);
  });

  it('closes without a result from its Close button', async () => {
    await open({ folderPath: '/ws' });
    await answerTokenProbe([]);

    (overlay().querySelector('.nxs-drive-dialog__close') as HTMLButtonElement).click();
    expect(close).toHaveBeenCalledWith();
  });
});
