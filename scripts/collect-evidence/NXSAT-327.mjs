/**
 * NXSAT-327 slice 1 — the tasks page's task panel becomes the library component `nxs-task-detail`,
 * rendered by its registered ID `nxs.components.taskDetail`, and completing a task goes through it.
 *
 * Seed data lives only under the ticket's data root: two Notes, NXSAT327_DOC_A and NXSAT327_DOC_B.
 * Every run cancels the workflows on those two documents (only this ticket starts any there) and
 * starts a fresh Serial document review, so both halves begin from the same open task and the
 * before half cannot use up the task the after half completes.
 */

const DOC_A = process.env['NXSAT327_DOC_A'] ?? '06551048-ee78-43fd-a014-86f76c70c325';
const APP = process.env['APP_URL'] ?? 'http://localhost:4233';
const api = (path) => `${APP}/nuxeo/api/v1${path}`;

const PANEL = '.task-form-panel';
const DETAIL = `${PANEL} nxs-task-detail`;
const TOAST = 'mat-snack-bar-container';
const REFUSAL = 'Simulated server refusal (NXSAT-327 evidence)';

/** The task the run opens; set by the first scene. */
let taskId = '';

/** Cancels this ticket's workflows on `uid`, starts a Serial document review, returns its task. */
async function freshTask(page, uid) {
  const running = await (await page.request.get(api(`/id/${uid}/@workflow`))).json();
  for (const wf of running.entries ?? []) await page.request.delete(api(`/workflow/${wf.id}`));
  await page.request.post(api(`/id/${uid}/@workflow`), {
    headers: { 'Content-Type': 'application/json' },
    data: { 'entity-type': 'workflow', workflowModelName: 'SerialDocumentReview' },
  });
  const tasks = await (await page.request.get(api(`/id/${uid}/@task`))).json();
  return tasks.entries?.[0]?.id ?? '';
}

/** The button inside the library component whose accessible name matches `name`. */
const detailButton = (page, name) =>
  page.locator('nxs-task-detail').getByRole('button', { name, exact: true });

export const summary =
  "The tasks page's task panel — reading a task and completing it — is the Satori library " +
  'component nxs-task-detail, rendered by its registered ID nxs.components.taskDetail';

export const scenes = [
  {
    act: 1,
    title: 'Open a review task waiting on the user',
    intent:
      'A reviewer opens the first step of a Serial document review on a Note, the "choose ' +
      'participants" task, from the Tasks page',
    criterion: 'AC-2',
    spotlight: { selector: PANEL, label: 'Task panel' },
    async run(page, h) {
      await h.login();
      taskId = await freshTask(page, DOC_A);
      h.requirePrecondition('a fresh review task exists on the seeded Note', !!taskId, 'no task');
      await h.goTo(`/#/tasks/${taskId}`);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await h.expectVisible('the tasks page renders the task panel', PANEL);
      await h.expectText(
        'the header names the task document',
        'sat-header-bar',
        'NXSAT-327 review A',
      );
      await h.shot('01-task-open', { highlight: PANEL, label: 'Task panel' });
    },
  },

  {
    act: 2,
    title: 'Look at what renders the task panel',
    intent:
      'The panel should be the library component, resolved through the registered ID so a ' +
      'customer library can replace it',
    criterion: 'AC-1',
    hold: 2500,
    spotlight: { selector: PANEL, label: 'nxs-task-detail' },
    async run(page, h) {
      await h.expectVisible('the task panel is nxs-task-detail', DETAIL, 5000);
      const byId = await page.evaluate(
        () => !!document.querySelector('.task-form-panel lib-extension-outlet > nxs-task-detail'),
      );
      h.check('it is placed by lib-extension-outlet, not by the fallback', byId);
      await h.expectText(
        'it shows the task directive',
        `${DETAIL} [role="heading"]`,
        'Please Select',
      );
      h.check(
        'it offers the actions the server returned',
        (await detailButton(page, 'Start Review').count()) === 1 &&
          (await detailButton(page, 'Cancel').count()) === 1,
      );
      await h.expectVisible(
        'participants are chosen with nxs-user-group-picker',
        `${DETAIL} nxs-user-group-picker`,
        3000,
      );
      await h.shot('02-panel-component', { highlight: PANEL, label: 'nxs-task-detail' });
    },
  },

  {
    act: 2,
    title: 'Open the workflow graph from the panel',
    intent: 'The panel keeps everything it did on the page: here, the workflow graph',
    criterion: 'AC-4',
    async run(page, h) {
      const graph = detailButton(page, 'View Graph');
      if (h.check('the panel offers View Graph', (await graph.count()) === 1)) {
        await graph.click();
        await h.expectVisible(
          'the graph lists its nodes',
          `${DETAIL} .nxs-task-detail__graph-node`,
        );
      }
      h.check(
        'the panel offers Delegate and Reassign',
        (await detailButton(page, 'Delegate').count()) === 1 &&
          (await detailButton(page, 'Reassign').count()) === 1,
      );
      await h.shot('03-graph', { highlight: PANEL, label: 'Workflow graph' });
    },
  },

  {
    act: 2,
    title: 'The server refuses the completion',
    intent:
      'When Nuxeo rejects the action the task must stay open, the reason must be shown, and ' +
      'the buttons must come back',
    criterion: 'AC-3',
    async run(page, h) {
      await page.route(`**/api/v1/task/${taskId}/start_review`, (route) =>
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ message: REFUSAL }),
        }),
      );
      const start = detailButton(page, 'Start Review');
      if (h.check('Start Review is in nxs-task-detail', (await start.count()) === 1)) {
        await start.click();
        await h.expectText('the refusal is shown as a toast', TOAST, REFUSAL);
        h.check('Start Review is enabled again', await start.isEnabled());
      }
      h.check('the task is still selected', page.url().includes(taskId));
      await h.shot('04-refused', { highlight: PANEL, label: 'Refused completion' });
      await page.unroute(`**/api/v1/task/${taskId}/start_review`);
      await page
        .locator(TOAST)
        .waitFor({ state: 'detached', timeout: 10_000 })
        // A toast still showing only delays the next scene; it asserts its own toast by text.
        .catch(() => {});
    },
  },

  {
    act: 2,
    title: 'Complete the task with a comment',
    intent: 'The reviewer starts the review; the task leaves the inbox and the page moves on',
    criterion: 'AC-3',
    hold: 2500,
    async run(page, h) {
      const comment = page.locator('nxs-task-detail').getByRole('textbox', { name: 'Comment' });
      const start = detailButton(page, 'Start Review');
      if (
        h.check(
          'the comment field and Start Review are in nxs-task-detail',
          (await start.count()) === 1,
        )
      ) {
        await comment.fill('Started by the NXSAT-327 evidence run');
        const [response] = await Promise.all([
          page.waitForResponse((r) => r.url().includes(`/task/${taskId}/start_review`)),
          start.click(),
        ]);
        h.check(
          'Nuxeo accepted the completion',
          response.status() === 200,
          `HTTP ${response.status()}`,
        );
        await h.expectText('the user is told it completed', TOAST, 'completed');
        await page
          .waitForFunction((id) => !location.hash.includes(id), taskId, { timeout: 10_000 })
          // A timeout is judged by the check below, which reads the URL itself.
          .catch(() => {});
        h.check('the page left the completed task', !page.url().includes(taskId));
      }
      const after = await (await page.request.get(api(`/task/${taskId}`))).json().catch(() => ({}));
      h.check(
        'the server no longer has the task open',
        after?.state !== 'opened',
        `state ${after?.state}`,
      );
      await h.shot('05-completed', { highlight: PANEL, label: 'After completion' });
    },
  },

  {
    act: 3,
    title: 'The registered entry points are unchanged',
    intent:
      'The Tasks nav entry still routes to /tasks and document detail still offers Start Process',
    criterion: 'AC-5',
    async run(page, h) {
      const nav = '[data-nav-id="app.navbar.tasks"]';
      if (await h.expectVisible('the shell renders app.navbar.tasks', nav)) {
        await page.locator(nav).click();
        await page
          .waitForFunction(() => location.hash.startsWith('#/tasks'), null, {
            timeout: 10_000,
          })
          // A timeout is judged by the check below, which reads the URL itself.
          .catch(() => {});
        h.check('app.navbar.tasks routes to /tasks', /#\/tasks/.test(page.url()), page.url());
      }
      await h.goToDoc(DOC_A);
      const more = page.getByRole('button', { name: /more actions/i }).first();
      if (await more.count()) await more.click();
      await h.expectVisible(
        'document detail renders app.toolbar.startProcess',
        '[data-action-id="app.toolbar.startProcess"]',
      );
      await h.shot('06-start-process-unchanged', {
        highlight: '[data-action-id="app.toolbar.startProcess"]',
        label: 'app.toolbar.startProcess',
      });
      await page.keyboard.press('Escape');
      // The dev server has no configuration servlet and no logout endpoint; both 404 in every run.
      h.expectNoConsoleErrors('no browser console errors', [
        '/agentic-ui-config/bootstrap.json',
        '/agentic-ui-config/manifest.json',
        '/agentic-ui-config/layouts.json',
        '/nuxeo/logout',
        // The refusal scene 4 fulfils on purpose; scene 5 asserts the real completion's 200.
        /HTTP 500 \/nuxeo\/api\/v1\/task\/[^/]+\/start_review/,
      ]);
    },
  },
];
