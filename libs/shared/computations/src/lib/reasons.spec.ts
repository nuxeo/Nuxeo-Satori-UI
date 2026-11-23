import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

// Every reason a computation can be refused with must be asserted by a spec, so that a refusal added
// without a negative control fails here. The reasons are read from the source: the argument of each
// `refuse(...)` call, and one written with no literal text to look for, a variable for one, is
// reported rather than passed, which the third test holds. And `refuse` is the only place a refusal
// is built: an object with an `ok` key, however the key is written, is found in `accept` and
// `refuse` alone, which the fourth and fifth tests hold, so that a reason cannot get past the first
// by being written some other way.
//
// A reason is compared by its literal text, the parts between its placeholders, and all of its parts
// must be in one expectation: the strings in one matcher's arguments, `expect(…).toEqual({ ok: false,
// reason: '…' })` or `expect(result.reason).toContain('…')`. Text in a comment, a test's title, a
// fixture or the value under test asserts nothing, nor does a matcher under `.not` or an
// `expect.not.…` inside one, so none of them counts. The second test holds that.
//
// What this proves is that every reason has a control, not that every guard has one: two guards that
// give the same reason look the same here. The guards broken on purpose, listed in the README, are
// for guards.
const LIB = import.meta.dirname;
const sources = readdirSync(LIB).filter(
  (name) => name.endsWith('.ts') && !/\.(spec|testing)\.ts$/.test(name),
);
// Not this file, whose own expectations hold reasons' text as the second test's fixtures.
const specs = readdirSync(join(LIB, '..'), { recursive: true, encoding: 'utf8' })
  .filter((name) => name.endsWith('.spec.ts') && !name.endsWith('reasons.spec.ts'))
  .map((name) => readFileSync(join(LIB, '..', name), 'utf8'));

interface Reason {
  readonly file: string;
  readonly parts: readonly string[];
}

const literals = (node: ts.Node): string[] =>
  ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? [node.text]
    : ts.isTemplateExpression(node)
      ? [node.head.text, ...node.templateSpans.map((span) => span.literal.text)]
      : [];

/**
 * The literal parts of each `refuse(...)` argument in `source`. An argument that is not a string or
 * a template, such as a variable, a `+` or a `?:`, has none, and `uncovered` reports it.
 */
function reasonsIn(source: string): string[][] {
  const found: string[][] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'refuse'
    )
      found.push(literals(node.arguments[0]));
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true));
  return found;
}

/** A property's key as written: `ok`, `'ok'`, `['ok']` and the shorthand `{ ok }` are all "ok". */
function keyOf(property: ts.ObjectLiteralElementLike): string | undefined {
  if (ts.isShorthandPropertyAssignment(property)) return property.name.text;
  if (!ts.isPropertyAssignment(property)) return undefined;
  const name = property.name;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name))
    return name.text;
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression))
    return name.expression.text;
  return undefined;
}

/**
 * Each object with an `ok` key written in `source`, by the function it is written in: a result,
 * whatever its key is written as and whatever its value, `false as const` or a variable included.
 */
function resultsBuiltIn(source: string): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node, inside: string): void => {
    const name = ts.isFunctionDeclaration(node) && node.name ? node.name.text : inside;
    if (
      ts.isObjectLiteralExpression(node) &&
      node.properties.some((property) => keyOf(property) === 'ok')
    )
      found.push(name || 'the module');
    ts.forEachChild(node, (child) => visit(child, name));
  };
  visit(ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true), '');
  return found;
}

/**
 * `expect(…).toEqual`, `expect(…).toContain`: a matcher that asserts the value it is given. Not one
 * under `.not`, which asserts that the text is absent.
 */
function isMatcher(callee: ts.Expression): boolean {
  if (!ts.isPropertyAccessExpression(callee) || !callee.name.text.startsWith('to')) return false;
  const subject = callee.expression;
  return (
    ts.isCallExpression(subject) &&
    ts.isIdentifier(subject.expression) &&
    subject.expression.text === 'expect'
  );
}

/** `expect.not.stringContaining(…)`, which asserts that the text is absent, wherever it is written. */
function isNegated(node: ts.Node): boolean {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isPropertyAccessExpression(node.expression.expression) &&
    node.expression.expression.name.text === 'not'
  );
}

/**
 * The text each expectation in `source` asserts: the strings in one matcher's arguments, less any
 * that a negated asymmetric matcher holds.
 */
function expectationsIn(source: string): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isMatcher(node.expression)) {
      const parts: string[] = [];
      const collect = (child: ts.Node): void => {
        if (isNegated(child)) return;
        parts.push(...literals(child));
        ts.forEachChild(child, collect);
      };
      node.arguments.forEach(collect);
      // A separator no reason holds, so that a part is not found across two strings.
      found.push(parts.join('\u0000'));
    }
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile('spec.ts', source, ts.ScriptTarget.Latest, true));
  return found;
}

/**
 * Each reason no one expectation asserts all the parts of, with its parts of four characters or
 * more. A reason with no such part, written as a variable or as placeholders alone, is reported
 * too: there is nothing to look for, so no expectation can be shown to assert it.
 */
function uncovered(reasons: readonly Reason[], expectations: readonly string[]): string[] {
  return reasons
    .map(({ file, parts }) => ({
      file,
      parts: parts.map((part) => part.trim()).filter((part) => part.length >= 4),
    }))
    .filter(
      ({ parts }) =>
        parts.length === 0 ||
        !expectations.some((text) => parts.every((part) => text.includes(part))),
    )
    .map(({ file, parts }) =>
      parts.length === 0
        ? `${file}: a reason with no text of four characters or more to look for`
        : `${file}: ${parts.join(' … ')}`,
    );
}

describe('the negative controls', () => {
  it('cover every reason a computation can be refused with', () => {
    expect(sources).toEqual(
      expect.arrayContaining(['compute.ts', 'dates.ts', 'evaluators.ts', 'types.ts']),
    );
    const all = sources.flatMap((file) =>
      reasonsIn(readFileSync(join(LIB, file), 'utf8')).map((parts) => ({ file, parts })),
    );
    expect(all.length).toBeGreaterThanOrEqual(20);
    expect(uncovered(all, specs.flatMap(expectationsIn))).toEqual([]);
  });

  it('count only an expectation that asserts all of a reason', () => {
    const reason: Reason[] = [{ file: 'x.ts', parts: ['the computation ', ' is not registered'] }];
    const asserted = [
      'expect(compute(x)).toEqual({ ok: false, reason: `the computation "${type}" is not registered` });',
      'expect(result.reason).toContain(\'the computation "core.age" is not registered\');',
    ];
    for (const source of asserted)
      expect(uncovered(reason, expectationsIn(source)), source).toEqual([]);
    const assertsNothing = [
      '// the computation "core.age" is not registered',
      'it(\'the computation "core.age" is not registered\', () => {});',
      'const fixture = \'the computation "core.age" is not registered\';',
      'expect(compute(\'the computation "core.age" is not registered\')).toEqual({ ok: true, value: 1 });',
      'expect(result.reason).not.toContain(\'the computation "core.age" is not registered\');',
      'expect(result).toEqual({ ok: false, reason: expect.not.stringContaining(\'the computation "core.age" is not registered\') });',
      "expect(a.reason).toContain('the computation'); expect(b.reason).toContain('is not registered');",
    ];
    for (const source of assertsNothing)
      expect(uncovered(reason, expectationsIn(source)), source).toEqual([
        'x.ts: the computation … is not registered',
      ]);
  });

  it('count a reason with no text to look for as not covered', () => {
    const unreadable = reasonsIn(
      'refuse(reason); refuse(prefix + suffix); refuse(passes ? "it passes" : "it fails"); refuse(`${a}: ${b}`);',
    ).map((parts) => ({ file: 'x.ts', parts }));
    expect(unreadable).toHaveLength(4);
    // An expectation holding every literal the four are written with.
    const everything = expectationsIn(
      "expect(r).toEqual({ ok: false, reason: 'reason prefix suffix it passes it fails : ' });",
    );
    expect(uncovered(unreadable, everything)).toEqual(
      new Array(4).fill('x.ts: a reason with no text of four characters or more to look for'),
    );
  });

  it('can be found: a result is built by accept() or refuse() alone', () => {
    const built = sources.flatMap((file) =>
      resultsBuiltIn(readFileSync(join(LIB, file), 'utf8')).map((inside) => `${file}: ${inside}`),
    );
    expect(built).toEqual(['types.ts: accept', 'types.ts: refuse']);
  });

  it('find a result however its key is written', () => {
    const source = `
      function quoted() { return { 'ok': false, reason: 'a' }; }
      function computed() { return { ['ok']: false, reason: 'b' }; }
      function shorthand(ok: boolean) { return { ok, reason: 'c' }; }
      function asConst() { return { ok: false as const, reason: 'd' }; }
      const arrow = () => ({ ok: !1, reason: 'e' });
      function notOne() { return { okay: false, reason: 'f' }; }`;
    expect(resultsBuiltIn(source)).toEqual([
      'quoted',
      'computed',
      'shorthand',
      'asConst',
      'the module',
    ]);
  });
});
