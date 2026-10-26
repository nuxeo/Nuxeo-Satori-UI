import {
  Component,
  Injectable,
  Injector,
  LOCALE_ID,
  inject,
  provideZonelessChangeDetection,
  type Provider,
  ChangeDetectionStrategy,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DateAdapter, MATERIAL_ANIMATIONS, NativeDateAdapter } from '@angular/material/core';
import { MatDialog, type MatDialogRef } from '@angular/material/dialog';
import { Subject, of, throwError, type Observable } from 'rxjs';
import { type MockInstance } from 'vitest';
import { DocumentDetailService } from '@nuxeo/satori-platform/nuxeo-client';

import { CalendarDayAdapter } from '../date-input/calendar-day-adapter.mock';
import { NxsToastService } from '../toast/toast.service';
import {
  NxsShareExternalDialogComponent,
  type NxsShareExternalDialogData,
} from './share-external-dialog.component';

/** A date library's adapter, as a host might provide one: it reads any text as 1 January 2030. */
@Injectable()
class HostLibraryAdapter extends NativeDateAdapter {
  override parse(): Date | null {
    return new Date(2030, 0, 1);
  }
}

/**
 * A page that opens the dialog and provides its own date adapter, as main's feature components
 * provide `provideSatoriDateAdapter()`. `MatDialog` is a root service, so the dialog sees the page's
 * providers only through the injector `open()` is given.
 */
@Component({
  standalone: true,
  template: '',
  changeDetection: ChangeDetectionStrategy.Eager,
  providers: [{ provide: DateAdapter, useClass: HostLibraryAdapter }],
})
class OpeningPageComponent {
  readonly injector = inject(Injector);
}

describe('NxsShareExternalDialogComponent', () => {
  let addExternal: ReturnType<typeof vi.fn<(...args: unknown[]) => Observable<unknown>>>;
  let toastShow: MockInstance;
  let toastError: MockInstance;
  let ref: MatDialogRef<NxsShareExternalDialogComponent, boolean>;
  let close: MockInstance;

  const overlay = (): HTMLElement =>
    document.querySelector('.cdk-overlay-container') as HTMLElement;
  const q = <T extends Element = HTMLElement>(selector: string): T =>
    overlay().querySelector(selector) as T;
  const emailBox = () => q<HTMLInputElement>('input[type="email"]');
  const dateBoxes = () =>
    [
      ...overlay().querySelectorAll('.nxs-share-external-dialog__dates input'),
    ] as HTMLInputElement[];
  const commentBox = () => q<HTMLTextAreaElement>('textarea');
  const create = () => q<HTMLButtonElement>('.nxs-share-external-dialog__create');
  const another = () => q<HTMLButtonElement>('.nxs-share-external-dialog__another');
  const cancel = () => q<HTMLButtonElement>('mat-dialog-actions button');
  const alerts = () =>
    [...overlay().querySelectorAll('[role="alert"]')].map((el) => el.textContent?.trim());

  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve));
    TestBed.tick();
  }

  async function open(
    data: Partial<NxsShareExternalDialogData> = {},
    injector?: Injector,
  ): Promise<void> {
    ref = TestBed.inject(MatDialog).open(NxsShareExternalDialogComponent, {
      data: { documentUid: 'doc-1', ...data },
      injector,
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

  /** A day as the native date adapter parses what a user types: local midnight. */
  const day = (month: number, date: number, year: number) => `${month}/${date}/${year}`;

  async function fillValid(email = 'ext@example.com'): Promise<void> {
    await type(emailBox(), email);
    await type(dateBoxes()[1], day(1, 31, 2030));
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

  beforeEach(() => {
    addExternal = vi.fn(() => of({ document: {}, notificationSent: true }));
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        {
          provide: DocumentDetailService,
          useValue: { addExternalPermissionWithNotification: addExternal },
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

  it('is named by its title', async () => {
    await open();

    const container = q('mat-dialog-container');
    const title = document.getElementById(container.getAttribute('aria-labelledby') ?? '');
    expect(title?.textContent?.trim()).toBe('Share with external user');
  });

  it('offers the rights the document type makes visible, as Web UI does', async () => {
    await open({ permissions: ['Read', 'WriteVersion'] });

    expect(await offeredLabels()).toEqual(['Read', 'Write versions']);
  });

  it('offers Nuxeo’s default three rights when the type names none', async () => {
    await open({ permissions: null });

    expect(await offeredLabels()).toEqual(['Read', 'Edit', 'Manage everything']);
  });

  it('needs a valid email and an end date before it can share', async () => {
    await open();
    expect(create().disabled).toBe(true);

    await type(emailBox(), 'ext@example.com');
    expect(create().disabled).toBe(true);
    expect(another().disabled).toBe(true);

    await type(dateBoxes()[1], day(1, 31, 2030));
    expect(create().disabled).toBe(false);
    expect(another().disabled).toBe(false);
  });

  it("keeps the old check's verdict on representative addresses without an empty domain label", async () => {
    await open();
    for (const [email, valid] of [
      ['ext@example.com', true],
      ['jane.doe@mail.example.co.uk', true],
      ['a@b.c', true],
      ['x.@y.z', true],
      ['.x@y.z', true],
      ['a@-b.c', true],
      ['a@b_c.d', true],
      ['a@[1.2.3.4]', true],
      ['"q"@b.c', true],
      ['a@b.é', true],
      ['a@b', false],
      ['@b.c', false],
      ['a@', false],
      ['a b@c.d', false],
      ['a@b c.d', false],
      ['a@b@c.d', false],
      ['a@.b', false],
      ['a@b.', false],
    ] as const) {
      await fillValid(email);
      expect(create().disabled, email).toBe(!valid);
    }
  });

  it('refuses an empty label inside or at the end of the domain, which the old check let through', async () => {
    await open();
    for (const email of ['a@b..c', 'a@.b.c', 'a@b.c.']) {
      await fillValid(email);
      expect(create().disabled, email).toBe(true);
    }
  });

  it('checks a pasted address of 50,000 characters without stalling the dialog', async () => {
    await open();
    const started = performance.now();
    await type(emailBox(), `a@${'.'.repeat(50_000)} x`);
    expect(performance.now() - started).toBeLessThan(250);
    expect(create().disabled).toBe(true);
  });

  it('flags an invalid email once the user leaves the box, and ties the message to it', async () => {
    await open();
    await type(emailBox(), 'not-an-email');
    expect(emailBox().closest('mat-form-field')!.querySelector('mat-error')).toBeNull();
    expect(emailBox().getAttribute('aria-invalid')).toBe('false');

    emailBox().dispatchEvent(new Event('blur'));
    await settle();

    const error = emailBox().closest('mat-form-field')!.querySelector('mat-error') as HTMLElement;
    expect(error.textContent?.trim()).toBe('Enter a valid email address.');
    expect(error.closest('[aria-live="polite"]')).not.toBeNull();
    expect(emailBox().getAttribute('aria-invalid')).toBe('true');
    expect((emailBox().getAttribute('aria-describedby') ?? '').split(' ')).toContain(error.id);

    await type(emailBox(), 'ext@example.com');
    expect(emailBox().closest('mat-form-field')!.querySelector('mat-error')).toBeNull();
    expect(emailBox().getAttribute('aria-invalid')).toBe('false');
  });

  it('refuses an end date before the start date', async () => {
    await open();
    await fillValid();

    await type(dateBoxes()[0], day(2, 1, 2030));

    expect(alerts()).toEqual(['The end date is before the start date.']);
    expect(create().disabled).toBe(true);
  });

  it('shares with a notification and the end day, then closes with true', async () => {
    await open({ permissions: ['Read', 'ReadWrite'] });
    await fillValid('  ext@example.com ');

    create().click();
    await settle();

    expect(addExternal).toHaveBeenCalledWith('doc-1', {
      email: 'ext@example.com',
      permission: 'Read',
      begin: null,
      end: '2030-01-31',
      notify: true,
      comment: undefined,
    });
    expect(toastShow).toHaveBeenCalledWith(
      'Shared with ext@example.com, who has been sent a link to the document.',
      { duration: 7000 },
    );
    expect(close).toHaveBeenCalledWith(true);
  });

  describe('typed dates', () => {
    /**
     * The end day sent for the text typed into the end date, under the given providers, with the
     * dialog opened with the injector `injector` returns, if it returns one.
     */
    async function endSentFor(
      text: string,
      providers: Provider[],
      injector?: () => Injector | undefined,
    ): Promise<unknown> {
      TestBed.configureTestingModule({ providers });
      await open({}, injector?.());
      await type(emailBox(), 'ext@example.com');
      await type(dateBoxes()[1], text);
      create().click();
      await settle();
      return addExternal.mock.calls[0]?.[1];
    }

    it('reads a typed date day first in French', async () => {
      const sent = await endSentFor('03/04/2030', [{ provide: LOCALE_ID, useValue: 'fr' }]);
      expect(sent).toMatchObject({ end: '2030-04-03' });
    });

    it('reads the same text month first in American English', async () => {
      const sent = await endSentFor('03/04/2030', [{ provide: LOCALE_ID, useValue: 'en-US' }]);
      expect(sent).toMatchObject({ end: '2030-03-04' });
    });

    it('uses a date adapter the application provides', async () => {
      const sent = await endSentFor('anything', [
        { provide: LOCALE_ID, useValue: 'fr' },
        { provide: DateAdapter, useClass: HostLibraryAdapter },
      ]);
      expect(sent).toMatchObject({ end: '2030-01-01' });
    });

    it('reads in the locale, not with an adapter only the opening page provides', async () => {
      const sent = await endSentFor('03/04/2030', [{ provide: LOCALE_ID, useValue: 'fr' }], () => {
        // The page is open, but `open()` is not given its injector, as integration's pages do.
        TestBed.createComponent(OpeningPageComponent);
        return undefined;
      });
      expect(sent).toMatchObject({ end: '2030-04-03' });
    });

    it('uses the opening page’s date adapter when open() is given the page’s injector', async () => {
      const sent = await endSentFor(
        '03/04/2030',
        [{ provide: LOCALE_ID, useValue: 'fr' }],
        () => TestBed.createComponent(OpeningPageComponent).componentInstance.injector,
      );
      expect(sent).toMatchObject({ end: '2030-01-01' });
    });
  });

  describe('with an application adapter that does not hold JS dates', () => {
    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [{ provide: DateAdapter, useClass: CalendarDayAdapter }],
      });
    });

    it('sends the days typed, as calendar days', async () => {
      await open();
      await type(emailBox(), 'ext@example.com');
      await type(dateBoxes()[0], '2030-01-02');
      await type(dateBoxes()[1], '2030-01-31');
      expect(dateBoxes().map((box) => box.value)).toEqual(['2030-01-02', '2030-01-31']);

      create().click();
      await settle();

      expect(addExternal.mock.calls[0]?.[1]).toMatchObject({
        begin: '2030-01-02',
        end: '2030-01-31',
      });
    });

    it('refuses an end date before the start date', async () => {
      await open();
      await type(emailBox(), 'ext@example.com');
      await type(dateBoxes()[1], '2030-01-31');
      await type(dateBoxes()[0], '2030-02-01');

      expect(alerts()).toEqual(['The end date is before the start date.']);
      expect(create().disabled).toBe(true);
    });
  });

  it('sends the start day and a trimmed message when given', async () => {
    await open();
    await fillValid();
    await type(dateBoxes()[0], day(1, 2, 2030));
    await type(commentBox(), '  Please review  ');

    create().click();
    await settle();

    expect(addExternal.mock.calls[0][1]).toMatchObject({
      begin: '2030-01-02',
      comment: 'Please review',
    });
  });

  it('shows why Nuxeo could not send the notification, when it says', async () => {
    addExternal.mockReturnValue(
      of({
        document: {},
        notificationSent: false,
        notificationErrorKey: 'permissions.notification.mail-hint',
      }),
    );
    await open();
    await fillValid();

    create().click();
    await settle();

    expect(toastShow).toHaveBeenCalledWith(
      'Requires outbound mail (SMTP) configured on the Nuxeo server.',
      { duration: 7000 },
    );
  });

  it('stays open and empties the form after "Create and add another"', async () => {
    await open();
    await fillValid();
    await type(commentBox(), 'note');

    another().click();
    await settle();

    expect(addExternal).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    expect(emailBox().value).toBe('');
    expect(dateBoxes()[1].value).toBe('');
    expect(commentBox().value).toBe('');
    expect(create().disabled).toBe(true);
  });

  it('reports a share made with "add another" however the dialog is closed', async () => {
    await open();
    await fillValid();
    another().click();
    await settle();

    cancel().click();

    expect(close).toHaveBeenCalledWith(true);
  });

  it('reports the share on Escape and on a backdrop click too', async () => {
    await open();
    await fillValid();
    another().click();
    await settle();

    q('mat-dialog-container').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await settle();
    expect(close).toHaveBeenCalledWith(true);

    close.mockClear();
    await open();
    q<HTMLElement>('.cdk-overlay-backdrop').click();
    await settle();
    expect(close).toHaveBeenCalledWith(false);
  });

  it('closes with false when nothing was shared', async () => {
    await open();

    cancel().click();

    expect(close).toHaveBeenCalledWith(false);
    expect(addExternal).not.toHaveBeenCalled();
  });

  it('names the progress on the button pressed and blocks the others', async () => {
    const pending = new Subject<unknown>();
    addExternal.mockReturnValue(pending);
    await open();
    await fillValid();

    another().click();
    create().click();
    await settle();

    expect(addExternal).toHaveBeenCalledTimes(1);
    expect(another().querySelector('mat-progress-spinner')?.getAttribute('aria-label')).toBe(
      'Sharing the document',
    );
    expect(create().querySelector('mat-progress-spinner')).toBeNull();
    expect(cancel().disabled).toBe(true);
    q('mat-dialog-container').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(close).not.toHaveBeenCalled();
    pending.complete();
  });

  it('says a refusal is a refusal, and keeps what the user typed', async () => {
    addExternal.mockReturnValue(throwError(() => ({ status: 401 })));
    await open();
    await fillValid();

    create().click();
    await settle();

    expect(toastError).toHaveBeenCalledWith(
      "You don't have permission to change permissions on this document.",
      { duration: 7000 },
    );
    expect(close).not.toHaveBeenCalled();
    expect(emailBox().value).toBe('ext@example.com');
    expect(create().disabled).toBe(false);
  });

  it('points at the mail server when Nuxeo could not send the share', async () => {
    addExternal.mockReturnValue(
      throwError(() => ({ error: { message: 'Error while sending a mail' } })),
    );
    await open();
    await fillValid();

    create().click();
    await settle();

    expect(toastError).toHaveBeenCalledWith(
      'Permission could not be created. Configure outbound mail (SMTP) on the Nuxeo server.',
      { duration: 7000 },
    );
  });

  it('reports any other failure as one', async () => {
    addExternal.mockReturnValue(throwError(() => ({ status: 500 })));
    await open();
    await fillValid();

    create().click();
    await settle();

    expect(toastError).toHaveBeenCalledWith('The document could not be shared.', {
      duration: 7000,
    });
  });
});
