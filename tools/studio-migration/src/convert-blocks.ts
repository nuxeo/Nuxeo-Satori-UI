/**
 * M2's layout blocks (docs/business-apps/studio-migration.md, section 3): what each block of the
 * package became, and each use of one that no layout, task layout or tab placed.
 *
 * A block becomes a card wherever a layout of the package uses it (`blocks.ts`). A block used
 * nowhere shows nowhere in Web UI, and a block used where version 2 has no card for it, inside
 * another block, a search screen, the dashboard or a slot contribution that is not a tab's page,
 * is reported: there is no version 2 equivalent to write it as.
 */
import { blockFieldId, blockOf, blockUseId } from './blocks';
import type { ConvertContext } from './convert';
import type { FileKind } from './inventory';

const PLACES: Partial<Record<FileKind, string>> = {
  'layout-block':
    'It sits in another layout block, and a card holds no card: a person regroups its fields',
  'slot-contributions':
    "It sits in a slot contribution that is no tab's page, where a layout block has no card to become",
  'search-form': 'It sits in a search form, which a queue does not have',
  'search-results': "It sits in a search screen's results, which a queue shows as a table",
  dashboard: 'It sits in the dashboard, whose cards are home cards of a queue',
  theme: 'It sits in a theme, which holds no fields',
};

export function convertBlocks(context: ConvertContext): void {
  const { inventory } = context;
  for (const use of inventory.blockUses) {
    if (context.decision(blockUseId(use)) !== undefined) continue;
    const kind = inventory.files.find((file) => file.path === use.path)?.kind;
    const note =
      (kind && Object.hasOwn(PLACES, kind) ? PLACES[kind] : undefined) ??
      'The conversion did not reach it';
    context.decide(blockUseId(use), { outcome: 'reported', note });
    blockOf(inventory, use)?.fields.forEach((_, index) =>
      context.decide(blockFieldId(use, index), {
        outcome: 'reported',
        note: 'Its layout block is reported here',
      }),
    );
  }
  for (const block of inventory.blocks) {
    const uses = inventory.blockUses.filter((use) => use.block === block.path);
    const converted = uses
      .map((use) => context.decision(blockUseId(use)))
      .filter((decision) => decision?.outcome === 'converted' && decision.to);
    context.decide(
      `layout-block:${block.path}#block`,
      converted.length > 0
        ? {
            outcome: 'converted',
            to: `a card where it is used: ${converted.map((decision) => decision?.to).join('; ')}`,
          }
        : uses.length === 0
          ? {
              outcome: 'reported',
              note: 'No layout, task layout or tab of the package uses it, so Web UI shows it nowhere',
            }
          : { outcome: 'reported', note: 'None of its uses is converted, and each says why' },
    );
  }
}
