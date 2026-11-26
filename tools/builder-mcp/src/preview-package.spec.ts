/**
 * `previewPackage` as an agent runs it: the real pipeline, then the real `scripts/dev-config.mjs`,
 * copied into a scratch checkout of its own so that the tests never write this checkout's dev
 * folder, and a stand-in dev server on this machine.
 */
import {
  watch,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  DEV_CONFIG_SCRIPT,
  SERVED,
  pagesOf,
  previewPackage,
  type PreviewOptions,
} from './preview-package.ts';
import { REPO_ROOT } from './validate-package.ts';
import { PIPELINE_TESTS_RUN } from './testing/unzip.ts';

const DEMO = join(REPO_ROOT, 'business-apps', 'packages', 'payers-claims-demo');
const DEFAULTS = join('nuxeo-agentic-core', 'src', 'main', 'resources', 'agentic-ui-config');
const scratch = mkdtempSync(join(tmpdir(), 'builder-mcp-preview-spec-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A checkout holding only what `dev-config.mjs` needs: itself and the platform's defaults. */
function checkout(name: string): { script: string; folder: string } {
  const root = join(scratch, name);
  mkdirSync(join(root, 'scripts'), { recursive: true });
  cpSync(DEV_CONFIG_SCRIPT, join(root, 'scripts', 'dev-config.mjs'));
  mkdirSync(join(root, DEFAULTS), { recursive: true });
  for (const layer of ['bootstrap', 'manifest'])
    cpSync(
      join(REPO_ROOT, DEFAULTS, `${layer}.defaults.json`),
      join(root, DEFAULTS, `${layer}.defaults.json`),
    );
  return {
    script: join(root, 'scripts', 'dev-config.mjs'),
    folder: join(root, 'apps', 'nuxeo-ui', 'public', 'agentic-ui-config'),
  };
}

const HOME = {
  version: 2,
  label: 'Claims',
  cards: [
    {
      id: 'unassigned',
      label: 'Unassigned claims',
      kpi: { pageProvider: 'payers_unassigned_claims' },
      queue: 'unassigned-claims',
    },
  ],
};
const NAVIGATION = {
  version: 2,
  entries: [
    { id: 'home', label: 'Home', icon: 'home', page: 'home' },
    { id: 'unassigned', icon: 'inbox', queue: 'unassigned-claims' },
  ],
};
const TASK = {
  version: 2,
  cards: [{ id: 'check', label: 'Check', fields: [{ field: 'var:comment', label: 'Comment' }] }],
};

/**
 * The demo package with its home and menu replaced by these smaller ones, and a task form and an
 * image added, which it does not have: every kind of file the preview serves, and one it cannot.
 */
/**
 * `path` named in the app's contribution to the app registry, as the pipeline's step 2 asks of a
 * file of the app definition: the demo's component names its own files, not those a test adds.
 */
function contribute(root: string, path: string): void {
  const component = join(root, '..', 'OSGI-INF', 'payers-claims-demo-config.xml');
  const xml = readFileSync(component, 'utf8');
  const app = '<app id="payers-claims" src="agentic-ui-config/app.json">';
  if (!xml.includes(app)) throw new Error("the demo's component does not contribute its app");
  writeFileSync(component, xml.replace(app, `${app}\n      <file path="${path}" />`));
}

function packageWith(name: string, change: (root: string) => void = () => undefined): string {
  const directory = join(scratch, name);
  cpSync(DEMO, directory, { recursive: true, filter: (path) => relative(DEMO, path) !== 'dist' });
  const root = join(directory, 'bundle', 'agentic-ui-config');
  const write = (file: string, content: unknown) => {
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), `${JSON.stringify(content, null, 2)}\n`);
  };
  write('home.json', HOME);
  write('navigation.json', NAVIGATION);
  write('tasks/claimReview.check.layout.json', TASK);
  contribute(root, 'tasks/claimReview.check.layout.json');
  mkdirSync(join(root, 'assets'), { recursive: true });
  writeFileSync(join(root, 'assets', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>\n');
  change(root);
  return directory;
}

function everyFile(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split('\\').join('/'))
    .sort();
}

const json = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

/** A dev server on this machine that answers the files of `folder`, as `nx serve` does. */
async function devServer(
  folder: string,
  answer: (file: string, bytes: Buffer | null) => Buffer | null = (_, bytes) => bytes,
): Promise<{ origin: string; server: Server; asked: string[] }> {
  const asked: string[] = [];
  const server = createServer((request, response) => {
    asked.push(`${request.method} ${request.url} ${request.headers.authorization ?? ''}`.trim());
    const file = decodeURIComponent((request.url ?? '').replace(/^\/agentic-ui-config\//, ''));
    // Only what is inside `folder` is served, as `nx serve` serves only its folder: a `..` in the
    // request does not climb out of it (CodeQL's js/path-injection).
    const root = resolve(folder);
    const path = resolve(root, ...file.split('/'));
    const inside = path.startsWith(root + sep);
    const bytes = answer(file, inside && existsSync(path) ? readFileSync(path) : null);
    if (bytes === null) response.writeHead(404).end('<!doctype html>');
    else response.writeHead(200, { 'content-type': 'application/json' }).end(bytes);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return { origin: `http://127.0.0.1:${address.port}`, server, asked };
}

/** A port nothing listens on: one that was free a moment ago. */
async function closedOrigin(): Promise<string> {
  const { origin, server } = await devServer(scratch);
  await new Promise((done) => server.close(done));
  return origin;
}

const options = (
  devConfig: { script: string; folder: string },
  origin: string,
  more: Partial<PreviewOptions> = {},
): PreviewOptions => ({
  roots: [REPO_ROOT, scratch],
  devConfig,
  devServer: origin,
  devServerWaitMs: 300,
  ...more,
});

describe.skipIf(!PIPELINE_TESTS_RUN)(
  'previewPackage (the pipeline needs unzip, which a Windows runner lacks)',
  () => {
    it('serves every file the dev server can serve, as config:dev writes them, and names the rest', async () => {
      const dev = checkout('serves');
      const directory = packageWith('serves-package');
      const root = join(directory, 'bundle', 'agentic-ui-config');
      const before = everyFile(directory);
      const { origin, server, asked } = await devServer(dev.folder);
      try {
        const preview = await previewPackage({ directory }, options(dev, origin));
        expect(preview.served).toBe(true);
        expect(preview.validation.passed).toBe(true);
        expect(preview.files.map((file) => file.file)).toEqual([
          'home.json',
          'labels/en.json',
          'layouts/Case/view.layout.json',
          'layouts/Claim/view.layout.json',
          'layouts/Member/metadata.layout.json',
          'layouts/Member/view.layout.json',
          'layouts/Provider/view.layout.json',
          'navigation.json',
          'queues/my-claims.json',
          'queues/open-appeals.json',
          'queues/pending-determination.json',
          'queues/unassigned-claims.json',
          'tasks/PayersClaimReview.determine.layout.json',
          'tasks/PayersClaimReview.supervisorApproval.layout.json',
          'tasks/claimReview.check.layout.json',
        ]);
        expect(preview.notServed.map((file) => file.file)).toEqual([
          'actions.json',
          'app.json',
          'assets/logo.svg',
        ]);
        expect(preview.notServed.find((file) => file.file === 'app.json')?.why).toContain(
          'app registry',
        );

        // What the dev folder holds is the package's, as config:dev writes it.
        expect(json(join(dev.folder, 'home.json'))).toEqual(HOME);
        expect(json(join(dev.folder, 'navigation.json'))).toEqual(NAVIGATION);
        expect(json(join(dev.folder, 'tasks', 'claimReview.check.layout.json'))).toEqual(TASK);
        expect(json(join(dev.folder, 'labels', 'en.json'))).toEqual(
          json(join(root, 'labels', 'en.json')),
        );
        expect(json(join(dev.folder, 'queues', 'unassigned-claims.json'))).toEqual(
          json(join(root, 'queues', 'unassigned-claims.json')),
        );
        expect(json(join(dev.folder, 'layouts', 'Claim', 'view.layout.json'))).toMatchObject({
          layer: 'layout',
          type: 'Claim',
          mode: 'view',
          content: json(join(root, 'layouts', 'Claim', 'view.layout.json')),
        });
        expect(json(join(dev.folder, 'layouts.json'))).toMatchObject({
          layouts: [
            { type: 'Case', mode: 'view' },
            { type: 'Claim', mode: 'view' },
            { type: 'Member', mode: 'metadata' },
            { type: 'Member', mode: 'view' },
            { type: 'Provider', mode: 'view' },
          ],
          labels: ['en'],
        });
        expect(existsSync(join(dev.folder, 'assets'))).toBe(false);
        expect(preview.command).toMatch(/^node .*dev-config\.mjs --home .*home\.json /);

        // The dev server was asked for each file, by GET, with no credential, and answered them all.
        expect(preview.devServer).toMatchObject({ answering: true, stale: [], stillServed: [] });
        expect(asked).toContain('GET /agentic-ui-config/home.json');
        expect(asked).toContain('GET /agentic-ui-config/tasks/claimReview.check.layout.json');
        expect(asked.every((line) => /^GET \/agentic-ui-config\/\S+$/.test(line))).toBe(true);

        // The addresses: the home first, then the queues and the tasks page.
        expect(preview.open).toBe(`${origin}/#/home`);
        expect(preview.pages.map((page) => page.url).filter(Boolean)).toEqual([
          `${origin}/#/home`,
          `${origin}/#/queues/my-claims`,
          `${origin}/#/queues/open-appeals`,
          `${origin}/#/queues/pending-determination`,
          `${origin}/#/queues/unassigned-claims`,
          `${origin}/#/tasks`,
        ]);
        expect(preview.pages.some((page) => page.what === 'the Claim record page')).toBe(true);

        // Nothing is left in the package: its dist/, made for the check, is gone with it.
        expect(everyFile(directory)).toEqual(before);
        expect(existsSync(join(directory, 'dist'))).toBe(false);
      } finally {
        server.close();
      }
    });

    it('serves nothing for a package the pipeline refuses, leaving the dev folder as it was', async () => {
      const dev = checkout('refused');
      mkdirSync(dev.folder, { recursive: true });
      writeFileSync(join(dev.folder, 'home.json'), '{"served":"before"}\n');
      const directory = packageWith('refused-package', (root) => {
        const layout = join(root, 'layouts', 'Claim', 'view.layout.json');
        writeFileSync(
          layout,
          readFileSync(layout, 'utf8').replace('"widget": "document-link"', '"widget": "calendar"'),
        );
      });
      const preview = await previewPackage({ directory }, options(dev, await closedOrigin()));
      expect(preview.served).toBe(false);
      expect(preview.validation.refusedAt?.step).toBe(2);
      expect(preview.validation.findings.map((finding) => finding.message)).toContain(
        'the widget "calendar" is not registered',
      );
      expect(preview.note).toContain('Not served');
      expect(everyFile(dev.folder)).toEqual(['home.json']);
      expect(readFileSync(join(dev.folder, 'home.json'), 'utf8')).toBe('{"served":"before"}\n');
      expect(existsSync(join(directory, 'dist'))).toBe(false);
    });

    it("has the pipeline unpack the zip inside the package's dist/, not the system's temporary folder", async () => {
      const dev = checkout('work-in');
      const directory = packageWith('work-in-package');
      mkdirSync(join(directory, 'dist'));
      const seen: string[] = [];
      const watcher = watch(join(directory, 'dist'), { recursive: true }, (_, name) => {
        if (name) seen.push(String(name));
      });
      try {
        await previewPackage({ directory }, options(dev, await closedOrigin()));
        await new Promise((done) => setTimeout(done, 200));
      } finally {
        watcher.close();
      }
      expect(
        seen.some((name) =>
          /builder-mcp-package-[^/\\]+[/\\]tmp[/\\]verify-package-zip-/.test(name),
        ),
      ).toBe(true);
      expect(everyFile(join(directory, 'dist'))).toEqual([]);
    });

    it('names, rather than passes, a file whose name the validator takes and config:dev does not', async () => {
      const dev = checkout('names');
      const directory = packageWith('names-package', (root) => {
        cpSync(join(root, 'labels', 'en.json'), join(root, 'labels', 'es-419.json'));
        contribute(root, 'labels/es-419.json');
      });
      const preview = await previewPackage({ directory }, options(dev, await closedOrigin()));
      expect(preview.validation.passed).toBe(true);
      expect(preview.served).toBe(true);
      expect(preview.notServed.find((file) => file.file === 'labels/es-419.json')?.why).toContain(
        'es-419 is not one',
      );
      expect(existsSync(join(dev.folder, 'labels', 'en.json'))).toBe(true);
      expect(existsSync(join(dev.folder, 'labels', 'es-419.json'))).toBe(false);
    });

    it('keeps a dist/ the package already has, and what is in it', async () => {
      const dev = checkout('dist');
      const directory = packageWith('dist-package');
      mkdirSync(join(directory, 'dist'));
      writeFileSync(join(directory, 'dist', 'kept.zip'), 'an earlier build');
      await previewPackage({ directory }, options(dev, await closedOrigin()));
      expect(everyFile(join(directory, 'dist'))).toEqual(['kept.zip']);
    });

    it('says when nothing answers at the dev server, and serves the package all the same', async () => {
      const dev = checkout('no-server');
      const directory = packageWith('no-server-package');
      const origin = await closedOrigin();
      const preview = await previewPackage({ directory }, options(dev, origin));
      expect(preview.served).toBe(true);
      expect(preview.devServer).toMatchObject({ origin, answering: false });
      expect(preview.devServer?.note).toContain('Start the dev server, npx nx serve nuxeo-ui');
      expect(existsSync(join(dev.folder, 'home.json'))).toBe(true);
    });

    it('names the files the dev server does not answer as written, and those it still answers once removed', async () => {
      const dev = checkout('stale');
      mkdirSync(join(dev.folder, 'queues'), { recursive: true });
      // Served before, and not by this package: the run removes it.
      writeFileSync(join(dev.folder, 'queues', 'old-queue.json'), '{"old":true}\n');
      const served = new Map([['queues/old-queue.json', Buffer.from('{"old":true}\n')]]);
      const directory = packageWith('stale-package');
      // A dev server that never saw the home, and still holds the queue it served before.
      const { origin, server } = await devServer(dev.folder, (file, bytes) =>
        file === 'home.json' ? null : (served.get(file) ?? bytes),
      );
      try {
        const preview = await previewPackage({ directory }, options(dev, origin));
        expect(preview.devServer).toMatchObject({
          answering: true,
          stale: ['home.json'],
          stillServed: ['queues/old-queue.json'],
        });
        expect(preview.devServer?.note).toContain('restart it (npx nx serve nuxeo-ui)');
        expect(preview.devServer?.note).toContain('another checkout or worktree');
        expect(existsSync(join(dev.folder, 'queues', 'old-queue.json'))).toBe(false);
      } finally {
        server.close();
      }
    });

    it('waits for a dev server whose watcher has not seen the files yet', async () => {
      const dev = checkout('watcher');
      const directory = packageWith('watcher-package');
      let misses = 2;
      const { origin, server } = await devServer(dev.folder, (file, bytes) =>
        file === 'home.json' && misses-- > 0 ? null : bytes,
      );
      try {
        const preview = await previewPackage(
          { directory },
          options(dev, origin, { devServerWaitMs: 3000 }),
        );
        expect(preview.devServer).toMatchObject({ answering: true, stale: [] });
      } finally {
        server.close();
      }
    });

    it('refuses a package that changed after it was validated, and serves the defaults alone', async () => {
      const dev = checkout('changed');
      const directory = packageWith('changed-package');
      // A script that edits the package, as an agent writing to it meanwhile would, then serves.
      const script = join(scratch, 'changed', 'scripts', 'changing.mjs');
      writeFileSync(
        script,
        `import { appendFileSync } from 'node:fs';\n` +
          `if (process.argv.length > 2) appendFileSync(${JSON.stringify(join(directory, 'bundle', 'agentic-ui-config', 'home.json'))}, ' ');\n` +
          `await import(${JSON.stringify(pathToFileURL(dev.script).href)});\n`,
      );
      await expect(
        previewPackage(
          { directory },
          options({ script, folder: dev.folder }, await closedOrigin()),
        ),
      ).rejects.toThrow(/changed while it was being previewed[^]*defaults alone/);
      expect(everyFile(dev.folder)).toEqual(['bootstrap.json', 'layouts.json', 'manifest.json']);
    });

    it('reports what config:dev refused, and serves the defaults alone', async () => {
      const dev = checkout('script-refuses');
      const directory = packageWith('script-refuses-package');
      // A script that refuses whatever it is given, as config:dev refuses a name it cannot serve.
      const script = join(scratch, 'script-refuses', 'scripts', 'refusing.mjs');
      writeFileSync(
        script,
        `if (process.argv.length > 2) { console.error('refused for the test'); process.exit(2); }\n` +
          `await import(${JSON.stringify(pathToFileURL(dev.script).href)});\n`,
      );
      await expect(
        previewPackage(
          { directory },
          options({ script, folder: dev.folder }, await closedOrigin()),
        ),
      ).rejects.toThrow(
        /config:dev did not serve [^]*exit 2[^]*refused for the test[^]*defaults alone/,
      );
      expect(everyFile(dev.folder)).toEqual(['bootstrap.json', 'layouts.json', 'manifest.json']);
    });

    it('gives config:dev no credential', async () => {
      const dev = checkout('environment');
      const directory = packageWith('environment-package');
      const seen = join(scratch, 'environment', 'seen.json');
      const script = join(scratch, 'environment', 'scripts', 'environment.mjs');
      writeFileSync(
        script,
        `import { writeFileSync } from 'node:fs';\n` +
          `if (process.argv.length > 2) writeFileSync(${JSON.stringify(seen)}, JSON.stringify(Object.keys(process.env)));\n` +
          `await import(${JSON.stringify(pathToFileURL(dev.script).href)});\n`,
      );
      const saved = { user: process.env['NUXEO_USER'], pass: process.env['NUXEO_PASS'] };
      process.env['NUXEO_USER'] = 'someone';
      process.env['NUXEO_PASS'] = 'not-to-be-passed';
      try {
        await previewPackage(
          { directory },
          options({ script, folder: dev.folder }, await closedOrigin()),
        );
      } finally {
        for (const [key, value] of [
          ['NUXEO_USER', saved.user],
          ['NUXEO_PASS', saved.pass],
        ] as const)
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
      }
      const keys = JSON.parse(readFileSync(seen, 'utf8')) as string[];
      expect(keys).toContain('PATH');
      expect(keys.filter((key) => key.startsWith('NUXEO_'))).toEqual([]);
    });
  },
);

describe('the names previewPackage passes to config:dev', () => {
  it('are the ones scripts/dev-config.mjs accepts, as it writes them', () => {
    const script = readFileSync(DEV_CONFIG_SCRIPT, 'utf8');
    const constant = (name: string): string => {
      const match = new RegExp(`const ${name} = /(.+)/;`).exec(script);
      if (!match) throw new Error(`dev-config.mjs has no ${name}`);
      return match[1];
    };
    const language = /!\/(\^\[a-z\][^/]*)\/\.test\(lang\)/.exec(script)?.[1];
    expect(SERVED.layoutType.source).toBe(constant('LAYOUT_TYPE'));
    expect(SERVED.layoutMode.source).toBe(constant('LAYOUT_MODE'));
    expect(SERVED.queue.source).toBe(constant('QUEUE_ID'));
    expect(SERVED.language.source).toBe(language);
    const part = constant('TASK_PART');
    expect(SERVED.task.source).toBe(`${part.slice(0, -1)}\\.${part.slice(1)}`);
  });
});

describe('the pages a preview names', () => {
  const origin = 'http://localhost:4200';
  const layout = (type: string, mode: string) => ({
    file: `layouts/${type}/${mode}.layout.json`,
    servedAt: `/agentic-ui-config/layouts/${type}/${mode}.layout.json`,
    what: `the ${type} layout`,
  });

  it('names each layout by what it draws: a record page, the Properties panel, a form', () => {
    const pages = pagesOf(origin, [
      layout('DamageClaim', 'view'),
      layout('DamageClaim', 'metadata'),
      layout('DamageClaim', 'edit'),
      layout('DamageClaim', 'create'),
    ]);
    expect(pages.map((page) => page.what)).toEqual([
      'the DamageClaim record page',
      "the DamageClaim record page's Properties panel",
      'the DamageClaim Edit form',
      'the DamageClaim Create form',
    ]);
    // No form is called a record page.
    expect(pages.filter((page) => /record page \(/.test(page.what))).toEqual([]);
    expect(pages[2].how).toContain('Open a DamageClaim record');
    expect(pages[2].how).toContain('Edit');
    expect(pages[3].how).toContain('new DamageClaim record');
    expect(pages.every((page) => page.url === null)).toBe(true);
  });
});

describe('previewPackage refuses before running anything', () => {
  it('a package outside the repository', async () => {
    const dev = checkout('outside');
    await expect(
      previewPackage(
        { directory: join(tmpdir(), 'no-such-package') },
        { devConfig: dev, devServer: 'http://127.0.0.1:1' },
      ),
    ).rejects.toThrow('is outside the repository, and is not read');
    expect(existsSync(dev.folder)).toBe(false);
  });

  it('a dev server it cannot ask', async () => {
    const dev = checkout('no-dev-server');
    await expect(
      previewPackage(
        { directory: DEMO },
        { devConfig: dev, devServer: { problem: 'DEV_SERVER_URL names example.com' } },
      ),
    ).rejects.toThrow('DEV_SERVER_URL names example.com');
    expect(existsSync(dev.folder)).toBe(false);
  });

  it('a folder with no app definition', async () => {
    const dev = checkout('no-definition');
    const directory = join(scratch, 'no-definition-package');
    mkdirSync(join(directory, 'bundle'), { recursive: true });
    await expect(
      previewPackage(
        { directory },
        { roots: [scratch], devConfig: dev, devServer: 'http://127.0.0.1:1' },
      ),
    ).rejects.toThrow('has no bundle/agentic-ui-config/');
    expect(existsSync(dev.folder)).toBe(false);
  });
});
