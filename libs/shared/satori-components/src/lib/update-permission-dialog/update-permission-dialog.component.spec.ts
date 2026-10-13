import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog, type MatDialogRef } from '@angular/material/dialog';
import { Subject, of, throwError, type Observable } from 'rxjs';
import { type MockInstance } from 'vitest';
import { DocumentDetailService, type NuxeoAce } from '@nuxeo-satori/platform/nuxeo-client';

import { NxsToastService } from '../toast/toast.service';
import {
  NxsUpdatePermissionDialogComponent,
  type NxsUpdatePermissionDialogData,
} from './update-permission-dialog.component';

/** An instant at local midnight, as Nuxeo holds an entry written from the user's own zone. */
const localMidnight = (year: number, month: number, date: number): string =>
  new Date(year, month - 1, date).toISOString();

const local = (overrides: Partial<NuxeoAce> = {}): NuxeoAce => ({
  id: 'jdoe:Read:true:Administrator::',
  username: 'jdoe',
  permission: 'Read',
  granted: true,
  externalUser: false,
  creator: 'Administrator',
  begin: null,
  end: null,
  status: 'effective',
  ...overrides,
});

const external = (overrides: Partial<NuxeoAce> = {}): NuxeoAce =>
  local({
    id: 'transient/ext@example.com:Read:true:Administrator::1927929600000',
    username: 'transient/ext@example.com',
    externalUser: true,
    end: localMidnight(2031, 2, 1),
    ...overrides,
  });

describe('NxsUpdatePermissionDialogComponent', () => {
  let replace: ReturnType<typeof vi.fn<(...args: unknown[]) => Observable<unknown>>>;
  let toastShow: MockInstance;
  let toastError: MockInstance;
  let ref: MatDialogRef<NxsUpdatePermissionDialogComponent, boolean>;
  let close: MockInstance;

  const overlay = (): HTMLElement =>
    document.querySelector('.cdk-overlay-container') as HTMLElement;
  const q = <T extends Element = HTMLElement>(selector: string): T =>
    overlay().querySelector(selector) as T;
  const dateBoxes = () =>
    [
      ...overlay().querySelectorAll('.nxs-update-permission-dialog__dates input'),
    ] as HTMLInputElement[];
  const update = () => q<HTMLButtonElement>('.nxs-update-permission-dialog__update');
  const radio = (value: string) => q<HTMLInputElement>(`mat-radio-button[value="${value}"] input`);
  const notifyBox = () => q<HTMLInputElement>('mat-checkbox input');
  const alerts = () =>
    [...overlay().querySelectorAll('[role="alert"]')].map((el) => el.textContent?.trim());
  const sent = () => replace.mock.calls[0][1] as Record<string, unknown>;

  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
  }

  async function open(ace: NuxeoAce, data: Partial<NxsUpdatePermissionDialogData> = {}) {
    ref = TestBed.inject(MatDialog).open(NxsUpdatePermissionDialogComponent, {
      data: { documentUid: 'doc-1', ace, ...data },
    });
    close = vi.spyOn(ref, 'close');
    await settle();
  }

  async function type(box: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
    box.value = value;
    box.dispatchEvent(new Event('input'));
    box.dispatchEvent(new Event('change'));
    await settle();
  }

  async function pick(label: string): Promise<void> {
    q<HTMLElement>('.mat-mdc-select-trigger').click();
    await settle();
    const option = [...document.querySelectorAll('mat-option')].find(
      (el) => el.textContent?.trim() === label,
    ) as HTMLElement;
    option.click();
    await settle();
  }

  async function offeredLabels(): Promise<string[]> {
    q<HTMLElement>('.mat-mdc-select-trigger').click();
    await settle();
    const labels = [...document.querySelectorAll('mat-option')].map(
      (option) => option.textContent?.trim() ?? '',
    );
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    return labels;
  }

  async function save(): Promise<void> {
    update().click();
    await settle();
  }

  beforeEach(() => {
    replace = vi.fn(() => of({ document: {}, notificationSent: false }));
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        {
          provide: DocumentDetailService,
          useValue: { replacePermissionWithNotification: replace },
        },
      ],
    });
    toastShow = vi.spyOn(NxsToastService.prototype, 'show').mockImplementation(() => undefined);
    toastError = vi.spyOn(NxsToastService.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
    vi.restoreAllMocks();
  });

  it('is named by its title and says whose entry it changes', async () => {
    await open(external());

    const container = q('mat-dialog-container');
    const title = document.getElementById(container.getAttribute('aria-labelledby') ?? '');
    expect(title?.textContent?.trim()).toBe('Update permission');
    expect(q('.nxs-update-permission-dialog__principal').textContent?.trim()).toBe(
      'For ext@example.com',
    );
  });

  it('offers the type’s rights, keeping the entry’s own when the type does not list it', async () => {
    await open(local({ permission: 'WriteVersion' }), { permissions: ['Read', 'ReadWrite'] });

    expect(await offeredLabels()).toEqual(['Read', 'Edit', 'Write versions']);
  });

  describe('a local entry', () => {
    it('opens permanent, with the dates off and no notification', async () => {
      await open(local());

      expect(radio('permanent').checked).toBe(true);
      expect(dateBoxes().every((box) => box.disabled)).toBe(true);
      expect(notifyBox().checked).toBe(false);
      expect(overlay().querySelector('textarea')).toBeNull();
    });

    it('replaces the entry in one call, keeping it permanent', async () => {
      await open(local());
      await pick('Edit');

      await save();

      expect(replace).toHaveBeenCalledWith('doc-1', {
        id: 'jdoe:Read:true:Administrator::',
        username: 'jdoe',
        permission: 'ReadWrite',
        begin: null,
        end: null,
        notify: false,
        comment: null,
      });
      expect(toastShow).toHaveBeenCalledWith('Permission updated', { duration: 7000 });
      expect(close).toHaveBeenCalledWith(true);
    });

    it('writes back the instants Nuxeo holds when only the right changed', async () => {
      const begin = localMidnight(2030, 1, 2);
      const end = localMidnight(2030, 3, 4);
      await open(local({ begin, end }));
      expect(radio('dated').checked).toBe(true);
      await pick('Edit');

      await save();

      expect(sent()).toMatchObject({ permission: 'ReadWrite', begin, end });
    });

    it('writes a changed date as the day picked', async () => {
      const begin = localMidnight(2030, 1, 2);
      await open(local({ begin, end: localMidnight(2030, 3, 4) }));

      await type(dateBoxes()[1], '4/30/2030');
      await save();

      expect(sent()).toMatchObject({ begin, end: '2030-04-30' });
    });

    it('makes a dated entry permanent when the user says so', async () => {
      await open(local({ begin: localMidnight(2030, 1, 2) }));

      radio('permanent').click();
      await settle();
      await save();

      expect(dateBoxes().every((box) => box.disabled)).toBe(true);
      expect(sent()).toMatchObject({ begin: null, end: null });
    });

    it('dates a permanent entry once the user picks Date-based', async () => {
      await open(local());

      radio('dated').click();
      await settle();
      expect(dateBoxes().every((box) => !box.disabled)).toBe(true);
      await type(dateBoxes()[0], '1/2/2030');
      await save();

      expect(sent()).toMatchObject({ begin: '2030-01-02', end: null });
    });

    it('refuses an end date before the start date', async () => {
      await open(local({ begin: localMidnight(2030, 2, 1) }));

      await type(dateBoxes()[1], '1/1/2030');

      expect(alerts()).toEqual(['The end date is before the start date.']);
      expect(update().disabled).toBe(true);
    });

    it('notifies with a trimmed message when asked, and says it did', async () => {
      replace.mockReturnValue(of({ document: {}, notificationSent: true }));
      await open(local());

      notifyBox().click();
      await settle();
      await type(overlay().querySelector('textarea') as HTMLTextAreaElement, '  See this  ');
      await save();

      expect(sent()).toMatchObject({ notify: true, comment: 'See this' });
      expect(toastShow).toHaveBeenCalledWith('Permission updated and notification sent', {
        duration: 7000,
      });
    });
  });

  describe('an external user’s share', () => {
    it('keeps its dates on, and always notifies, without offering either choice', async () => {
      await open(external());

      expect(overlay().querySelector('mat-radio-group')).toBeNull();
      expect(overlay().querySelector('mat-checkbox')).toBeNull();
      expect(dateBoxes().every((box) => !box.disabled)).toBe(true);
      expect(dateBoxes()[1].required).toBe(true);
      expect(overlay().querySelector('textarea')).not.toBeNull();
    });

    it('cannot lose its end date', async () => {
      await open(external());

      await type(dateBoxes()[1], '');

      expect(update().disabled).toBe(true);
    });

    it('is replaced in place, with a notification, its unchanged end kept', async () => {
      const end = localMidnight(2031, 2, 1);
      await open(external({ end }));
      await pick('Edit');

      await save();

      expect(replace).toHaveBeenCalledWith('doc-1', {
        id: 'transient/ext@example.com:Read:true:Administrator::1927929600000',
        username: 'transient/ext@example.com',
        permission: 'ReadWrite',
        begin: null,
        end,
        notify: true,
        comment: null,
      });
    });

    it('shows why Nuxeo could not send the notification, when it says', async () => {
      replace.mockReturnValue(
        of({
          document: {},
          notificationSent: false,
          notificationErrorKey: 'permissions.notification.mail-hint',
        }),
      );
      await open(external());

      await save();

      expect(toastShow).toHaveBeenCalledWith(
        'Requires outbound mail (SMTP) configured on the Nuxeo server.',
        { duration: 7000 },
      );
    });
  });

  it('names the progress and saves once while it is saving', async () => {
    const pending = new Subject<unknown>();
    replace.mockReturnValue(pending);
    await open(local());

    update().click();
    update().click();
    await settle();

    expect(replace).toHaveBeenCalledTimes(1);
    expect(update().querySelector('mat-progress-spinner')?.getAttribute('aria-label')).toBe(
      'Updating the permission',
    );
    expect(q<HTMLButtonElement>('[mat-dialog-close]').disabled).toBe(true);
    pending.complete();
  });

  it('says a refusal is a refusal, and stays open', async () => {
    replace.mockReturnValue(throwError(() => ({ status: 403 })));
    await open(local());

    await save();

    expect(toastError).toHaveBeenCalledWith(
      "You don't have permission to change permissions on this document.",
      { duration: 7000 },
    );
    expect(close).not.toHaveBeenCalled();
    expect(update().disabled).toBe(false);
  });

  it('points at the mail server when Nuxeo could not send the notification', async () => {
    replace.mockReturnValue(
      throwError(() => ({ error: { message: 'Error while sending a mail' } })),
    );
    await open(external());

    await save();

    expect(toastError).toHaveBeenCalledWith(
      'Permission could not be updated. Configure outbound mail (SMTP) on the Nuxeo server.',
      { duration: 7000 },
    );
  });

  it('reports any other failure as one', async () => {
    replace.mockReturnValue(throwError(() => ({ status: 500 })));
    await open(local());

    await save();

    expect(toastError).toHaveBeenCalledWith('The permission could not be updated.', {
      duration: 7000,
    });
  });
});
