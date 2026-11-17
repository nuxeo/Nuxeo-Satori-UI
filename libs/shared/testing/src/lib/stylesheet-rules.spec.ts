import { describe, expect, it } from 'vitest';

import { iconCentringProblems, ruleDeclarations, withoutScssComments } from './stylesheet-rules';

const SCSS = `
// a comment with .gear-btn { display: inline-flex; } in it
.toolbar {
  display: flex;

  button {
    width: 36px;
    padding: 0;
    &:hover { color: red; }
  }
}

/* .gear-btn { padding: 0; } */
.gear-btn {
  width: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;

  &:hover { padding: 9px; }
}

.other .gear-btn-wide { width: 40px; }
`;

describe('withoutScssComments', () => {
  it('drops line and block comments, and what they mention', () => {
    const plain = withoutScssComments(SCSS);
    expect(plain).not.toContain('a comment');
    expect(plain).not.toContain('/* .gear-btn');
    expect(plain).toContain('.gear-btn {');
  });
});

describe('ruleDeclarations', () => {
  it('returns the declarations of a top-level rule, without those of a nested rule', () => {
    const rule = ruleDeclarations(SCSS, ['.gear-btn']) ?? '';
    expect(rule).toContain('width: 32px');
    expect(rule).toContain('padding: 0;');
    expect(rule).not.toContain('padding: 9px');
  });

  it('follows a nested path to the inner rule', () => {
    const rule = ruleDeclarations(SCSS, ['.toolbar', 'button']) ?? '';
    expect(rule).toContain('width: 36px');
    expect(rule).not.toContain('display: flex');
    expect(rule).not.toContain('color: red');
  });

  it('finds a selector in a comma-separated list, and reads a rule after a declaration', () => {
    expect(ruleDeclarations('.a, .b { width: 3px; }', ['.b'])).toContain('width: 3px');
    expect(ruleDeclarations('$x: 1px; .a { width: 4px; }', ['.a'])).toContain('width: 4px');
  });

  it('does not read a commented-out rule, nor a longer selector that starts the same way', () => {
    expect(ruleDeclarations('/* .gone { padding: 0; } */', ['.gone'])).toBeNull();
    expect(ruleDeclarations('.gear-btn-wide { width: 1px; }', ['.gear-btn'])).toBeNull();
    expect(ruleDeclarations('.other .gear-btn { width: 1px; }', ['.gear-btn'])).toBeNull();
  });

  it('is null when a selector on the path is missing, or the braces never close', () => {
    expect(ruleDeclarations(SCSS, ['.missing'])).toBeNull();
    expect(ruleDeclarations(SCSS, ['.toolbar', 'nav'])).toBeNull();
    expect(ruleDeclarations('.open { width: 1px;', ['.open'])).toBeNull();
  });

  describe('looks for each child only inside the rule that matched its parent', () => {
    it('does not take a child of a later sibling when the parent has none', () => {
      const scss = `
        .attachment-actions { width: 1px; }
        .other-actions { button { padding: 0; display: inline-flex; } }
      `;
      expect(ruleDeclarations(scss, ['.attachment-actions', 'button'])).toBeNull();
    });

    it('does not take a rule nested deeper than a direct child', () => {
      const scss = '.toolbar { .inner { button { padding: 0; } } }';
      expect(ruleDeclarations(scss, ['.toolbar', 'button'])).toBeNull();
      expect(ruleDeclarations(scss, ['.toolbar', '.inner', 'button'])).toContain('padding: 0;');
    });

    it('picks the child of the parent that was named when several parents have one', () => {
      const scss = '.a { button { width: 1px; } } .b { button { width: 2px; } }';
      const rule = ruleDeclarations(scss, ['.b', 'button']) ?? '';
      expect(rule).toContain('width: 2px');
      expect(rule).not.toContain('width: 1px');
    });

    it('does not read past the end of the parent into the rest of the file', () => {
      const scss = '.a { width: 1px; } button { padding: 0; }';
      expect(ruleDeclarations(scss, ['.a', 'button'])).toBeNull();
    });
  });
});

describe('iconCentringProblems', () => {
  it('is empty for a rule that centres its icon', () => {
    expect(iconCentringProblems(ruleDeclarations(SCSS, ['.gear-btn']) ?? '')).toEqual([]);
  });

  it('names each thing a rule is missing', () => {
    expect(iconCentringProblems('width: 28px; height: 28px;')).toEqual([
      'display: inline-flex',
      'align-items: center',
      'justify-content: center',
      'padding: 0',
    ]);
    expect(
      iconCentringProblems('display: inline-flex; align-items: center; justify-content: center;'),
    ).toEqual(['padding: 0']);
    expect(
      iconCentringProblems(
        'display: inline-flex; align-items: center; justify-content: center; padding: 8px;',
      ),
    ).toEqual(['padding: 0']);
  });
});
