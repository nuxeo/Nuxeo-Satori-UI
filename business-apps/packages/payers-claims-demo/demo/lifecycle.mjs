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

import { child, childrenNamed, parseXml } from '../workflow/xml.mjs';

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
 * from `xml` by a strict XML parser (`workflow/xml.mjs`), as the server reads the component: so an
 * example in a comment is not a contribution, and a file that is not well-formed is refused, not
 * read as far as a pattern matches. Only a lifecycle contributed to the lifecycle service's
 * `lifecycle` point counts. Throws when there is no such lifecycle, or one more, or one that names
 * a transition it does not define.
 */
export function readLifecycle(xml = readFileSync(MODEL_XML, 'utf8'), name = LIFECYCLE) {
  let component;
  try {
    component = parseXml(xml);
  } catch (error) {
    throw new Error(`the stand-in model is not well-formed XML: ${error.message}`);
  }
  const found = childrenNamed(component, 'extension')
    .filter(
      (extension) =>
        extension.attributes.target === 'org.nuxeo.ecm.core.lifecycle.LifeCycleService' &&
        extension.attributes.point === 'lifecycle',
    )
    .flatMap((extension) => childrenNamed(extension, 'lifecycle'))
    .filter((lifecycle) => lifecycle.attributes.name === name);
  if (found.length !== 1)
    throw new Error(
      `${found.length === 0 ? 'no' : found.length} lifecycle ${name} in the stand-in model`,
    );
  const [lifecycle] = found;
  const initial = lifecycle.attributes.defaultInitial;
  const transitions = new Map(
    childrenNamed(child(lifecycle, 'transitions'), 'transition').map((transition) => [
      transition.attributes.name,
      transition.attributes.destinationState,
    ]),
  );
  const states = new Map();
  for (const state of childrenNamed(child(lifecycle, 'states'), 'state')) {
    const out = childrenNamed(child(state, 'transitions'), 'transition').map((t) => t.text.trim());
    for (const transition of out)
      if (!transitions.has(transition))
        throw new Error(
          `the state ${state.attributes.name} of ${name} names an undefined transition ${transition}`,
        );
    states.set(state.attributes.name, out);
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
