/**
 * The home engine: an app's `home.json` drawn as cards of KPIs, links to queues and lists of the
 * person's tasks and recent records, each shown by a rule
 * (docs/business-apps/app-definition-v2.md, section 10).
 */
export { HomePageComponent } from './lib/home-page/home-page';
export {
  HOME_LOAD_TIMEOUT_MS,
  HOME_QUEUE_LINK,
  HOME_TASKS_LINK,
  HomeService,
  homeFileUrl,
  navigationFileUrl,
  type HomeLoad,
} from './lib/home.service';
export {
  readNavigation,
  type MenuEntry,
  type NavigationRegistered,
  type ReadNavigation,
} from './lib/navigation-file';
export {
  MAX_RULE_LEVELS,
  readHome,
  refusedRule,
  type HomeCard,
  type HomeFile,
  type HomeKpi,
  type HomeRecent,
  type HomeTasks,
  type ReadHome,
} from './lib/home-file';
export { figureOf, requestKey, type Bucket, type Figure } from './lib/figures';
export { readable, recordItem, taskItem, type ListItem, type RouterTarget } from './lib/lists';
