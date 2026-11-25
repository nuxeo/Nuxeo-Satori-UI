import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { AppConfigService } from '@nuxeo/satori-platform/app-config';
import { NxsToastService } from '@nuxeo/satori-platform/components';
import {
  DOCUMENT_RULE_EVALUATORS,
  EMPTY_EXTENSION_RULE_CONTEXT,
  EXTENSION_SLOTS,
  ExtensionActionRegistry,
  ExtensionSlotRegistry,
  provideSatoriExtensions,
  type ExtensionActionDescriptor,
  type ExtensionRuleContext,
} from '@nuxeo/satori-platform/extensions';
import {
  DocumentChangesService,
  NUXEO_API_ORIGIN,
  type NuxeoDocument,
} from '@nuxeo/satori-platform/nuxeo-client';
import { firstValueFrom, Subject } from 'rxjs';

import type { AppActionDialogData, AppActionOutcome } from './app-action-dialog';
import { APP_ACTION_RUN_OPERATION, AppActionsService } from './app-actions.service';

// The Payers kit's operation buttons, registered from its own actions.json and run as the app runs
// them: checked again when chosen and again on the record read anew, then sent to the server with
// the app, the action, the record and what the form gave, and nothing else.

const ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..', '..');
const KIT = JSON.parse(
  readFileSync(
    join(ROOT, 'business-apps/packages/payers-claims-demo/bundle/agentic-ui-config/actions.json'),
    'utf8',
  ),
) as unknown;

const REQUEST = 'payers.claim.requestRecords';
const RUN_URL = `/nuxeo/api/v1/automation/${APP_ACTION_RUN_OPERATION}`;

const claim = (state: string, permissions = ['Read', 'Write']): NuxeoDocument => ({
  uid: 'c1',
  title: 'CLAIM-000130',
  type: 'Claim',
  path: '/default-domain/workspaces/payers-demo/claims/c1',
  lastModified: '2026-11-25T00:00:00.000Z',
  state,
  properties: { 'claim:number': 'CLAIM-000130' },
  contextParameters: { permissions },
});

const adjuster = (document: NuxeoDocument): ExtensionRuleContext => ({
  ...EMPTY_EXTENSION_RULE_CONTEXT,
  document,
  user: { username: 'dana.lee', isAdministrator: false, groups: ['members', 'claims-adjusters'] },
});

describe('AppActionsService', () => {
  let http: HttpTestingController;
  let opened: { data: AppActionDialogData; closed: Subject<'done' | undefined> }[];
  const toast = { show: vi.fn(), error: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    opened = [];
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService(),
        { provide: NUXEO_API_ORIGIN, useValue: '' },
        { provide: AppConfigService, useValue: { manifest: signal({ extensionLayers: [] }) } },
        provideSatoriExtensions({ rules: DOCUMENT_RULE_EVALUATORS }),
        { provide: NxsToastService, useValue: toast },
        {
          provide: MatDialog,
          useValue: {
            open: (_component: unknown, config: { data: AppActionDialogData }) => {
              const closed = new Subject<'done' | undefined>();
              opened.push({ data: config.data, closed });
              return { afterClosed: () => closed };
            },
          },
        },
      ],
    });
    const translate = TestBed.inject(TranslateService);
    // Flat, as an app's labels file writes its keys.
    translate.setTranslation('en', {
      'payers.action.requestRecords': 'Request medical records',
      'payers.action.requestRecords.confirm': "Ask the provider for this claim's medical records?",
      'payers.action.requestRecords.sent': 'The medical records are requested.',
    });
    translate.use('en');
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const service = () => TestBed.inject(AppActionsService);
  const slots = () => TestBed.inject(ExtensionSlotRegistry);

  /** Registers the kit's actions, then chooses the action on the record, as a toolbar or a row does. */
  function choose(id: string, context: ExtensionRuleContext): void {
    service().register('payers-claims', KIT);
    const descriptor = { id } as ExtensionActionDescriptor;
    expect(TestBed.inject(ExtensionActionRegistry).execute(descriptor, context)).toBe(true);
  }

  async function run(
    values: Record<string, unknown>,
    fresh: NuxeoDocument,
  ): Promise<{
    outcome: Promise<AppActionOutcome>;
  }> {
    const outcome = firstValueFrom(opened[0].data.run(values));
    const read = http.expectOne((request) => request.url === '/nuxeo/api/v1/id/c1');
    expect(read.request.headers.get('enrichers.document')).toBe('permissions');
    read.flush(fresh);
    await Promise.resolve();
    return { outcome };
  }

  it('registers each operation button where it shows, with its rules, and a handler under its id', () => {
    expect(service().register('payers-claims', KIT)).toEqual([
      REQUEST,
      'payers.claim.referToInvestigations',
    ]);
    expect(slots().registeredIds(EXTENSION_SLOTS.toolbar)).toEqual([
      REQUEST,
      'payers.claim.referToInvestigations',
    ]);
    expect(slots().registeredIds(EXTENSION_SLOTS.rowActions)).toEqual([REQUEST]);
    const [toolbar] = slots().resolve<ExtensionActionDescriptor>(
      EXTENSION_SLOTS.toolbar,
      undefined,
      adjuster(claim('inReview')),
    );
    expect(toolbar).toMatchObject({
      id: REQUEST,
      label: REQUEST,
      labelKey: 'payers.action.requestRecords',
      icon: 'health_record',
      order: 20,
      enabledRule: 'app.rules.canWrite',
    });
    // Its rule is the file's visibleWhen: no claim in review, no button.
    expect(
      slots().resolve(EXTENSION_SLOTS.toolbar, undefined, adjuster(claim('approved'))),
    ).toEqual([]);
    expect(TestBed.inject(ExtensionActionRegistry).has(REQUEST)).toBe(true);
    // The lifecycle button is the platform's to offer.
    expect(TestBed.inject(ExtensionActionRegistry).has('payers.claim.pay')).toBe(false);
  });

  it('asks its question, with its form, on the record it was chosen on', () => {
    choose(REQUEST, adjuster(claim('inReview')));
    expect(opened).toHaveLength(1);
    const { data } = opened[0];
    expect(data.title).toBe('Request medical records');
    expect(data.question).toBe("Ask the provider for this claim's medical records?");
    expect(data.document.uid).toBe('c1');
    expect(
      data.form?.cards[0].fields.map((field) => field.kind === 'property' && field.xpath),
    ).toEqual(['var:urgent', 'var:note']);
  });

  it('checks its rules again when chosen, and opens nothing when they no longer pass', () => {
    choose(REQUEST, adjuster(claim('approved')));
    choose(REQUEST, adjuster(claim('inReview', ['Read'])));
    expect(opened).toEqual([]);
    expect(toast.error).toHaveBeenCalledTimes(2);
    expect(toast.error).toHaveBeenCalledWith('document-layouts.action.not-available');
  });

  it('reads the record again, then sends the app, the action, the record and what was entered', async () => {
    choose(REQUEST, adjuster(claim('inReview')));
    const { outcome } = await run({ urgent: true, note: 'Before Friday' }, claim('inReview'));
    const sent = http.expectOne(RUN_URL);
    expect(sent.request.method).toBe('POST');
    expect(sent.request.body).toEqual({
      input: 'doc:c1',
      params: {
        app: 'payers-claims',
        action: REQUEST,
        values: '{"urgent":true,"note":"Before Friday"}',
      },
      context: {},
    });
    sent.flush({ app: 'payers-claims', action: REQUEST, status: 'done' });
    expect(await outcome).toEqual({ kind: 'done' });

    const changes = vi.spyOn(TestBed.inject(DocumentChangesService), 'notify');
    opened[0].closed.next('done');
    expect(toast.show).toHaveBeenCalledWith('The medical records are requested.');
    expect(changes).toHaveBeenCalledTimes(1);
  });

  it('runs nothing when the record read again no longer passes its rules', async () => {
    choose(REQUEST, adjuster(claim('inReview')));
    const { outcome } = await run({ note: 'x' }, claim('approved'));
    http.expectNone(RUN_URL);
    expect(await outcome).toEqual({
      kind: 'failed',
      message: 'document-layouts.action.no-longer-available',
    });
  });

  it.each([
    [403, 'document-layouts.action.refused'],
    [404, 'document-layouts.action.unknown'],
    [400, 'document-layouts.action.invalid'],
    [500, 'document-layouts.action.failed'],
  ])('says why the server refused it, HTTP %s', async (status, message) => {
    choose(REQUEST, adjuster(claim('inReview')));
    const { outcome } = await run({ note: 'x' }, claim('inReview'));
    http.expectOne(RUN_URL).flush({ message: 'no' }, { status, statusText: 'No' });
    expect(await outcome).toEqual({ kind: 'failed', message });
  });

  it('takes no answer for another action as a run', async () => {
    choose(REQUEST, adjuster(claim('inReview')));
    const { outcome } = await run({ note: 'x' }, claim('inReview'));
    http.expectOne(RUN_URL).flush({ app: 'payers-claims', action: 'other', status: 'done' });
    expect(await outcome).toEqual({ kind: 'failed', message: 'document-layouts.action.failed' });
  });

  it('says nothing, and reads nothing again, when the dialog is cancelled', () => {
    choose(REQUEST, adjuster(claim('inReview')));
    const changes = vi.spyOn(TestBed.inject(DocumentChangesService), 'notify');
    opened[0].closed.next(undefined);
    expect(toast.show).not.toHaveBeenCalled();
    expect(changes).not.toHaveBeenCalled();
  });

  it('reads nothing again after an action that says "refresh": false', () => {
    const file = KIT as { actions: Record<string, unknown>[] };
    service().register('payers-claims', {
      ...file,
      actions: file.actions.map((action) =>
        action['id'] === 'payers.claim.referToInvestigations'
          ? { ...action, refresh: false }
          : action,
      ),
    });
    const supervisor: ExtensionRuleContext = {
      ...adjuster(claim('inReview')),
      user: { username: 'jordan.kim', isAdministrator: false, groups: ['claims-supervisors'] },
    };
    TestBed.inject(ExtensionActionRegistry).execute(
      { id: 'payers.claim.referToInvestigations' } as ExtensionActionDescriptor,
      supervisor,
    );
    const changes = vi.spyOn(TestBed.inject(DocumentChangesService), 'notify');
    opened[0].closed.next('done');
    expect(changes).not.toHaveBeenCalled();
    expect(opened[0].data.form).toBeNull();
    // Its own question has no text in this catalogue, so the platform's names the action.
    expect(opened[0].data.question).toBe('document-layouts.action.confirm');
  });
});
