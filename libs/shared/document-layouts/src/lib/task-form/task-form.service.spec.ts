import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { APP_DEFINITION_FILES } from '@agentic-ui/shared/app-registry';
import { APP_BOOTSTRAP_CONFIG_URL } from '@nuxeo/satori-platform/app-config';
import { ExtensionRuleRegistry } from '@nuxeo/satori-platform/extensions';
import {
  NUXEO_API_ORIGIN,
  type NuxeoDocument,
  type NuxeoTask,
} from '@nuxeo/satori-platform/nuxeo-client';
import { firstValueFrom, of } from 'rxjs';

import { DocumentLayoutService, taskFormUrl } from '../document-layout.service';
import type { ResolvedFormLayout } from '../form-layout/resolve-form-layout';

const TASK_FILE = '/nuxeo/agentic-ui-config/tasks/claimDetermination.determine.layout.json';
const CLAIM_TYPE = '/nuxeo/api/v1/config/types/Claim';
const SCHEMA = (name: string) => `/nuxeo/api/v1/config/schemas/${name}`;

const CLAIM = {
  name: 'Claim',
  schemas: [
    { name: 'dublincore', '@prefix': 'dc', fields: { title: 'string' } },
    { name: 'claim', '@prefix': 'claim', fields: { number: 'string', billedAmount: 'double' } },
  ],
};

/** As `/config/schemas/<name>` answers with `fetch-schema: fields`, trimmed. */
const variables = (name: string, fields: Record<string, string>) => ({
  'entity-type': 'schema',
  name,
  prefix: name,
  '@prefix': name,
  fields: Object.fromEntries(
    Object.entries(fields).map(([field, type]) => [field, { type, constraints: [] }]),
  ),
});

const TASK: NuxeoTask = {
  id: 't1',
  name: 'determine',
  directive: '',
  workflowInstanceId: 'w1',
  workflowModelName: 'claimDetermination',
  workflowTitle: '',
  created: '',
  dueDate: '',
  state: 'opened',
  nodeName: 'determine',
  targetDocumentIds: [{ id: 'c1' }],
  actors: [],
  delegatedActors: [],
  comments: [],
  variables: { decision: null },
  taskInfo: {
    taskActions: [{ name: 'approve', label: 'Approve' }],
    schemas: [{ name: 'var_determine' }, { name: 'dublincore' }, { name: 'route_node' }],
  },
};

const CLAIM_DOCUMENT: NuxeoDocument = Object.assign(
  {
    uid: 'c1',
    title: 'CLM-1',
    type: 'Claim',
    path: '/c1',
    lastModified: '',
    properties: { 'claim:number': 'CLM-1', 'claim:billedAmount': 1200 },
  },
  { schemas: [{ name: 'claim', prefix: 'claim' }] },
);

const FORM = {
  version: 2,
  cards: [
    { id: 'claim', fields: ['claim:number'] },
    {
      id: 'determination',
      fields: [{ field: 'var:decision', required: true }, 'var:reviewer', 'var:nope'],
    },
  ],
};

describe('DocumentLayoutService: task forms', () => {
  let http: HttpTestingController;
  let service: DocumentLayoutService;
  let warnings: string[];

  beforeEach(() => {
    warnings = [];
    vi.spyOn(console, 'warn').mockImplementation((message: unknown) =>
      warnings.push(String(message)),
    );
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        { provide: APP_BOOTSTRAP_CONFIG_URL, useValue: '/nuxeo/agentic-ui-config/bootstrap.json' },
        { provide: NUXEO_API_ORIGIN, useValue: '' },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(DocumentLayoutService);
    TestBed.inject(ExtensionRuleRegistry).registerRules({});
  });

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  const formFor = (task: NuxeoTask = TASK): Promise<ResolvedFormLayout | null> =>
    firstValueFrom(service.taskFormFor(task, CLAIM_DOCUMENT));

  /** The file, the type and both variable schemas, answered in the order the service asks. */
  async function answer(content: object): Promise<ResolvedFormLayout | null> {
    const form = formFor();
    http.expectOne(TASK_FILE).flush(content);
    http.expectOne(CLAIM_TYPE).flush(CLAIM);
    http
      .expectOne(SCHEMA('var_determine'))
      .flush(variables('var_determine', { decision: 'string' }));
    http
      .expectOne(SCHEMA('var_claimDetermination'))
      .flush(variables('var_claimDetermination', { reviewer: 'string', decision: 'long' }));
    return form;
  }

  it('sits beside the layouts, named by the workflow and the step', () => {
    expect(
      taskFormUrl('/nuxeo/agentic-ui-config/bootstrap.json', 'claimDetermination', 'determine'),
    ).toBe(TASK_FILE);
  });

  it('reads the step’s file, as the package writes it, with no envelope, past the interceptors', async () => {
    const form = await answer(FORM);
    expect(form).toMatchObject({ version: 2, kind: 'task', type: 'Claim' });
  });

  it('types each var: field from the step’s variables, then the workflow’s, the step’s first', async () => {
    const form = await answer(FORM);
    const fields = form?.cards[1]?.fields.map(
      (field) => field.kind === 'property' && [field.xpath, field.definition.type],
    );
    expect(fields).toEqual([
      ['var:decision', 'string'],
      ['var:reviewer', 'string'],
    ]);
    expect(warnings).toEqual([
      '[agentic-ui-layouts] claimDetermination.determine task form: cards[1].fields[2] left out: var:nope is not a variable of the step or its workflow',
    ]);
  });

  it('is no form, silently, when nothing is served for the step, and asks once per session', async () => {
    const first = formFor();
    http.expectOne(TASK_FILE).flush('', { status: 404, statusText: 'Not Found' });
    expect(await first).toBeNull();
    expect(await formFor()).toBeNull();
    http.expectNone(TASK_FILE);
    expect(warnings).toEqual([]);
  });

  it('is no form when its file is refused, and says why', async () => {
    const form = formFor();
    http.expectOne(TASK_FILE).flush({
      version: 2,
      cards: [{ id: 'a', fields: [{ field: 'claim:number', required: true }] }],
    });
    expect(await form).toBeNull();
    expect(warnings).toEqual([
      `[agentic-ui-layouts] claimDetermination.determine task form from ${TASK_FILE} refused, showing the task's own form: cards[0].fields[0].required: "required" belongs on a var: field: a task form shows the record's own properties read-only`,
    ]);
  });

  it('says why a read failed, and asks again for the next task', async () => {
    const first = formFor();
    http.expectOne(TASK_FILE).flush('', { status: 500, statusText: 'Server Error' });
    expect(await first).toBeNull();
    expect(warnings).toEqual([
      `[agentic-ui-layouts] claimDetermination.determine task form not loaded from ${TASK_FILE}: HTTP 500`,
    ]);
    const second = formFor();
    http.expectOne(TASK_FILE).flush('', { status: 404, statusText: 'Not Found' });
    expect(await second).toBeNull();
  });

  it('draws no form when a variable schema the form needs cannot be read, and asks again next time', async () => {
    const form = formFor();
    http.expectOne(TASK_FILE).flush(FORM);
    http.expectOne(CLAIM_TYPE).flush(CLAIM);
    http.expectOne(SCHEMA('var_determine')).flush('', { status: 500, statusText: 'Server Error' });
    http
      .expectOne(SCHEMA('var_claimDetermination'))
      .flush(variables('var_claimDetermination', { reviewer: 'string' }));
    expect(await form).toBeNull();
    expect(warnings).toContain(
      "[agentic-ui-layouts] claimDetermination.determine task form not drawn, showing the task's own form: var_determine could not be read, and var:decision, var:nope need it",
    );
    const again = formFor();
    http
      .expectOne(SCHEMA('var_determine'))
      .flush(variables('var_determine', { decision: 'string' }));
    expect(await again).not.toBeNull();
  });

  it('draws the form when the workflow has no variables of its own, if the step’s are enough', async () => {
    const form = formFor();
    http.expectOne(TASK_FILE).flush({ version: 2, cards: [{ id: 'a', fields: ['var:decision'] }] });
    http.expectOne(CLAIM_TYPE).flush(CLAIM);
    http
      .expectOne(SCHEMA('var_determine'))
      .flush(variables('var_determine', { decision: 'string' }));
    http
      .expectOne(SCHEMA('var_claimDetermination'))
      .flush('', { status: 404, statusText: 'Not Found' });
    expect((await form)?.cards[0]?.fields).toHaveLength(1);
  });

  it('asks for nothing for a task whose workflow or step is not a name a package can write', async () => {
    expect(await formFor({ ...TASK, nodeName: '../x' })).toBeNull();
    expect(await formFor({ ...TASK, workflowModelName: '' })).toBeNull();
    http.expectNone(() => true);
  });

  it('reads the record a task is on with all its properties, and is null when it cannot', async () => {
    const read = firstValueFrom(service.taskDocument('c1'));
    const request = http.expectOne('/nuxeo/api/v1/id/c1');
    expect(request.request.headers.get('properties')).toBe('*');
    request.flush(CLAIM_DOCUMENT);
    expect((await read)?.uid).toBe('c1');

    const failed = firstValueFrom(service.taskDocument('c2'));
    http.expectOne('/nuxeo/api/v1/id/c2').flush('', { status: 403, statusText: 'Forbidden' });
    expect(await failed).toBeNull();
  });
});

/** Where the app provides the app registry, a task form is read through it, by its path there. */
describe('DocumentLayoutService: task forms, where the app provides the app registry', () => {
  it('reads the form through APP_DEFINITION_FILES', async () => {
    const asked: [string, string | null][] = [];
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        { provide: APP_BOOTSTRAP_CONFIG_URL, useValue: '/nuxeo/agentic-ui-config/bootstrap.json' },
        { provide: NUXEO_API_ORIGIN, useValue: '' },
        {
          provide: APP_DEFINITION_FILES,
          useValue: {
            file: (path: string, developmentUrl: string | null) => {
              asked.push([path, developmentUrl]);
              return of(FORM);
            },
            labelLanguages: () => of([]),
          },
        },
      ],
    });
    const http = TestBed.inject(HttpTestingController);
    const service = TestBed.inject(DocumentLayoutService);
    TestBed.inject(ExtensionRuleRegistry).registerRules({});
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const form = firstValueFrom(service.taskFormFor(TASK, CLAIM_DOCUMENT));
    http.expectOne(CLAIM_TYPE).flush(CLAIM);
    http
      .expectOne(SCHEMA('var_determine'))
      .flush(variables('var_determine', { decision: 'string' }));
    http
      .expectOne(SCHEMA('var_claimDetermination'))
      .flush(variables('var_claimDetermination', { reviewer: 'string' }));

    expect(await form).not.toBeNull();
    expect(asked).toEqual([['tasks/claimDetermination.determine.layout.json', TASK_FILE]]);
    http.verify();
    vi.restoreAllMocks();
  });
});
