/**
 * The app's menu, navigation.json, joined to the platform's (docs/business-apps/app-definition-v2.md,
 * section 9): which entries are added, with what text, address and rule, and what a menu that
 * cannot be read leaves.
 */
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { APP_BOOTSTRAP_CONFIG_URL, AppConfigService } from '@nuxeo/satori-platform/app-config';
import { HomeService } from '@agentic-ui/shared/home';
import { throwError } from 'rxjs';
import {
  APP_NAV_ITEMS,
  EXTENSION_SLOTS,
  ExtensionRuleContextService,
  ExtensionSlotRegistry,
  type NavItemDescriptor,
} from '@nuxeo/satori-platform/extensions';

import {
  APP_MENU_ID_PREFIX,
  appMenuItems,
  registerAppMenu,
  unnamedQueues,
} from './business-apps.menu';

type Entry = Parameters<typeof appMenuItems>[0][number];

/** The configuration service as the menu reads it: the manifest, once it has loaded. */
const manifest = signal<{ extensionLayers: readonly unknown[] }>({ extensionLayers: [] });
const config = { manifest, load: () => Promise.resolve() };

const turn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));

const entry = (keys: Partial<Entry>): Entry => ({
  id: 'x',
  label: null,
  labelKey: null,
  icon: null,
  order: null,
  queue: null,
  page: null,
  visibleWhen: null,
  ...keys,
});

describe('the app menu', () => {
  describe('appMenuItems', () => {
    it("adds a queue's entry at its page, showing the queue's own name when it has none", () => {
      const told: string[] = [];
      const items = appMenuItems(
        [
          entry({ id: 'unassigned', queue: 'unassigned-claims', icon: 'inbox', order: 25 }),
          entry({ id: 'open', queue: 'open-claims' }),
          entry({ id: 'mine', queue: 'my-claims', label: 'Mine', labelKey: 'payers.menu.mine' }),
          entry({ id: 'pending', queue: 'pending', labelKey: 'payers.menu.pending' }),
          entry({ id: 'named', queue: 'unassigned-claims', labelKey: 'payers.menu.named' }),
        ],
        new Map([
          [
            'unassigned-claims',
            { label: 'Unassigned claims', labelKey: 'payers.queue.unassigned' },
          ],
          ['open-claims', { label: null, labelKey: 'payers.queue.open' }],
        ]),
        (message) => told.push(message),
      );
      expect(items).toEqual([
        {
          id: `${APP_MENU_ID_PREFIX}unassigned`,
          label: 'Unassigned claims',
          path: '/queues/unassigned-claims',
          icon: 'inbox',
          order: 25,
        },
        {
          id: `${APP_MENU_ID_PREFIX}open`,
          label: 'open-claims',
          labelKey: 'payers.queue.open',
          path: '/queues/open-claims',
          icon: 'inbox',
        },
        // A label wins over a labelKey, as in every file of version 2.
        {
          id: `${APP_MENU_ID_PREFIX}mine`,
          label: 'Mine',
          path: '/queues/my-claims',
          icon: 'inbox',
        },
        {
          id: `${APP_MENU_ID_PREFIX}pending`,
          label: 'pending',
          labelKey: 'payers.menu.pending',
          path: '/queues/pending',
          icon: 'inbox',
        },
        // A labelKey that does not resolve falls back to the queue's own name, not its id.
        {
          id: `${APP_MENU_ID_PREFIX}named`,
          label: 'Unassigned claims',
          labelKey: 'payers.menu.named',
          path: '/queues/unassigned-claims',
          icon: 'inbox',
        },
      ] as NavItemDescriptor[]);
      expect(told).toEqual([]);
    });

    it('adds the home, and not a platform page, whose entry the menu has already', () => {
      const told: string[] = [];
      const rule = { type: 'app.rules.inGroup', parameters: ['claims-adjusters'] };
      const items = appMenuItems(
        [
          entry({ id: 'home', page: 'home', label: 'Home', visibleWhen: rule }),
          entry({ id: 'tasks', page: 'app.navbar.tasks', label: 'My tasks' }),
        ],
        new Map(),
        (message) => told.push(message),
      );
      expect(items).toEqual([
        {
          id: `${APP_MENU_ID_PREFIX}home`,
          label: 'Home',
          path: '/home',
          icon: 'home',
          rule,
        },
      ] as NavItemDescriptor[]);
      expect(told).toEqual([
        'navigation.json entry "tasks" opens the platform page "app.navbar.tasks", which has a menu entry of its own; not added',
      ]);
    });

    it('names only the queues whose entries have no name of their own', () => {
      expect(
        unnamedQueues([
          entry({ queue: 'a' }),
          entry({ queue: 'a' }),
          entry({ queue: 'b', label: 'B' }),
          entry({ queue: 'c', labelKey: 'c.key' }),
          entry({ page: 'home', label: 'Home' }),
        ]),
      ).toEqual(['a', 'c']);
    });
  });

  describe('registerAppMenu', () => {
    let http: HttpTestingController;
    let warnings: string[];

    beforeEach(() => {
      warnings = [];
      manifest.set({ extensionLayers: [] });
      spyOn(console, 'warn').and.callFake((message: unknown) => warnings.push(String(message)));
      TestBed.configureTestingModule({
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          { provide: APP_BOOTSTRAP_CONFIG_URL, useValue: '/agentic-ui-config/bootstrap.json' },
          { provide: AppConfigService, useValue: config },
        ],
      });
      http = TestBed.inject(HttpTestingController);
      const context = TestBed.inject(ExtensionRuleContextService);
      context.username.set('ada');
      context.groups.set(['claims-adjusters']);
    });

    afterEach(() => http.verify());

    const menu = (): string[] => TestBed.inject(APP_NAV_ITEMS)().map((item) => item.id);
    /** What the app registered, read from the registry: `APP_NAV_ITEMS` caches its first answer. */
    const appEntries = (): string[] =>
      TestBed.inject(ExtensionSlotRegistry)
        .registeredIds(EXTENSION_SLOTS.navbar)
        .filter((id) => id.startsWith(APP_MENU_ID_PREFIX));
    const register = (): Promise<void> => registerAppMenu(TestBed.inject(Injector));

    it("joins the app's entries to the platform's, each shown by its rule", async () => {
      const done = register();
      // The menu waits for the configuration first.
      await turn();
      http.expectOne('/agentic-ui-config/navigation.json').flush({
        version: 2,
        entries: [
          { id: 'home', label: 'Home', page: 'home' },
          {
            id: 'unassigned',
            queue: 'unassigned-claims',
            visibleWhen: { type: 'app.rules.inGroup', parameters: ['claims-adjusters'] },
          },
          {
            id: 'pending',
            label: 'Pending',
            queue: 'pending-determination',
            visibleWhen: { type: 'app.rules.inGroup', parameters: ['claims-supervisors'] },
          },
          { id: 'tasks', label: 'My tasks', page: 'app.navbar.tasks' },
        ],
      });
      // The one queue with no name of its own is read for its name, once the menu is read.
      await turn();
      http.expectOne('/agentic-ui-config/queues/unassigned-claims.json').flush({
        version: 2,
        label: 'Unassigned claims',
        pageProvider: 'payers_unassigned_claims',
        columns: ['claim:number'],
      });
      await done;
      const items = TestBed.inject(APP_NAV_ITEMS)();
      const app = items.filter((item) => item.id.startsWith(APP_MENU_ID_PREFIX));
      // The supervisors' queue is hidden from an adjuster; the platform's Tasks stays its own.
      expect(app.map((item) => [item.id, item.label, item.path])).toEqual([
        [`${APP_MENU_ID_PREFIX}home`, 'Home', '/home'],
        [`${APP_MENU_ID_PREFIX}unassigned`, 'Unassigned claims', '/queues/unassigned-claims'],
      ]);
      expect(menu()).toContain('app.navbar.tasks');
      expect(menu().filter((id) => id === 'app.navbar.tasks').length).toBe(1);
      // After the platform's own: no order of their own places them among them.
      expect(menu().slice(-2)).toEqual([
        `${APP_MENU_ID_PREFIX}home`,
        `${APP_MENU_ID_PREFIX}unassigned`,
      ]);
    });

    it("leaves the platform's menu alone when no menu is served, or one is refused", async () => {
      let done = register();
      // The menu waits for the configuration first.
      await turn();
      http
        .expectOne('/agentic-ui-config/navigation.json')
        .flush('', { status: 404, statusText: 'Not Found' });
      await done;
      expect(appEntries()).toEqual([]);
      expect(warnings).toEqual([]);

      done = register();
      // The menu waits for the configuration first.
      await turn();
      http
        .expectOne('/agentic-ui-config/navigation.json')
        .flush({ version: 1, entries: [{ id: 'home', label: 'Home', page: 'home' }] });
      await done;
      expect(appEntries()).toEqual([]);
      expect(warnings.some((w) => w.includes('navigation.json refused: version'))).toBeTrue();
    });

    it('knows a page a manifest adds, which the slot never registers', async () => {
      manifest.set({
        extensionLayers: [
          {
            slots: {
              navbar: [
                {
                  id: 'acme.navbar.reports',
                  label: 'Reports',
                  path: '/reports',
                  icon: 'grid_view',
                },
              ],
            },
          },
        ],
      });
      const done = register();
      // The menu waits for the configuration first.
      await turn();
      http.expectOne('/agentic-ui-config/navigation.json').flush({
        version: 2,
        entries: [{ id: 'reports', label: 'Reports', page: 'acme.navbar.reports' }],
      });
      await done;
      // Known, so not an `unknown` finding; a platform page, so not added.
      expect(warnings.some((w) => w.includes('is not registered'))).toBeFalse();
      expect(warnings).toContain(
        '[agentic-ui-menu] navigation.json entry "reports" opens the platform page "acme.navbar.reports", which has a menu entry of its own; not added',
      );
    });

    it('never rejects, so that a menu cannot stop the app starting', async () => {
      const done = register();
      // The menu waits for the configuration first.
      await turn();
      http
        .expectOne('/agentic-ui-config/navigation.json')
        .flush('', { status: 500, statusText: 'Server Error' });
      await expectAsync(done).toBeResolved();
      expect(warnings).toContain(
        "[agentic-ui-menu] navigation.json not loaded: HTTP 500; the platform's menu shows",
      );
    });
  });
  describe('registerAppMenu, when reading throws', () => {
    it('resolves anyway, and says why the menu was not applied', async () => {
      const warnings: string[] = [];
      spyOn(console, 'warn').and.callFake((message: unknown) => warnings.push(String(message)));
      TestBed.configureTestingModule({
        providers: [
          {
            provide: HomeService,
            useValue: { loadNavigation: () => throwError(() => new Error('the network is down')) },
          },
          { provide: AppConfigService, useValue: config },
        ],
      });
      await expectAsync(registerAppMenu(TestBed.inject(Injector))).toBeResolved();
      expect(warnings).toEqual([
        '[agentic-ui-menu] navigation.json not applied: the network is down',
      ]);
    });
  });
});
