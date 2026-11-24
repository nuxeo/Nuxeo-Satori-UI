/**
 * The claim lifecycle, `payersClaim`, as the stand-in model contributes it
 * (`bundle/OSGI-INF/payers-claims-demo-model.xml`): read from that file, so that the seed and its
 * controls follow the lifecycle the package gives a server, not a copy of it.
 *
 * A lifecycle's states are claim:status's values, and the seed brings each claim's state to its
 * status along the fewest transitions (`pathBetween`).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MODEL_XML = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'bundle',
  'OSGI-INF',
  'payers-claims-demo-model.xml',
);
export const LIFECYCLE = 'payersClaim';

/**
 * `{ initial, transitions: Map<name, destination>, states: Map<state, transition names> }`, read
 * from `xml`. Comments are left out first, so an example in one is not read as a contribution.
 * Throws when the file has no such lifecycle, or one that names a transition it does not define.
 */
export function readLifecycle(xml = readFileSync(MODEL_XML, 'utf8'), name = LIFECYCLE) {
  const text = xml.replace(/<!--[\s\S]*?-->/g, '');
  const match = new RegExp(
    `<lifecycle\\s+name="${name}"\\s+defaultInitial="([^"]+)"\\s*>([\\s\\S]*?)</lifecycle>`,
  ).exec(text);
  if (!match) throw new Error(`no lifecycle ${name} in the stand-in model`);
  const [, initial, body] = match;
  const transitions = new Map();
  const declared = /<transitions>([\s\S]*?)<\/transitions>\s*<states>/.exec(body)?.[1] ?? '';
  for (const [, transition, destination] of declared.matchAll(
    /<transition\s+name="([^"]+)"\s+destinationState="([^"]+)"/g,
  ))
    transitions.set(transition, destination);
  const states = new Map();
  for (const [, state, inner] of body.matchAll(
    /<state\s+name="([^"]+)"[^>]*?(?:\/>|>([\s\S]*?)<\/state>)/g,
  )) {
    const out = [...(inner ?? '').matchAll(/<transition>\s*([^<\s]+)\s*<\/transition>/g)].map(
      (m) => m[1],
    );
    for (const transition of out)
      if (!transitions.has(transition))
        throw new Error(
          `the state ${state} of ${name} names an undefined transition ${transition}`,
        );
    states.set(state, out);
  }
  if (!states.has(initial)) throw new Error(`${name} starts in ${initial}, which it does not have`);
  return { initial, transitions, states };
}

/**
 * The fewest transitions that take a claim from `from` to `to`, as names, or `null` when no path
 * leads there. `[]` when the claim is there already.
 */
export function pathBetween(lifecycle, from, to) {
  if (from === to) return [];
  const seen = new Set([from]);
  let frontier = [{ state: from, path: [] }];
  while (frontier.length > 0) {
    const next = [];
    for (const { state, path } of frontier) {
      for (const transition of lifecycle.states.get(state) ?? []) {
        const destination = lifecycle.transitions.get(transition);
        if (destination === to) return [...path, transition];
        if (seen.has(destination)) continue;
        seen.add(destination);
        next.push({ state: destination, path: [...path, transition] });
      }
    }
    frontier = next;
  }
  return null;
}
