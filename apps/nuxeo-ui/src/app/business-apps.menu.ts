import type { Injector } from '@angular/core';
import { HomeService, readNavigation, type MenuEntry } from '@agentic-ui/shared/home';
import { AppConfigService } from '@nuxeo/satori-platform/app-config';
import { QueueService, queueLink, readQueue } from '@agentic-ui/shared/queues';
import {
  APP_NAV_ITEMS,
  AppExtensionsService,
  EXTENSION_SLOTS,
  ExtensionRuleRegistry,
  ExtensionSlotRegistry,
  type NavItemDescriptor,
} from '@nuxeo/satori-platform/extensions';
import { catchError, firstValueFrom, forkJoin, map, of } from 'rxjs';

/**
 * An app's menu, `navigation.json` (docs/business-apps/app-definition-v2.md, section 9), joined to
 * the platform's: its entries for queues and for the home are added to the shell's menu, the
 * `navbar` slot, after the platform's own unless an entry's `order` places it among them.
 *
 * Joined rather than replacing, for now: section 13 leaves that choice to the shell that switches
 * apps, with the registry. An entry for a platform page, such as `app.navbar.tasks`, is therefore
 * not added, since the platform's own entry for it is in the menu already.
 *
 * Loaded once, at startup, by an `APP_INITIALIZER` that imports this file lazily
 * (`business-apps.menu-start.ts`), so neither engine is in the first bundle. At startup because
 * the `navbar` slot is a plain registry, not a signal: the shell's menu is worked out again when
 * the person or the address changes, not when an entry registers, so one registered after it is
 * first drawn would not show until then. Startup waits for the read: the menu's chunk, the file,
 * with the home's 10-second timeout, and then each unnamed queue's file, with the same. The file is
 * read past the interceptors, as `home.json` is; nothing on a server answers there yet, so the
 * platform's menu shows alone.
 *
 * Hiding an entry is not a security control: its address still answers, and a queue's page
 * provider still returns only what the person may read.
 */

/** The prefix of an app entry's ID in the `navbar` slot, so that no file can replace a platform entry. */
export const APP_MENU_ID_PREFIX = 'appMenu.';

/** What a queue is called in its own file, for an entry that has no name of its own. */
export interface QueueName {
  readonly label: string | null;
  readonly labelKey: string | null;
}

function warn(message: string): void {
  console.warn(`[agentic-ui-menu] ${message}`);
}

/**
 * The entries that open queues and have no literal name of their own: their queues' names are
 * read, to show where the entry has no `labelKey`, or one that does not resolve.
 */
export function unnamedQueues(entries: readonly MenuEntry[]): readonly string[] {
  return [
    ...new Set(
      entries.flatMap((entry) => (entry.queue !== null && !entry.label ? [entry.queue] : [])),
    ),
  ];
}

/**
 * The app's entries as the `navbar` slot holds them. A `label` wins over a `labelKey`, as in every
 * file of version 2; an entry for a queue with neither shows the queue's own name, or its id.
 */
export function appMenuItems(
  entries: readonly MenuEntry[],
  names: ReadonlyMap<string, QueueName>,
  tell: (message: string) => void = warn,
): NavItemDescriptor[] {
  return entries.flatMap((entry): NavItemDescriptor[] => {
    if (entry.queue === null && entry.page !== 'home') {
      tell(
        `navigation.json entry "${entry.id}" opens the platform page "${entry.page}", which has a menu entry of its own; not added`,
      );
      return [];
    }
    const name = entry.queue === null ? undefined : names.get(entry.queue);
    const fallback = entry.queue ?? entry.id;
    const text: Pick<NavItemDescriptor, 'label' | 'labelKey'> = entry.label
      ? { label: entry.label }
      : entry.labelKey
        ? { label: name?.label || fallback, labelKey: entry.labelKey }
        : name?.label
          ? { label: name.label }
          : name?.labelKey
            ? { label: fallback, labelKey: name.labelKey }
            : { label: fallback };
    return [
      {
        id: `${APP_MENU_ID_PREFIX}${entry.id}`,
        ...text,
        path: entry.queue === null ? '/home' : queueLink(entry.queue).join('/'),
        icon: entry.icon ?? (entry.queue === null ? 'home' : 'inbox'),
        ...(entry.order === null ? {} : { order: entry.order }),
        ...(entry.visibleWhen === null ? {} : { rule: entry.visibleWhen }),
      },
    ];
  });
}

/**
 * Reads `navigation.json` and adds its entries to the `navbar` slot. Never rejects: a menu that
 * cannot be read leaves the platform's, and the console says why.
 */
export async function registerAppMenu(injector: Injector): Promise<void> {
  try {
    // First: `HomeService` injects `NuxeoApiBase`, whose API origin is read from the configuration
    // once and kept, so resolving it before the configuration loads would pin the default for the
    // whole session (provide-app-config.ts, "Ordering note"). `load()` is the one shared request.
    await injector.get(AppConfigService).load();
    const load = await firstValueFrom(injector.get(HomeService).loadNavigation());
    if (load.kind === 'none') return;
    if (load.kind === 'unreadable') {
      warn(`navigation.json not loaded: ${load.reason}; the platform's menu shows`);
      return;
    }
    // The platform's entries register when the menu is first asked for: ask now, so that a page
    // entry naming one of them is known.
    injector.get(APP_NAV_ITEMS);
    const slots = injector.get(ExtensionSlotRegistry);
    const extensions = injector.get(AppExtensionsService);
    const rules = injector.get(ExtensionRuleRegistry).registeredRuleIds();
    // The pages: the entries registered in code, and those a manifest adds, which the slot
    // applies when it resolves and never registers.
    const added = extensions.config().slots?.[EXTENSION_SLOTS.navbar] ?? [];
    const read = readNavigation(load.content, {
      rules,
      pages: [...slots.registeredIds(EXTENSION_SLOTS.navbar), ...added.map((entry) => entry.id)],
    });
    if ('refused' in read) {
      for (const problem of read.refused) warn(`navigation.json refused: ${problem}`);
      return;
    }
    for (const problem of read.problems) warn(`navigation.json ${problem}`);
    const names = await queueNames(injector, unnamedQueues(read.entries), {
      rules,
      rowActions: slots.registeredIds(EXTENSION_SLOTS.rowActions),
      bulkActions: slots.registeredIds(EXTENSION_SLOTS['bulk-actions']),
    });
    extensions.register(EXTENSION_SLOTS.navbar, appMenuItems(read.entries, names));
  } catch (error) {
    warn(`navigation.json not applied: ${(error as Error)?.message ?? String(error)}`);
  }
}

/** Each queue's own name, from its file; none for a queue that is not served or is refused. */
async function queueNames(
  injector: Injector,
  ids: readonly string[],
  registered: Parameters<typeof readQueue>[1],
): Promise<ReadonlyMap<string, QueueName>> {
  if (ids.length === 0) return new Map();
  const queues = injector.get(QueueService);
  const named = await firstValueFrom(
    forkJoin(
      ids.map((id) =>
        queues.load(id).pipe(
          map((load): [string, QueueName] | null => {
            if (load.kind !== 'file') return null;
            const read = readQueue(load.content, registered);
            return 'queue' in read
              ? [id, { label: read.queue.label, labelKey: read.queue.labelKey }]
              : null;
          }),
          catchError(() => of(null)),
        ),
      ),
    ),
  );
  return new Map(named.filter((entry): entry is [string, QueueName] => entry !== null));
}
