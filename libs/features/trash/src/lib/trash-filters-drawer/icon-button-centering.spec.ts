/**
 * NXSAT-809 — the view switcher is a Material icon button resized from 40px to 36px. Its 8px of
 * padding, sized for the 40px button, left the icon 2px low and 2px right of the centre; the rule
 * must centre it. See `libs/features/browse/.../icon-button-centering.spec.ts` for the cause.
 */
import { iconCentringProblems, ruleDeclarations } from '@agentic-ui/shared/testing';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Trash icon buttons centre their icon (NXSAT-809)', () => {
  it('view switcher (.view-switcher-btn)', () => {
    const scss = readFileSync(
      join(import.meta.dirname, 'trash-filters-drawer.component.scss'),
      'utf8',
    );
    const rule = ruleDeclarations(scss, ['.view-switcher-btn']);
    expect(
      rule,
      'a `.view-switcher-btn` rule in trash-filters-drawer.component.scss',
    ).not.toBeNull();
    expect(iconCentringProblems(rule ?? ''), '`.view-switcher-btn` is missing').toEqual([]);
  });
});
