import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import appActionGenerator from '../app-action/generator';
import appLayoutGenerator from '../app-layout/generator';
import { readModel, schemasOf } from '../app-layout/content-model';
import appQueueGenerator from '../app-queue/generator';
import appPackageGenerator from './generator';
import { CONTRACTS_MODEL, flush, PAYERS_MODEL, pipeline, validate } from './testing/scaffold';

/**
 * What the four generators write, held to the two judges a package meets: the validator of
 * `libs/shared/app-definition` and the package pipeline, `scripts/app-package.mjs`. Both run as
 * commands, as CI and the Builder MCP server run them, on the files written to disk.
 *
 * A scaffold must pass both; each broken copy of it must be refused, at its own step, for its own
 * reason. The pipeline reads the zip back with the system's `unzip`, which a Windows runner lacks.
 */
const ROOT = 'business-apps/packages/acme-contracts';
const PLATFORM = '0.2.0';

/** The whole scaffold: a package with a Contract page, a Counterparty page, a queue, two actions. */
async function scaffold(tree: Tree): Promise<void> {
  await appPackageGenerator(tree, {
    name: 'acme-contracts',
    owner: 'acme',
    title: 'Acme Contracts',
    platform: '>=0.2.0 <1.0.0',
    groups: 'contract-managers,legal',
    type: 'Contract',
    model: CONTRACTS_MODEL,
  });
  await appLayoutGenerator(tree, { package: ROOT, type: 'Counterparty', model: CONTRACTS_MODEL });
  await appQueueGenerator(tree, {
    package: ROOT,
    id: 'open-contracts',
    pageProvider: 'acme_open_contracts',
    columns: 'contract:number,dc:title,contract:end',
    sort: 'contract:end',
    pageSize: 50,
  });
  await appActionGenerator(tree, {
    package: ROOT,
    id: 'acme-contracts.approve',
    transition: 'approve',
    on: 'record,row',
    type: 'Contract',
    icon: 'check',
    confirm: 'Approve this contract?',
    success: 'The contract is approved.',
    queue: 'open-contracts',
  });
  await appActionGenerator(tree, {
    package: ROOT,
    id: 'acme-contracts.assignToMe',
    label: 'Assign to me',
    operation: 'Acme.AssignToCurrentUser',
    parameters: '{ "notify": true }',
    on: 'bulk',
    queue: 'open-contracts',
  });
}

describe.skipIf(process.platform === 'win32')(
  'a scaffolded package, held to the validator and the pipeline',
  () => {
    let scratch: string;
    let tree: Tree;
    /** A fresh copy of the scaffold on disk, which a test may break. */
    let copies = 0;
    const copy = (): string => {
      const target = join(scratch, `copy-${++copies}`);
      flush(tree, ROOT, target);
      return target;
    };
    const config = (directory: string, file: string): string =>
      join(directory, 'bundle', 'agentic-ui-config', file);
    const edit = (path: string, change: (json: Record<string, unknown>) => void): void => {
      const json = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
      change(json);
      writeFileSync(path, JSON.stringify(json, null, 2));
    };
    let allowList: string;
    const flags = (...extra: string[]): string[] => [
      '--platform',
      PLATFORM,
      '--model',
      CONTRACTS_MODEL,
      '--allow-list',
      allowList,
      ...extra,
    ];

    beforeAll(async () => {
      scratch = mkdtempSync(join(tmpdir(), 'app-generators-'));
      allowList = join(scratch, 'allow-list.json');
      writeFileSync(allowList, JSON.stringify({ operations: ['Acme.AssignToCurrentUser'] }));
      tree = createTreeWithEmptyWorkspace();
      await scaffold(tree);
    });

    afterAll(() => {
      rmSync(scratch, { recursive: true, force: true });
    });

    it('passes the validator, every file, held to the content model', () => {
      const directory = copy();
      const run = validate(join(directory, 'bundle', 'agentic-ui-config'), flags());
      expect(run.output).toContain('2 layouts were held to the content model');
      expect(run.output).toContain('6 files: 6 passed, 0 refused.');
      expect(run.status).toBe(0);
    });

    it('passes the pipeline: checked, built and verified, with its checksum', () => {
      const directory = copy();
      const run = pipeline(directory, flags('--out', join(directory, 'out')));
      expect(run.output).toContain('acme-contracts 0.1.0: checked, built and verified');
      expect(run.status).toBe(0);
      expect(existsSync(join(directory, 'out', 'acme-contracts-0.1.0.zip'))).toBe(true);
      expect(existsSync(join(directory, 'out', 'acme-contracts-0.1.0.zip.sha256'))).toBe(true);
    });

    it('passes the pipeline with no content model, as CI gives none, once its operation is allowed', () => {
      const directory = copy();
      const run = pipeline(directory, ['--platform', PLATFORM, '--allow-list', allowList]);
      expect(run.status).toBe(0);
    });

    describe('a broken copy is refused, at its own step', () => {
      /** The pipeline's verdict on a copy broken by `breakIt`, which must exit 1 at `step`. */
      const refused = (
        breakIt: (directory: string) => void,
        step: number,
        extra = flags(),
      ): string => {
        const directory = copy();
        breakIt(directory);
        const run = pipeline(directory, [...extra, '--out', join(directory, 'out')]);
        expect(run.output).toContain(`step ${step} refused it`);
        expect(run.status).toBe(1);
        expect(existsSync(join(directory, 'out', 'acme-contracts-0.1.0.zip'))).toBe(false);
        return run.output;
      };

      it('a widget the platform does not have, at step 2, naming the file and the place', () => {
        const output = refused(
          (directory) =>
            edit(config(directory, 'layouts/Contract/view.layout.json'), (layout) => {
              const cards = layout['cards'] as { fields: unknown[] }[];
              cards[0].fields[0] = { field: 'contract:number', widget: 'calendar' };
            }),
          2,
        );
        expect(output).toContain('layouts/Contract/view.layout.json');
        expect(output).toContain(
          'cards[0].fields[0].widget: the widget "calendar" is not registered [unknown]',
        );
      });

      it('a widget that does not show its property, at step 2, only once given the model', () => {
        const breakIt = (directory: string) =>
          edit(config(directory, 'layouts/Contract/view.layout.json'), (layout) => {
            const cards = layout['cards'] as { fields: unknown[] }[];
            cards[0].fields[0] = { field: 'contract:number', widget: 'date' };
          });
        expect(refused(breakIt, 2)).toContain(
          'the widget "date" does not show "contract:number", a string property',
        );
        // The same file, with no model, is built: it is the model that refuses it.
        const directory = copy();
        breakIt(directory);
        expect(
          pipeline(directory, ['--platform', PLATFORM, '--allow-list', allowList]).status,
        ).toBe(0);
      });

      it('a property the type does not have, at step 2', () => {
        expect(
          refused(
            (directory) =>
              edit(config(directory, 'layouts/Counterparty/view.layout.json'), (layout) => {
                (layout['cards'] as { fields: unknown[] }[])[0].fields.push('contract:number');
              }),
            2,
          ),
        ).toContain('"contract:number" is not a property of the type "Counterparty"');
      });

      it("a queue's row action that no file defines, at step 2", () => {
        expect(
          refused(
            (directory) =>
              edit(config(directory, 'queues/open-contracts.json'), (queue) => {
                queue['rowActions'] = ['acme-contracts.archive'];
              }),
            2,
          ),
        ).toContain('rowActions[0]: the row action "acme-contracts.archive" is not registered');
      });

      it('an operation the deployment has not allowed, at step 2', () => {
        expect(refused(() => undefined, 2, ['--platform', PLATFORM])).toContain(
          'the operation "Acme.AssignToCurrentUser" is not on this deployment\'s allow-list',
        );
      });

      it('an action that is both a transition and an operation, at step 2', () => {
        const output = refused(
          (directory) =>
            edit(config(directory, 'actions.json'), (file) => {
              (file['actions'] as Record<string, unknown>[])[0]['operation'] =
                'Acme.AssignToCurrentUser';
            }),
          2,
        );
        expect(output).toContain(
          'actions[0]: an action has "transition" or "operation", one of the two',
        );
      });

      it('a layout the component contributes from another file, at step 2', () => {
        const component = (directory: string) =>
          join(directory, 'bundle', 'OSGI-INF', 'acme-contracts-config.xml');
        expect(
          refused((directory) => {
            const xml = readFileSync(component(directory), 'utf8');
            writeFileSync(
              component(directory),
              xml.replace(
                'src="agentic-ui-config/layouts/Contract/view.layout.json"',
                'src="agentic-ui-config/contract.json"',
              ),
            );
          }, 2),
        ).toContain('contributes the Contract/view layout from agentic-ui-config/contract.json');
      });

      it('an app whose platform range leaves this platform out, at step 2', () => {
        expect(
          refused(
            (directory) =>
              edit(config(directory, 'app.json'), (app) => {
                app['platform'] = '>=0.3.0 <1.0.0';
              }),
            2,
          ),
        ).toContain('0.2.0');
      });

      it("app.json's version that is not package.xml's, at step 3", () => {
        expect(
          refused(
            (directory) =>
              edit(config(directory, 'app.json'), (app) => {
                app['packageVersion'] = '0.1.1';
              }),
            3,
          ),
        ).toContain("app.json's packageVersion is 0.1.1, and package.xml's version is 0.1.0");
      });

      it('a builder that is not the generator’s, byte for byte, at step 1', () => {
        expect(
          refused((directory) => {
            const builder = join(directory, 'build.mjs');
            writeFileSync(builder, `${readFileSync(builder, 'utf8')}\n`);
          }, 1),
        ).toContain("build.mjs is not the generator's, byte for byte");
      });
    });

    it('a package with no record page is refused at step 5: it contributes nothing', async () => {
      const bare = createTreeWithEmptyWorkspace();
      await appPackageGenerator(bare, {
        name: 'acme-bare',
        owner: 'acme',
        platform: '>=0.2.0 <1.0.0',
      });
      const directory = join(scratch, 'bare');
      flush(bare, 'business-apps/packages/acme-bare', directory);
      expect(
        validate(join(directory, 'bundle', 'agentic-ui-config'), ['--platform', PLATFORM]).status,
      ).toBe(0);
      const run = pipeline(directory, ['--platform', PLATFORM]);
      expect(run.output).toContain('so the package contributes no configuration');
      expect(run.output).toContain('step 5 refused it');
      expect(run.status).toBe(1);
    });
  },
);

/**
 * The layout generator reads the model with a reader of its own (`content-model.ts`), which must
 * agree with the validator's. A layout of every type of a real model, every one of its schemas
 * shown, is held to that model by the validator: a property this reader put on a type that the
 * validator's does not, or a widget it chose that does not show the property, is a finding.
 */
describe.skipIf(process.platform === 'win32')(
  'the layout generator agrees with the validator about a real model',
  () => {
    let scratch: string;
    beforeAll(() => {
      scratch = mkdtempSync(join(tmpdir(), 'app-layout-model-'));
    });
    afterAll(() => {
      rmSync(scratch, { recursive: true, force: true });
    });

    for (const [name, file] of [
      ['the Payers kit’s exported model', PAYERS_MODEL],
      ['the fictional contracts model', CONTRACTS_MODEL],
    ] as const) {
      it(`lays out every type of ${name} that has a schema, every schema shown, and the validator finds nothing`, async () => {
        const model = readModel(JSON.parse(readFileSync(file, 'utf8')), file);
        const tree = createTreeWithEmptyWorkspace();
        await appPackageGenerator(tree, {
          name: 'model-check',
          owner: 'acme',
          platform: '>=0.2.0 <1.0.0',
        });
        const types = [...model.types.values()].filter((type) => schemasOf(model, type).length > 0);
        expect(types.length).toBeGreaterThan(2);
        for (const type of types) {
          await appLayoutGenerator(tree, {
            package: 'business-apps/packages/model-check',
            type: type.name,
            model: file,
            schemas: schemasOf(model, type),
          });
        }
        const directory = join(scratch, name.replace(/\W+/g, '-'));
        flush(tree, 'business-apps/packages/model-check', directory);
        const run = validate(join(directory, 'bundle', 'agentic-ui-config'), [
          '--platform',
          PLATFORM,
          '--model',
          file,
        ]);
        expect(run.output).toContain(`${types.length} layouts were held to the content model`);
        expect(run.status).toBe(0);
      });
    }
  },
);
