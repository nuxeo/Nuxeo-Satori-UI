import { signal } from '@angular/core';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { of, throwError } from 'rxjs';
import { action } from 'storybook/actions';
import { expect, fn, userEvent, within } from 'storybook/test';

import {
  CURRENT_USERNAME,
  DocumentDetailService,
  TaskService,
  UserService,
  WorkflowService,
  type NuxeoTask,
} from '@nuxeo/satori-platform/nuxeo-client';

import type { NxsHeadingLevel } from '../heading-level';
import { NxsTaskDetailComponent } from './task-detail.component';

/**
 * Compodoc records `NxsHeadingLevel` as `"1" | … | "6"`, so the control Storybook infers from it
 * sets a string; this select sets the numbers the input takes.
 */
const HEADING_LEVELS: readonly NxsHeadingLevel[] = [1, 2, 3, 4, 5, 6];
const DAY = 86_400_000;

const REVIEW: NuxeoTask = {
  id: 'task-review',
  name: 'wf.parallelDocumentReview.documentReview',
  directive: 'wf.parallelDocumentReview.consolidateReview',
  workflowInstanceId: 'wf-1',
  workflowModelName: 'ParallelDocumentReview',
  workflowTitle: 'wf.parallelDocumentReview.ParallelDocumentReview',
  created: '2026-11-01T09:00:00.000Z',
  dueDate: new Date(Date.now() + 3 * DAY + 3_600_000).toISOString(),
  state: 'opened',
  nodeName: 'review',
  targetDocumentIds: [{ uid: 'doc-1', title: 'Supplier contract' }],
  actors: [{ id: 'jdoe' }, { id: 'group:legal' }],
  delegatedActors: [{ id: 'user:asmith' }],
  comments: [{ author: 'jdoe', text: 'Clause 4 needs a second look.', date: '2026-11-02' }],
  variables: {},
  taskInfo: {
    taskActions: [
      { name: 'approve', label: 'wf.parallelDocumentReview.approve' },
      { name: 'reject', label: 'wf.parallelDocumentReview.reject' },
    ],
  },
};

const CHOOSE_PARTICIPANTS: NuxeoTask = {
  ...REVIEW,
  id: 'task-choose',
  name: 'wf.serialDocumentReview.chooseParticipants',
  directive: 'wf.serialDocumentReview.pleaseSelect',
  delegatedActors: [],
  comments: [],
  taskInfo: {
    taskActions: [
      { name: 'cancel', label: 'wf.serialDocumentReview.cancel', validate: false },
      { name: 'start_review', label: 'wf.serialDocumentReview.startReview', validate: true },
    ],
  },
};

const OVERDUE: NuxeoTask = {
  ...REVIEW,
  id: 'task-overdue',
  dueDate: new Date(Date.now() - 2 * DAY - 3_600_000).toISOString(),
  delegatedActors: [],
  comments: [],
};

/** The panel over services that answer from memory. `refuse` makes every write fail. */
const withServices = (refuse = false) =>
  applicationConfig({
    providers: [
      {
        provide: TaskService,
        useValue: {
          completeTask: (...args: unknown[]) => {
            action('completeTask')(args);
            return refuse
              ? throwError(() => ({
                  error: { message: 'This task was completed by someone else.' },
                }))
              : of(REVIEW);
          },
          delegateTask: (...args: unknown[]) => {
            action('delegateTask')(args);
            return of(undefined);
          },
          reassignTask: (...args: unknown[]) => {
            action('reassignTask')(args);
            return of(undefined);
          },
          notifyTasksChanged: () => action('notifyTasksChanged')(),
        },
      },
      {
        provide: WorkflowService,
        useValue: {
          cancelWorkflow: (id: string) => {
            action('cancelWorkflow')(id);
            return of(undefined);
          },
          getWorkflowGraph: () =>
            of({
              nodes: [
                { id: 'start', title: 'Choose participants', state: 'done' },
                { id: 'review', title: 'Review' },
                { id: 'consolidate', title: 'Consolidate' },
              ],
            }),
        },
      },
      { provide: CURRENT_USERNAME, useValue: signal('jdoe') },
      {
        provide: UserService,
        useValue: { searchUsers: () => of([]), searchGroups: () => of([]) },
      },
      {
        provide: DocumentDetailService,
        useValue: {
          searchUsersGroups: () =>
            of([
              {
                id: 'asmith',
                displayLabel: 'Alex Smith',
                type: 'USER_TYPE',
                prefixed_id: 'user:asmith',
              },
              {
                id: 'legal',
                displayLabel: 'Legal team',
                type: 'GROUP_TYPE',
                prefixed_id: 'group:legal',
              },
            ]),
        },
      },
    ],
  });

const meta: Meta<NxsTaskDetailComponent> = {
  title: 'Components/Task detail',
  component: NxsTaskDetailComponent,
  tags: ['autodocs'],
  decorators: [withServices()],
  args: { task: REVIEW, headingLevel: 3, taskDone: fn(), taskChanged: fn() },
  argTypes: { headingLevel: { control: 'select', options: HEADING_LEVELS } },
  parameters: {
    docs: {
      api: { types: ['NxsTaskOutcome'] },
      source: {
        language: 'html',
        code: `<nxs-task-detail
  [task]="task"
  [taskDone]="moveOn"
  [taskChanged]="reload"
/>`,
      },
    },
  },
};

export default meta;

type Story = StoryObj<NxsTaskDetailComponent>;

/** A review step: its actions, the people on it, what is due, and its comments. */
export const Review: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Approve' }));
    await expect(args.taskDone).toHaveBeenCalledWith(REVIEW, 'completed');
  },
};

/** The first step of a review: choose who takes part, and how. */
export const ChooseParticipants: Story = {
  args: { task: CHOOSE_PARTICIPANTS },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('combobox', { name: 'Participants' })).toBeVisible();
  },
};

/** A task past its due date says by how long. */
export const Overdue: Story = {
  args: { task: OVERDUE },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('2 days overdue')).toBeVisible();
  },
};

/** The workflow graph, opened from the panel, with the task's own step marked. */
export const WorkflowGraph: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'View Graph' }));
    await expect(await canvas.findByText('Consolidate')).toBeVisible();
  },
};

/** The delegate panel: choose users or groups to share the task with. */
export const Delegate: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Delegate' }));
    await expect(await canvas.findByRole('heading', { name: 'Delegate Task' })).toBeVisible();
  },
};

/** Nuxeo refuses the action: the task stays and the actions come back. */
export const CompletionRefused: Story = {
  decorators: [withServices(true)],
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const approve = await canvas.findByRole('button', { name: 'Approve' });
    await userEvent.click(approve);
    await expect(args.taskDone).not.toHaveBeenCalled();
    await expect(approve).toBeEnabled();
  },
};
