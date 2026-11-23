import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

// Every reason a computation can be refused with must be asserted by a spec, so that a refusal added
// without a negative control fails here. The reasons are read from the source: the argument of each
// `refuse(...)` call. And `refuse` is the only place a refusal is built, which the third test holds,
// so that a reason cannot get past the first by being written some other way.
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

const parse = (file: string): ts.SourceFile =>
  ts.createSourceFile(file, readFileSync(join(LIB, file), 'utf8'), ts.ScriptTarget.Latest, true);

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

function reasonsIn(file: string): string[][] {
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
  visit(parse(file));
  return found;
}

/** Each `{ ok: false, … }` written in the file, by the function it is written in. */
function refusalsBuiltIn(file: string): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node, inside: string): void => {
    const name = ts.isFunctionDeclaration(node) && node.name ? node.name.text : inside;
    if (
      ts.isObjectLiteralExpression(node) &&
      node.properties.some(
        (property) =>
          ts.isPropertyAssignment(property) &&
          ts.isIdentifier(property.name) &&
          property.name.text === 'ok' &&
          property.initializer.kind === ts.SyntaxKind.FalseKeyword,
      )
    )
      found.push(name);
    ts.forEachChild(node, (child) => visit(child, name));
  };
  visit(parse(file), '');
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

/** Each reason no one expectation asserts all the parts of, with its parts of four characters or more. */
function uncovered(reasons: readonly Reason[], expectations: readonly string[]): string[] {
  return reasons
    .map(({ file, parts }) => ({
      file,
      parts: parts.map((part) => part.trim()).filter((part) => part.length >= 4),
    }))
    .filter(
      ({ parts }) =>
        parts.length > 0 &&
        !expectations.some((text) => parts.every((part) => text.includes(part))),
    )
    .map(({ file, parts }) => `${file}: ${parts.join(' … ')}`);
}

describe('the negative controls', () => {
  it('cover every reason a computation can be refused with', () => {
    expect(sources).toEqual(
      expect.arrayContaining(['compute.ts', 'dates.ts', 'evaluators.ts', 'types.ts']),
    );
    const all = sources.flatMap((file) => reasonsIn(file).map((parts) => ({ file, parts })));
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

  it('can be found: a refusal is built by refuse() alone', () => {
    const built = sources.flatMap((file) =>
      refusalsBuiltIn(file).map((inside) => `${file}: ${inside || 'the module'}`),
    );
    expect(built).toEqual(['types.ts: refuse']);
  });
});
