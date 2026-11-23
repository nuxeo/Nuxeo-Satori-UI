import { loadCatalogue } from './catalogue';
import { convert, type Conversion } from './convert';
import { runHarness, type HarnessInput } from './harness';
import { inventory, type SlotContribution } from './inventory';
import { MUTATIONS, MutationError } from './mutations';
import { slotRegistry } from './slot-registry';
import { readStudioPackage } from './studio-package';
import { m2CorpusFiles } from './testing/m2-corpus';
import { syntheticPackage } from './testing/synthetic-package';

const UI = 'web/nuxeo.war/ui';
const SLOTS = `${UI}/nuxeo-Acme-Claims-slots-bundle.html`;
const catalogue = loadCatalogue();

function prepare(bundle: Record<string, string> = {}): HarnessInput {
  const pkg = readStudioPackage(syntheticPackage({ bundle: { ...m2CorpusFiles(), ...bundle } }));
  const read = inventory(pkg);
  const allowList = new Set(['Claim.Approve']);
  return {
    pkg,
    inventory: read,
    catalogue,
    allowList,
    platformVersion: '0.2.0',
    conversion: convert(pkg, read, catalogue, { allowList, platformVersion: '0.2.0' }),
  };
}

const run = (input: HarnessInput, number: number) =>
  runHarness(input).checks.find((check) => check.number === number);

const entry = (conversion: Conversion, index: number) =>
  conversion.report.constructs.find(
    (candidate) => candidate.id === `slot-contribution:${SLOTS}#${index}`,
  );

const actions = (conversion: Conversion) =>
  (
    (
      conversion.app['actions.json'] as {
        actions: { id: string; order?: number; parameters?: unknown }[];
      }
    )?.actions ?? []
  ).map((action) => [action.id, action.order ?? null, action.parameters ?? null]);

describe("actions and menu entries, as Web UI's slots register them", () => {
  const input = prepare();

  it('writes only the buttons Web UI shows, each as its slot keeps it', () => {
    expect(actions(input.conversion)).toEqual([
      ['acme-claims.approveClaim', 10, { comment: 'Approved in Web UI' }],
      // The later of two of a name, at the same priority.
      ['acme-claims.reopenClaim', 41, { comment: 'Reopened' }],
      // The earlier of two of a name, at a higher priority.
      ['acme-claims.escalateClaim', 50, { comment: 'Escalated' }],
      // At the order a later contribution of its name, with no template, gives it.
      ['acme-claims.settleClaim', 5, { comment: 'Settled' }],
    ]);
  });

  it('reports each contribution it leaves out, and says why', () => {
    const note = (index: number) => entry(input.conversion, index);
    expect(note(1)).toMatchObject({
      outcome: 'reported',
      note: 'It is disabled, so Web UI shows nothing of it: it is left out',
    });
    expect(note(2)?.note).toBe(
      "A later contribution of the same name, reopenClaim, replaces it, as Web UI's slots do: it is left out",
    );
    expect(note(3)).toMatchObject({
      outcome: 'converted',
      to: 'actions.json acme-claims.reopenClaim',
    });
    expect(note(4)).toMatchObject({
      outcome: 'converted',
      to: 'actions.json acme-claims.escalateClaim',
    });
    expect(note(5)?.note).toContain('has a higher priority, so Web UI keeps that one');
    expect(note(7)?.note).toContain(
      'only changes the earlier contribution of the same name, settleClaim',
    );
    expect(note(8)?.note).toContain(
      "a contribution of Web UI's own named documentLock, if there is one, which it hides",
    );
    expect(note(9)).toMatchObject({
      outcome: 'reported',
      note: 'It is disabled, so Web UI shows nothing of it: it is left out',
    });
    expect(note(10)?.note).toContain('Its menu entry, oldSearch, is not shown in Web UI');
    expect(
      (input.conversion.app['navigation.json'] as { entries: { id: string }[] }).entries.map(
        (item) => item.id,
      ),
    ).toEqual(['claimssearch']);
  });

  it('keeps slots apart, never merges contributions with no name, and lets a disabled replacement hide', () => {
    const contribution = (
      name: string,
      slot: string,
      extra: Partial<SlotContribution> = {},
    ): SlotContribution => ({
      path: 'x.html',
      name,
      slot,
      order: null,
      elements: [],
      operations: [],
      parts: [],
      conditions: [],
      uses: [],
      disabled: false,
      priority: 0,
      hasTemplate: true,
      ...extra,
    });
    const a = contribution('a', 'DOCUMENT_ACTIONS');
    const b = contribution('a', 'RESULTS_SELECTION_ACTIONS');
    const unnamed = [contribution('', 'DOCUMENT_ACTIONS'), contribution('', 'DOCUMENT_ACTIONS')];
    const hidden = contribution('h', 'DOCUMENT_ACTIONS');
    const hider = contribution('h', 'DOCUMENT_ACTIONS', { disabled: true, order: 3 });
    const registry = slotRegistry({ slotContributions: [a, b, ...unnamed, hidden, hider] });
    expect([a, b, ...unnamed].map((item) => registry.kept.has(item))).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(registry.kept.has(hidden)).toBe(false);
    expect(registry.dropped.get(hider)?.note).toContain('is disabled');
    // A change with no template and no order of its own gives the earlier one Web UI's default, 0.
    const reordered = contribution('r', 'DOCUMENT_ACTIONS', { order: 9 });
    const change = contribution('r', 'DOCUMENT_ACTIONS', { hasTemplate: false });
    expect(
      slotRegistry({ slotContributions: [reordered, change] }).kept.get(reordered)?.order,
    ).toBe(0);
  });

  it("holds each action and menu entry to Web UI's slot in checks 6 and 7", () => {
    expect(runHarness(input).checks.map((check) => [check.number, check.status])).toEqual([
      [1, 'pass'],
      [2, 'pass'],
      [3, 'partial'],
      [4, 'pass'],
      [5, 'partial'],
      [6, 'partial'],
      [7, 'partial'],
      [8, 'pass'],
      [9, 'not run'],
      [10, 'pass'],
    ]);
    const findings = (name: string) => {
      const mutation = MUTATIONS.find((candidate) => candidate.name === name);
      if (!mutation) throw new Error(name);
      return run(
        { ...input, conversion: mutation.apply(input.conversion, input).conversion },
        mutation.caughtBy,
      )?.findings;
    };
    expect(findings('revive-disabled-action')).toEqual([
      'actions.json: "acme-claims.archiveClaim" runs something no button of the package runs',
    ]);
    expect(findings('keep-replaced-action')).toEqual([
      'actions.json: acme-claims.reopenClaim sends {"comment":"Reopened first"}, where Web UI sends {"comment":"Reopened"}',
    ]);
    expect(findings('keep-outranked-action')).toEqual([
      'actions.json: acme-claims.escalateClaim sends {"comment":"Escalated later"}, where Web UI sends {"comment":"Escalated"}',
    ]);
    expect(findings('revive-disabled-menu-entry')).toEqual([
      'navigation.json: "oldsearch" opens a list no menu entry of the package opens',
    ]);
    expect(findings('change-action-order')).toEqual([
      `actions.json: acme-claims.approveClaim is at order 1010, where Web UI's slot places "approveClaim" at 10`,
    ]);
  });

  it("fails check 6 on a menu entry's order, and a control that reads the package refuses without it", () => {
    const moved = {
      ...input,
      conversion: {
        ...input.conversion,
        app: {
          ...input.conversion.app,
          'navigation.json': {
            version: 2,
            entries: [{ id: 'claimssearch', label: 'Claims', order: 7, queue: 'claims' }],
          },
        },
      },
    };
    expect(run(moved, 6)?.findings).toContain(
      `navigation.json: claimssearch is at order 7, where Web UI's slot places "claimsSearch" at 1`,
    );
    const mutation = MUTATIONS.find((candidate) => candidate.name === 'keep-replaced-action');
    expect(() => mutation?.apply(input.conversion)).toThrow(MutationError);
  });
});
