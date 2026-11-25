import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACKAGED_REGISTRIES } from '@agentic-ui/shared/app-definition';

import { readAppActions, type AppActionsRegistered } from './app-actions-file';

// `actions.json` read as the app reads it: the Payers kit's own file, then one broken in each way
// the app tolerates, leaving out the action, or refuses, leaving out the file.

const ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..', '..');
const KIT = JSON.parse(
  readFileSync(
    join(ROOT, 'business-apps/packages/payers-claims-demo/bundle/agentic-ui-config/actions.json'),
    'utf8',
  ),
) as { actions: Record<string, unknown>[] };

const REGISTERED: AppActionsRegistered = {
  rules: Object.keys(PACKAGED_REGISTRIES.rules),
  rowActions: ['app.rowActions.download'],
  bulkActions: [],
  actions: ['app.toolbar.edit'],
};

const request = (keys: Record<string, unknown> = {}) => ({
  id: 'acme.request',
  label: 'Request',
  operation: 'Acme.Request',
  ...keys,
});
const file = (...actions: unknown[]) => ({ version: 2, actions });

describe('readAppActions', () => {
  it("reads the Payers kit's operation buttons, and leaves its lifecycle button to the platform", () => {
    const read = readAppActions(KIT, REGISTERED);
    if ('refused' in read) throw new Error(read.refused.join('\n'));
    expect(read.actions.map((action) => action.id)).toEqual([
      'payers.claim.requestRecords',
      'payers.claim.referToInvestigations',
    ]);
    const [requestRecords, refer] = read.actions;
    expect(requestRecords).toMatchObject({
      labelKey: 'payers.action.requestRecords',
      label: null,
      icon: 'health_record',
      order: 20,
      placements: ['record', 'row'],
      enabledWhen: 'app.rules.canWrite',
      operation: 'Payers.RequestMedicalRecords',
      confirm: { label: null, labelKey: 'payers.action.requestRecords.confirm' },
      refresh: true,
    });
    expect(requestRecords.form).toHaveLength(2);
    expect(refer.placements).toEqual(['record']);
    expect(refer.form).toBeNull();
    expect(read.problems).toEqual([
      'actions[0] "payers.claim.pay" is a lifecycle button, which this build does not run from actions.json: the platform\'s own offers the record\'s transitions; left out',
    ]);
  });

  it('holds no operation to an allow-list: the server serves and runs only what its own allows', () => {
    const read = readAppActions(file(request({ operation: 'Document.Delete' })), REGISTERED);
    expect('actions' in read && read.actions.map((action) => action.operation)).toEqual([
      'Document.Delete',
    ]);
  });

  it('leaves out an action with a finding, and keeps the others', () => {
    const read = readAppActions(
      file(request({ icon: 'Not An Icon' }), request({ id: 'acme.other' })),
      REGISTERED,
    );
    if ('refused' in read) throw new Error(read.refused.join('\n'));
    expect(read.actions.map((action) => action.id)).toEqual(['acme.other']);
    expect(read.problems[0]).toMatch(
      /^actions\[0\]\.icon: .* \[structure\]; actions\[0\] left out$/,
    );
  });

  it('leaves out an action whose rules this build cannot answer, which the registry would pass', () => {
    for (const key of ['visibleWhen', 'enabledWhen']) {
      const read = readAppActions(file(request({ [key]: 'acme.rules.unknown' })), REGISTERED);
      expect('actions' in read && read.actions).toEqual([]);
    }
    // Deeper than the rule registry answers: it would pass too.
    let deep: unknown = 'app.rules.canWrite';
    for (let level = 0; level < 40; level++) deep = { type: 'core.not', parameters: [deep] };
    const read = readAppActions(file(request({ visibleWhen: deep })), REGISTERED);
    expect('actions' in read && read.actions).toEqual([]);
  });

  it('refuses an id registered in code, which a manifest cannot rebind', () => {
    const read = readAppActions(file(request({ id: 'app.toolbar.edit' })), REGISTERED);
    expect('actions' in read && read.actions).toEqual([]);
  });

  it('leaves out an action that runs in bulk only, which this build does not run', () => {
    const read = readAppActions(file(request({ on: ['bulk'] })), REGISTERED);
    if ('refused' in read) throw new Error(read.refused.join('\n'));
    expect(read.actions).toEqual([]);
    expect(read.problems).toEqual([
      'actions[0] "acme.request" runs in bulk only, which this build does not run from actions.json; left out',
    ]);
    const both = readAppActions(file(request({ on: ['row', 'bulk'] })), REGISTERED);
    expect('actions' in both && both.actions.map((action) => action.placements)).toEqual([['row']]);
  });

  it('refuses a file that is not one, with every action in it', () => {
    expect(readAppActions({ version: 2, actions: {} }, REGISTERED)).toEqual({
      refused: ['actions: actions must be a list [structure]'],
    });
    expect('refused' in readAppActions([], REGISTERED)).toBe(true);
  });
});
