import type { Routes } from '@angular/router';
import { HOME_QUEUE_LINK, HOME_TASKS_LINK, HomePageComponent } from '@agentic-ui/shared/home';
import { QueuePageComponent, queueLink } from '@agentic-ui/shared/queues';

/**
 * The tasks page, `/tasks`, and a task on it, `/tasks/<id>` (`app.routes.ts`), for the home's lists
 * of tasks: where the dashboard's and the drawer's tasks open too.
 */
export const tasksLink = (id?: string): string | readonly unknown[] =>
  id === undefined ? '/tasks' : ['/tasks', id];

/**
 * The pages an app definition draws (docs/business-apps/app-definition-v2.md): its home and its
 * queues. Loaded only when one of them is opened, through `app.routes.ts`, so neither engine is in
 * the application's first bundle. Here rather than in `app.routes.ts` because the home's link to a
 * queue is a provider: naming its token there would import the home engine statically, beside the
 * import that loads it lazily.
 */

/** `/home`. Its links to queues open the queue page below, and its tasks the tasks page. */
export const homeRoutes: Routes = [
  {
    path: '',
    component: HomePageComponent,
    providers: [
      { provide: HOME_QUEUE_LINK, useValue: queueLink },
      { provide: HOME_TASKS_LINK, useValue: tasksLink },
    ],
  },
];

/** `/queues/<id>`: the queue `queues/<id>.json`. */
export const queueRoutes: Routes = [{ path: ':id', component: QueuePageComponent }];
