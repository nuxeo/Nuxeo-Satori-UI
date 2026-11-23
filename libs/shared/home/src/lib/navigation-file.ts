/**
 * An app's `navigation.json`, its menu, read as the app reads it
 * (docs/business-apps/app-definition-v2.md, sections 9 and 12): checked with the validator,
 * refused on a `structure` finding, so that the platform's menu shows alone, and with each entry
 * that an `unknown` or `parameter` finding names left out. A key of the file's own that it does
 * not know is ignored.
 *
 * An entry whose rule this build cannot answer is left out too, as a home's card is: one it does
 * not register, or one nested deeper than the rule registry answers. The registry would answer
 * `true` for it, and show the entry to everyone.
 *
 * The app reads the file alone, without its package, so the queues its entries name are not
 * checked here: the pipeline checks them when the package is built. Hiding an entry is not a
 * security control: its address still answers.
 */
import {
  PACKAGED_REGISTRIES,
  validateNavigation,
  withRegistered,
  type Finding,
} from '@agentic-ui/shared/app-definition';
import type { ExtensionRule } from '@nuxeo/satori-platform/extensions';

import { refusedRule } from './home-file';

export interface MenuEntry {
  readonly id: string;
  readonly label: string | null;
  readonly labelKey: string | null;
  readonly icon: string | null;
  readonly order: number | null;
  /** A queue of the package, by its id; `null` for a page. */
  readonly queue: string | null;
  /** `home`, or a platform page by its menu entry's ID; `null` for a queue. */
  readonly page: string | null;
  readonly visibleWhen: ExtensionRule | null;
}

/**
 * The menu's entries, and what the console is to say about them: each entry left out, and why,
 * and each key of the file's own that is ignored. Or, when it is refused, what refuses it.
 */
export type ReadNavigation =
  | { readonly entries: readonly MenuEntry[]; readonly problems: readonly string[] }
  | { readonly refused: readonly string[] };

/** What this build registers, by ID, that a menu may name. */
export interface NavigationRegistered {
  /** The rule registry's rules. */
  readonly rules: readonly string[];
  /** The menu entries' IDs, the `navbar` slot's: the pages an entry may open. */
  readonly pages: readonly string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const describe = (finding: Finding): string =>
  `${finding.path || 'the file'}: ${finding.message} [${finding.kind}]`;

/** The index of the entry a finding is in, from its path, `entries[2].icon`; else `null`. */
function entryOf(finding: Finding): number | null {
  const match = /^entries\[(\d+)\]/.exec(finding.path);
  return match ? Number(match[1]) : null;
}

/**
 * The menu in `content`, read with what this build registers: a customer's own rule or page,
 * registered in Layer 2 code or a manifest, is known though the validator's packaged lists lack
 * it, and a platform rule this build was made without is not.
 */
export function readNavigation(content: unknown, registered: NavigationRegistered): ReadNavigation {
  const findings = validateNavigation(content, {
    registries: withRegistered(PACKAGED_REGISTRIES, {
      rules: registered.rules,
      pages: registered.pages,
    }),
  });
  const structural = findings.filter((finding) => finding.kind === 'structure');
  if (structural.length > 0) return { refused: structural.map(describe) };

  // With no `structure` finding the file has the menu's shape: an object whose entries are a list
  // of objects, each with an id and one of a queue and a page, and a well-formed name, icon, order
  // and rule where it has them.
  const file = content as Record<string, unknown>;
  const problems: string[] = [];
  const dropped = new Set<number>();
  for (const finding of findings) {
    const entry = entryOf(finding);
    if (entry !== null) dropped.add(entry);
    problems.push(
      `${describe(finding)}; ${entry === null ? 'ignored' : `entries[${entry}] left out`}`,
    );
  }
  const rules = new Set(registered.rules);
  const entries: MenuEntry[] = [];
  (file['entries'] as Record<string, unknown>[]).forEach((entry, index) => {
    if (dropped.has(index) || !isRecord(entry)) return;
    const refused = refusedRule(entry['visibleWhen'], (id) => rules.has(id));
    if (refused) {
      problems.push(`entries[${index}].visibleWhen ${refused}; entries[${index}] left out`);
      return;
    }
    entries.push({
      id: entry['id'] as string,
      label: text(entry['label']),
      labelKey: text(entry['labelKey']),
      icon: text(entry['icon']),
      order: typeof entry['order'] === 'number' ? entry['order'] : null,
      queue: text(entry['queue']),
      page: text(entry['page']),
      visibleWhen: (entry['visibleWhen'] as ExtensionRule | undefined) ?? null,
    });
  });
  return { entries, problems };
}
