import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { NxsTaskForm } from '@nuxeo/satori-platform/components';
import {
  AppExtensionsService,
  DOCUMENT_RULE_EVALUATORS,
  ExtensionRuleRegistry,
} from '@nuxeo/satori-platform/extensions';
import {
  DirectoryService,
  type NuxeoDocument,
  type NuxeoTask,
} from '@nuxeo/satori-platform/nuxeo-client';
import { Subject, of, type Observable } from 'rxjs';

import { DocumentLayoutService } from '../document-layout.service';
import { readFormLayout } from '../form-layout/form-layout';
import { resolveFormLayout, type ResolvedFormLayout } from '../form-layout/resolve-form-layout';
import type { DocumentTypeDefinition } from '../layout.model';
import { RECORD_PAGE_TIME_ZONE, RECORD_PAGE_TODAY } from '../record-page/record-clock';
import { TaskFormComponent } from './task-form';

// A task's own form in the task panel, drawn from app-definition-v2.md section 6's example: the
// claim's properties read-only, the step's variables edited, a variable required by another's
// value, and a check against the claim's billed amount.

const CLAIM_TYPE: DocumentTypeDefinition = {
  name: 'Claim',
  schemas: [
    {
      name: 'claim',
      prefix: 'claim',
      fields: { number: { type: 'string' }, billedAmount: { type: 'double' } },
    },
  ],
};

const VARIABLES = new Map([
  ['var:decision', { type: 'string' }],
  ['var:allowedAmount', { type: 'double' }],
  ['var:denialReason', { type: 'string' }],
]);

const decided = (...values: string[]) => ({
  type: 'app.rules.fieldIn',
  parameters: [{ field: 'var:decision' }, ...values],
});

const DETERMINE = {
  version: 2,
  cards: [
    {
      id: 'claim',
      label: 'Claim',
      fields: [
        'claim:number',
        { field: 'claim:billedAmount', widget: 'currency', parameters: { currency: 'USD' } },
      ],
    },
    {
      id: 'determination',
      label: 'Determination',
      fields: [
        { field: 'var:decision', label: 'Decision', required: true },
        {
          field: 'var:allowedAmount',
          label: 'Allowed amount',
          required: decided('approve', 'partial'),
          checks: [
            {
              type: 'core.atMost',
              parameters: [{ field: 'claim:billedAmount' }],
              label: 'No more than the billed amount',
            },
          ],
        },
        { field: 'var:denialReason', label: 'Denial reason', visibleWhen: decided('deny') },
      ],
    },
  ],
};

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
  variables: { decision: null, allowedAmount: null, denialReason: null },
  taskInfo: { taskActions: [{ name: 'approve', label: 'Approve' }] },
};

const CLAIM: NuxeoDocument = Object.assign(
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

describe('TaskFormComponent', () => {
  let fixture: ComponentFixture<TaskFormComponent>;
  let handed: (NxsTaskForm | null)[];
  let taskFormFor: ReturnType<
    typeof vi.fn<
      (task: NuxeoTask, document: NuxeoDocument) => Observable<ResolvedFormLayout | null>
    >
  >;
  let taskDocument: ReturnType<typeof vi.fn<(uid: string) => Observable<NuxeoDocument | null>>>;

  const host = (): HTMLElement => fixture.nativeElement;
  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const input$ = (xpath: string) =>
    host().querySelector<HTMLInputElement>(`input[data-xpath="${xpath}"]`);
  const type = async (xpath: string, text: string) => {
    const field = input$(xpath);
    if (!field) throw new Error(`no field ${xpath}`);
    field.value = text;
    field.dispatchEvent(new Event('input'));
    field.dispatchEvent(new Event('blur'));
    await settle();
  };
  const form = (): NxsTaskForm => {
    const last = handed.at(-1);
    if (!last) throw new Error('no form handed');
    return last;
  };

  function layout(content: Record<string, unknown> = DETERMINE): ResolvedFormLayout {
    const file = readFormLayout(content, 'task', {
      rules: TestBed.inject(ExtensionRuleRegistry).registeredRuleIds(),
    });
    if ('invalid' in file) throw new Error(file.invalid);
    return resolveFormLayout(CLAIM_TYPE, file, [], VARIABLES).layout;
  }

  async function render(task: NuxeoTask = TASK) {
    fixture = TestBed.createComponent(TaskFormComponent);
    fixture.componentRef.setInput('onForm', (handedForm: NxsTaskForm | null) =>
      handed.push(handedForm),
    );
    fixture.componentRef.setInput('task', task);
    await settle();
  }

  beforeEach(() => {
    handed = [];
    taskFormFor = vi.fn();
    taskDocument = vi.fn(() => of(CLAIM));
    TestBed.configureTestingModule({
      imports: [TaskFormComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        {
          provide: DocumentLayoutService,
          useValue: {
            taskFormFor,
            taskDocument,
            vocabularyLabel: () => of(null),
            principalLabel: () => of(null),
          },
        },
        { provide: AppExtensionsService, useValue: { resolve: () => [] } },
        {
          provide: DirectoryService,
          useValue: { getEntries: () => of([]), getAllL10nEntries: () => of([]) },
        },
        { provide: RECORD_PAGE_TODAY, useValue: () => new Date('2026-11-23T12:00:00Z') },
        { provide: RECORD_PAGE_TIME_ZONE, useValue: '+0000' },
      ],
    });
    TestBed.inject(ExtensionRuleRegistry).registerRules(DOCUMENT_RULE_EVALUATORS);
    taskFormFor.mockImplementation(() => of(layout()));
  });

  it('reads the record the task is on, and draws the step’s form over it', async () => {
    await render();
    expect(taskDocument).toHaveBeenCalledWith('c1');
    expect(taskFormFor).toHaveBeenCalledWith(TASK, CLAIM);
    const headings = [...host().querySelectorAll('[role="heading"]')].map((node) =>
      node.textContent?.trim(),
    );
    expect(headings).toEqual(['Claim', 'Determination']);
  });

  it('shows the record’s own properties read-only, through their widgets', async () => {
    await render();
    expect(input$('claim:number')).toBeNull();
    const billed = host().querySelector(
      '.nxs-metadata-editor__read-only[data-xpath="claim:billedAmount"]',
    );
    expect(billed?.textContent).toContain('$1,200.00');
  });

  it('hands the panel its form once drawn', async () => {
    await render();
    expect(handed.filter((entry) => entry !== null)).toHaveLength(1);
  });

  it('hands no form for a step with none, and draws nothing', async () => {
    taskFormFor.mockImplementation(() => of(null));
    await render();
    expect(handed.every((entry) => entry === null)).toBe(true);
    expect(host().querySelector('nxs-metadata-editor')).toBeNull();
    expect(host().querySelector('nxs-spinner')).toBeNull();
  });

  it('hands nothing while the form is still found out', async () => {
    const pending = new Subject<ResolvedFormLayout | null>();
    taskFormFor.mockImplementation(() => pending);
    await render();
    expect(handed.every((entry) => entry === null)).toBe(true);
    // Most steps have no task form, so the panel's own form is not held up by a spinner.
    expect(host().querySelector('nxs-spinner')).toBeNull();
    pending.next(layout());
    await settle();
    expect(handed.at(-1)).not.toBeNull();
  });

  it('holds the step’s variables to their rules, then gives them by name', async () => {
    await render();
    expect(form().validate()).toBe(false);
    await type('var:decision', 'approve');
    expect(form().validate()).toBe(false);
    await type('var:allowedAmount', '1500');
    expect(form().validate()).toBe(false);
    await settle();
    expect(host().textContent).toContain('No more than the billed amount');
    await type('var:allowedAmount', '900');
    expect(form().validate()).toBe(true);
    expect(form().variables()).toEqual({ decision: 'approve', allowedAmount: 900 });
  });

  it('shows a variable by another’s value, and sends one only while it shows', async () => {
    await render();
    expect(input$('var:denialReason')).toBeNull();
    await type('var:decision', 'deny');
    await type('var:denialReason', 'Not covered');
    expect(form().variables()).toEqual({
      decision: 'deny',
      allowedAmount: null,
      denialReason: 'Not covered',
    });
    await type('var:decision', 'approve');
    expect(Object.keys(form().variables())).not.toContain('denialReason');
  });

  it('puts the server’s message for a variable beside its field, and hands back the rest', async () => {
    await render();
    const failure = {
      status: 422,
      error: {
        'entity-type': 'exception',
        message:
          "Constraint violation thrown on property var_determine:allowedAmount: 'Must be positive.'",
      },
    };
    expect(form().showFailure(failure)).toEqual([]);
    await settle();
    expect(host().textContent).toContain('Must be positive.');
    expect(
      form().showFailure({
        status: 400,
        error: { 'entity-type': 'validation_report', violations: [{ message: 'No route' }] },
      }),
    ).toEqual(['No route']);
  });

  it('says a failure that is not a validation failure is not one, for the panel to say', async () => {
    await render();
    expect(form().showFailure({ status: 500, error: { message: 'boom' } })).toBeNull();
  });

  it('is read-only while the task is being completed', async () => {
    await render();
    fixture.componentRef.setInput('disabled', true);
    await settle();
    expect(input$('var:decision')?.disabled).toBe(true);
  });

  it('withdraws the form when it goes away', async () => {
    await render();
    fixture.destroy();
    expect(handed.at(-1)).toBeNull();
  });

  it('fills the variables from the task, and the rules read them', async () => {
    await render({ ...TASK, variables: { decision: 'deny', denialReason: 'Lapsed' } });
    expect(input$('var:decision')?.value).toBe('deny');
    expect(input$('var:denialReason')?.value).toBe('Lapsed');
    expect(form().variables()).toEqual({
      decision: 'deny',
      allowedAmount: null,
      denialReason: 'Lapsed',
    });
  });

  it('never draws a form over the last task’s record while the next one is read', async () => {
    await render();
    expect(host().querySelector('nxs-metadata-editor')).not.toBeNull();
    const next = new Subject<NuxeoDocument | null>();
    taskDocument.mockReturnValue(next);
    fixture.componentRef.setInput('task', { ...TASK, id: 't2', targetDocumentIds: [{ id: 'c2' }] });
    await settle();
    expect(taskFormFor).not.toHaveBeenCalledWith(expect.objectContaining({ id: 't2' }), CLAIM);
    expect(host().querySelector('nxs-metadata-editor')).toBeNull();
  });

  it('reads a read-only variable as the task holds it: its rules and its text see it', async () => {
    // A later step shows the decision read-only, and the denial reason only for a denial.
    const LATER = {
      version: 2,
      cards: [
        {
          id: 'review',
          fields: [
            { field: 'var:decision', label: 'Decision', readOnlyWhen: decided('deny') },
            { field: 'var:denialReason', label: 'Denial reason', visibleWhen: decided('deny') },
          ],
        },
      ],
    };
    taskFormFor.mockImplementation(() => of(layout(LATER)));
    await render({ ...TASK, variables: { decision: 'deny', denialReason: 'Lapsed' } });
    const decision = host().querySelector(
      '.nxs-metadata-editor__read-only[data-xpath="var:decision"]',
    );
    expect(decision?.textContent).toContain('deny');
    expect(input$('var:denialReason')?.value).toBe('Lapsed');
    expect(form().variables()).toEqual({ denialReason: 'Lapsed' });
  });

  it('reads the record again for the next task on the same record, which a step may have changed', async () => {
    await render();
    fixture.componentRef.setInput('task', { ...TASK, id: 't2' });
    await settle();
    expect(taskDocument.mock.calls).toEqual([['c1'], ['c1']]);
  });

  it('keeps what was typed when the same task is fetched again, with the same variables', async () => {
    await render();
    await type('var:decision', 'approve');
    fixture.componentRef.setInput('task', { ...TASK, comments: [] });
    await settle();
    expect(input$('var:decision')?.value).toBe('approve');
    expect(taskDocument).toHaveBeenCalledTimes(1);
  });

  it('draws its sections at the heading level it is given', async () => {
    await render();
    fixture.componentRef.setInput('headingLevel', 3);
    await settle();
    expect(host().querySelector('[role="heading"]')?.getAttribute('aria-level')).toBe('3');
  });

  it('draws no form for a task on no record', async () => {
    await render({ ...TASK, targetDocumentIds: [] });
    expect(taskDocument).not.toHaveBeenCalled();
    expect(taskFormFor).not.toHaveBeenCalled();
    expect(handed.every((entry) => entry === null)).toBe(true);
  });
});
