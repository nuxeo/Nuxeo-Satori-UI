import {
  LAYER_FORMAT,
  MAX_DIFFERENCES,
  layerDifferences,
  readLayerRefusal,
  readLayerState,
} from './layer-state';

/** A file's state as `LayerService.describe` writes it in `nuxeo-agentic-core`. */
const SERVED_STATE = {
  format: LAYER_FORMAT,
  app: 'payers-claims',
  path: 'layouts/Claim/view.layout.json',
  revision: 3,
  package: {
    sha256: 'p',
    content: { version: 2, cards: [{ id: 'claim', fields: ['claim:number'] }] },
  },
  live: {
    version: 1,
    kind: 'approved',
    content: { version: 2, cards: [{ id: 'claim', label: 'Live', fields: ['claim:number'] }] },
    sha256: 'l',
    at: '2026-11-25T22:00:00Z',
    replaced: 0,
    authors: ['ada'],
    submittedBy: 'ada',
    approvedBy: 'ben',
    packageSha256: 'p',
  },
  draft: null,
  versions: [
    {
      version: 1,
      kind: 'approved',
      sha256: 'l',
      at: '2026-11-25T22:00:00Z',
      replaced: 0,
      authors: ['ada'],
      submittedBy: 'ada',
      approvedBy: 'ben',
    },
  ],
  trail: [
    { at: '2026-11-25T21:58:00Z', by: 'ada', action: 'save', revision: 1, sha256: 'l' },
    { at: '2026-11-25T21:59:00Z', by: 'ada', action: 'submit', revision: 2 },
    { at: '2026-11-25T22:00:00Z', by: 'ben', action: 'approve', revision: 3, version: 1 },
  ],
  packageChanged: false,
  permissions: {
    write: true,
    approve: false,
    approveRefused: 'none submitted',
    selfApproval: false,
  },
};

describe('readLayerState', () => {
  it("reads the server's answer: the three versions, the history, the trail and the permissions", () => {
    const state = readLayerState(SERVED_STATE);
    expect(state?.revision).toBe(3);
    expect(state?.package?.content).toEqual(SERVED_STATE.package.content);
    expect(state?.live?.version).toBe(1);
    expect(state?.live?.approvedBy).toBe('ben');
    expect(state?.live?.content).toEqual(SERVED_STATE.live.content);
    expect(state?.draft).toBeNull();
    expect(state?.versions.map((version) => version.version)).toEqual([1]);
    expect(state?.trail.map((line) => `${line.by} ${line.action} ${line.version}`)).toEqual([
      'ada save null',
      'ada submit null',
      'ben approve 1',
    ]);
    expect(state?.permissions).toEqual({
      write: true,
      approve: false,
      approveRefused: 'none submitted',
      selfApproval: false,
    });
  });

  it('reads a draft, submitted or not', () => {
    const state = readLayerState({
      ...SERVED_STATE,
      draft: {
        content: { version: 2, cards: [] },
        authors: ['ada'],
        savedBy: 'ada',
        savedAt: '2026-11-25T22:10:00Z',
        basedOn: 1,
        submittedBy: 'ada',
        submittedAt: '2026-11-25T22:11:00Z',
      },
    });
    expect(state?.draft?.basedOn).toBe(1);
    expect(state?.draft?.submittedBy).toBe('ada');
  });

  it('is null for what is not the layer, so nothing is acted on it', () => {
    expect(readLayerState(null)).toBeNull();
    expect(readLayerState({ ...SERVED_STATE, format: 'nuxeo-agentic-ui-config/1' })).toBeNull();
    expect(readLayerState({ ...SERVED_STATE, revision: -1 })).toBeNull();
    expect(readLayerState({ ...SERVED_STATE, permissions: undefined })).toBeNull();
  });

  it('reads permissions as off unless the server says true', () => {
    const state = readLayerState({ ...SERVED_STATE, permissions: { write: 'yes', approve: 1 } });
    expect(state?.permissions.write).toBe(false);
    expect(state?.permissions.approve).toBe(false);
  });
});

describe('readLayerRefusal', () => {
  it("reads the validator's findings and the file as it is now", () => {
    const refusal = readLayerRefusal(422, {
      format: LAYER_FORMAT,
      error: 'invalid',
      message: 'The validator refuses the file: 1 finding(s).',
      findings: [
        { path: 'bogus', kind: 'unknown', message: '"bogus" is not a key version 2 has' },
        { path: 'x', kind: 'other', message: 'not a finding' },
      ],
      state: SERVED_STATE,
    });
    expect(refusal.error).toBe('invalid');
    expect(refusal.findings).toEqual([
      { path: 'bogus', kind: 'unknown', message: '"bogus" is not a key version 2 has' },
    ]);
    expect(refusal.state?.revision).toBe(3);
  });

  it('says the status when the body says nothing', () => {
    expect(readLayerRefusal(500, 'oops')).toEqual({
      status: 500,
      error: 'refused',
      message: 'HTTP 500',
      findings: [],
      state: null,
    });
  });
});

describe('layerDifferences', () => {
  it('lists what was added, removed and changed, by place', () => {
    const before = { version: 2, cards: [{ id: 'a', fields: ['x', 'y'] }], columns: 2 };
    const after = { version: 2, cards: [{ id: 'b', fields: ['x'] }, { id: 'c' }], tabs: [] };
    expect(layerDifferences(before, after)).toEqual({
      differences: [
        { path: 'cards[0].id', change: 'changed' },
        { path: 'cards[0].fields[1]', change: 'removed' },
        { path: 'cards[1]', change: 'added' },
        { path: 'columns', change: 'removed' },
        { path: 'tabs', change: 'added' },
      ],
      total: 5,
    });
  });

  it('finds nothing between equal files, and the whole file when one side has none', () => {
    expect(layerDifferences({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }).total).toBe(0);
    expect(layerDifferences(undefined, { a: 1 }).differences).toEqual([
      { path: '', change: 'added' },
    ]);
    expect(layerDifferences({ a: 1 }, undefined).differences).toEqual([
      { path: '', change: 'removed' },
    ]);
    expect(layerDifferences({ a: 1 }, [1]).differences).toEqual([{ path: '', change: 'changed' }]);
  });

  it(`lists the first ${MAX_DIFFERENCES} and counts the rest`, () => {
    const after = Object.fromEntries(
      Array.from({ length: MAX_DIFFERENCES + 5 }, (_, i) => [`k${i}`, i]),
    );
    const { differences, total } = layerDifferences({}, after);
    expect(differences).toHaveLength(MAX_DIFFERENCES);
    expect(total).toBe(MAX_DIFFERENCES + 5);
  });
});
