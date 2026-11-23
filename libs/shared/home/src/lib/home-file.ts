/**
 * An app's `home.json`, read as the app reads it (docs/business-apps/app-definition-v2.md,
 * sections 10 and 12): checked with the validator, refused on a `structure` finding, and with each
 * card that an `unknown` or `parameter` finding names left out. A key of the file's own that it
 * does not know is ignored.
 *
 * The app reads the file alone, without its package, so the queues its cards name are not checked
 * here: the pipeline checks them when the package is built.
 */
import {
  PACKAGED_REGISTRIES,
  validateHome,
  withRegistered,
  type Finding,
} from '@agentic-ui/shared/app-definition';
import type { ExtensionRule } from '@nuxeo/satori-platform/extensions';

/** What a KPI counts (section 10). */
export interface HomeKpi {
  readonly pageProvider: string;
  readonly parameters: readonly (string | number | boolean)[];
  readonly aggregate: string | null;
  readonly bucket: string | null;
}

export interface HomeCard {
  readonly id: string;
  readonly label: string | null;
  readonly labelKey: string | null;
  readonly kpi: HomeKpi | null;
  readonly queue: string | null;
  readonly visibleWhen: ExtensionRule | null;
}

export interface HomeFile {
  readonly label: string | null;
  readonly labelKey: string | null;
  readonly cards: readonly HomeCard[];
}

/**
 * The home, and what the console is to say about it: each card left out, and why, and each key of
 * the file's own that is ignored. Or, when a `structure` finding refuses it, what refuses it.
 */
export type ReadHome =
  | { readonly home: HomeFile; readonly problems: readonly string[] }
  | { readonly refused: readonly string[] };

/**
 * How many levels a card's rule may nest, the rule itself being the first: as many as the rule
 * registry answers. `ExtensionRuleRegistry` stops descending below that, and answers `true` for any
 * rule there that is not declared security-relevant, so `core.false` under 32 composites would show
 * the card it is meant to hide. A deeper rule leaves its card out. `home-file.spec.ts` holds this
 * to the registry both ways.
 */
export const MAX_RULE_LEVELS = 32;

const COMPOSITES = new Set(['core.every', 'core.some', 'core.not']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const describe = (finding: Finding): string =>
  `${finding.path || 'the file'}: ${finding.message} [${finding.kind}]`;

/** The index of the card a finding is in, from its path, `cards[2].kpi.aggregate`; else `null`. */
function cardOf(finding: Finding): number | null {
  const match = /^cards\[(\d+)\]/.exec(finding.path);
  return match ? Number(match[1]) : null;
}

/**
 * Why the home could not answer `rule` as written, or `null` when it can: it names a rule this
 * build does not register, or it nests deeper than {@link MAX_RULE_LEVELS}. An unregistered rule
 * passes in the registry, unless it is declared security-relevant, so a card whose rule this build
 * cannot answer would show to everyone. The walk stops at that depth, so it never recurses further
 * than the registry would.
 *
 * The nested rules are those a composite resolves: every parameter of `core.every`, `core.some`
 * and `core.not`, a rule's id included, and any `{ "type" }` among another rule's parameters, at
 * any depth, which a customer's own composite, registered in Layer 2 code, may resolve the same
 * way. A text among a non-composite's parameters is a value, such as a group, and is not read as a
 * rule. The validator checks the signature of each nested rule it knows, as `validateHome` does.
 */
export function refusedRule(
  rule: unknown,
  isRegistered: (id: string) => boolean,
  level = 1,
): string | null {
  const id = typeof rule === 'string' ? rule : isRecord(rule) ? rule['type'] : undefined;
  if (typeof id !== 'string') return null;
  if (!isRegistered(id)) return `names the rule "${id}", which this build does not register`;
  if (level > MAX_RULE_LEVELS)
    return `nests its rule more than ${MAX_RULE_LEVELS} levels deep, deeper than this build answers`;
  if (!isRecord(rule) || !Array.isArray(rule['parameters'])) return null;
  const nested = COMPOSITES.has(id) ? rule['parameters'] : rulesIn(rule['parameters']);
  for (const inner of nested) {
    const refused = refusedRule(inner, isRegistered, level + 1);
    if (refused) return refused;
  }
  return null;
}

/** Every `{ "type" }` in `value`, at any depth, not looking inside one it finds. */
function rulesIn(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(rulesIn);
  if (!isRecord(value)) return [];
  if (typeof value['type'] === 'string') return [value];
  return Object.values(value).flatMap(rulesIn);
}

/**
 * The home in `content`, read with the rules this build registers: a customer's own, registered in
 * Layer 2 code, is known though the validator's packaged list lacks it, and a platform rule this
 * build was made without is not.
 */
export function readHome(content: unknown, registeredRules: readonly string[]): ReadHome {
  const findings = validateHome(content, {
    registries: withRegistered(PACKAGED_REGISTRIES, { rules: registeredRules }),
  });
  const structural = findings.filter((finding) => finding.kind === 'structure');
  if (structural.length > 0) return { refused: structural.map(describe) };

  // With no `structure` finding the file has version 2's shape: an object whose cards are a list of
  // objects, each with an id, and a well-formed name, figure, queue and rule where it has them.
  const file = content as Record<string, unknown>;
  const problems: string[] = [];
  const dropped = new Set<number>();
  for (const finding of findings) {
    const card = cardOf(finding);
    if (card !== null) dropped.add(card);
    problems.push(`${describe(finding)}; ${card === null ? 'ignored' : `cards[${card}] left out`}`);
  }
  const registered = new Set(registeredRules);
  const cards: HomeCard[] = [];
  (file['cards'] as Record<string, unknown>[]).forEach((card, index) => {
    if (dropped.has(index)) return;
    const refused = refusedRule(card['visibleWhen'], (id) => registered.has(id));
    if (refused) {
      problems.push(`cards[${index}].visibleWhen ${refused}; cards[${index}] left out`);
      return;
    }
    const kpi = card['kpi'];
    cards.push({
      id: card['id'] as string,
      label: text(card['label']),
      labelKey: text(card['labelKey']),
      kpi: isRecord(kpi)
        ? {
            pageProvider: kpi['pageProvider'] as string,
            parameters: (kpi['parameters'] as HomeKpi['parameters'] | undefined) ?? [],
            aggregate: text(kpi['aggregate']),
            bucket: text(kpi['bucket']),
          }
        : null,
      queue: text(card['queue']),
      visibleWhen: (card['visibleWhen'] as ExtensionRule | undefined) ?? null,
    });
  });
  return {
    home: { label: text(file['label']), labelKey: text(file['labelKey']), cards },
    problems,
  };
}
