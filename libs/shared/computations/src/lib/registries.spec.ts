import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PACKAGED_COMPUTATIONS,
  validateLayoutV2,
  type Signature,
} from '@agentic-ui/shared/app-definition';
import { compute } from './compute';
import { PACKAGED_COMPUTATION_EVALUATORS } from './evaluators';
import { recordOf } from './record.testing';
import type { ComputationResult } from './types';

// The evaluators here and the signatures the validator holds layouts to are two registries of the
// same computations. These tests keep them one: the same IDs, and the same number of parameters,
// so that a package the pipeline passes is one the app can evaluate, and a parameter one side
// gains cannot be ignored by the other.

const evaluatorIds = Object.keys(PACKAGED_COMPUTATION_EVALUATORS).sort();
const signatureIds = Object.keys(PACKAGED_COMPUTATIONS).sort();

/** How many parameters a signature allows, as the validator's `signed` counts them. */
function range(signature: Signature): { least: number; most: number } {
  const least = signature.parameters.length - (signature.optional ?? 0);
  return { least, most: signature.rest ? Number.POSITIVE_INFINITY : signature.parameters.length };
}

/** What the validator says of a computed field with `count` parameters, if anything. */
function validatorSays(type: string, count: number): string[] {
  const field = { id: 'probe', computed: { type, parameters: Array(count).fill('x') } };
  return validateLayoutV2(
    { version: 2, cards: [{ id: 'card', fields: [field] }] },
    { mode: 'view' },
  )
    .filter((finding) => finding.path === 'cards[0].fields[0].computed.parameters')
    .map((finding) => finding.message);
}

describe('the evaluators and the registered computations', () => {
  it('have the same IDs, both ways', () => {
    expect(evaluatorIds.filter((id) => !signatureIds.includes(id))).toEqual([]);
    expect(signatureIds.filter((id) => !evaluatorIds.includes(id))).toEqual([]);
    expect(evaluatorIds).toEqual([
      'core.age',
      'core.choose',
      'core.count',
      'core.dateDiff',
      'core.sum',
      'core.template',
    ]);
  });

  it('take a bounded number of parameters: no computation’s signature repeats one', () => {
    for (const id of signatureIds) expect(PACKAGED_COMPUTATIONS[id].rest, id).toBeUndefined();
  });

  it.each(signatureIds)('agree on how many parameters %s takes, optional ones included', (id) => {
    const { least, most } = range(PACKAGED_COMPUTATIONS[id]);
    const evaluator = PACKAGED_COMPUTATION_EVALUATORS[id];
    const probe = (): ComputationResult => ({ ok: false, reason: 'probe' });
    for (let count = 0; count <= most + 2; count++) {
      const result = evaluator(Array(count).fill(null), recordOf({}), probe);
      const reason = result.ok ? '' : result.reason;
      const [refusal] = validatorSays(id, count);
      if (count >= least && count <= most) {
        // Taken: whatever else it says, it is not a refusal of the count.
        expect(reason, `${id} with ${count}`).not.toMatch(/ takes .*parameters?, not \d+$/);
        expect(refusal, `the validator, for ${id} with ${count}`).toBeUndefined();
      } else {
        // Refused by both, in the same words.
        expect(refusal, `the validator, for ${id} with ${count}`).toBeDefined();
        expect(reason, `${id} with ${count}`).toBe(refusal);
      }
    }
  });

  it('count core.sum’s optional subfield, the one optional parameter', () => {
    expect(PACKAGED_COMPUTATIONS['core.sum']).toEqual({
      parameters: ['value', 'text'],
      optional: 1,
    });
    expect(range(PACKAGED_COMPUTATIONS['core.sum'])).toEqual({ least: 1, most: 2 });
  });
});

describe('the examples of layout-v2.md', () => {
  const document = readFileSync(
    join(import.meta.dirname, '../../../../../docs/business-apps/layout-v2.md'),
    'utf8',
  );
  const computations: unknown[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node !== null && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (key === 'computed') computations.push(value);
        walk(value);
      }
    }
  };
  for (const [, block] of document.matchAll(/```json\n([\s\S]*?)```/g)) walk(JSON.parse(block));

  /** The Payers Member page's record (section 9), with every property its computations read. */
  const member = recordOf({
    'member:firstName': 'Ada',
    'member:lastName': 'Lovelace',
    'member:birthDate': '1990-11-24T00:00:00.000Z',
  });

  it('evaluate, every computation in them, against the Member record', () => {
    expect(computations.length).toBeGreaterThanOrEqual(3);
    for (const computation of computations) {
      const result = compute(computation, member);
      expect(result, JSON.stringify(computation)).toMatchObject({ ok: true });
      expect(result.ok && result.value, JSON.stringify(computation)).not.toBeNull();
    }
  });

  it('give the Member page its name and its age', () => {
    expect(computations.map((computation) => compute(computation, member))).toEqual(
      expect.arrayContaining([
        { ok: true, value: 'Ada Lovelace' },
        { ok: true, value: 35 },
      ]),
    );
  });
});

describe('what the library imports', () => {
  const sources = readdirSync(import.meta.dirname)
    .filter((name) => name.endsWith('.ts') && !/\.(spec|testing)\.ts$/.test(name))
    .map((name) => join(import.meta.dirname, name))
    .concat(join(import.meta.dirname, '..', 'index.ts'));

  it('is the app definition’s contract and its own files, with no Angular and no HTTP', () => {
    const imported = sources.flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)].map(
        ([, specifier]) => specifier,
      ),
    );
    expect(imported.length).toBeGreaterThan(5);
    expect(
      imported.filter(
        (specifier) =>
          !specifier.startsWith('./') && specifier !== '@agentic-ui/shared/app-definition',
      ),
    ).toEqual([]);
  });

  it('has no request, timer or code from text anywhere in its source', () => {
    const forbidden =
      /\b(?:fetch|XMLHttpRequest|WebSocket|eval|Function|setTimeout|setInterval|require)\b|\bimport\s*\(/;
    // The pattern itself must catch what it is for, or this test would pass on anything.
    for (const call of ["fetch('/api')", 'new Function("x")', "import('x')", 'eval(text)'])
      expect(call).toMatch(forbidden);
    for (const file of sources) {
      const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(code, file).not.toMatch(forbidden);
    }
  });
});
