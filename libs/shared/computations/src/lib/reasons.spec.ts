import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

// Every reason a computation can be refused with must appear in the expectations of a spec, so that
// a refusal added without a negative control fails here. The reasons are read from the source: the
// argument of each `refuse(...)` call. And `refuse` is the only place a refusal is built, which the
// second test holds, so that a reason cannot get past the first by being written some other way.
//
// A reason is compared by its literal text, the parts between its placeholders. What this proves is
// that every reason has a control, not that every guard has one: two guards that give the same
// reason look the same here. The guards broken on purpose, listed in the README, are for guards.
const LIB = import.meta.dirname;
const sources = readdirSync(LIB).filter(
  (name) => name.endsWith('.ts') && !/\.(spec|testing)\.ts$/.test(name),
);
const specs = readdirSync(join(LIB, '..'), { recursive: true, encoding: 'utf8' })
  .filter((name) => name.endsWith('.spec.ts') && !name.endsWith('reasons.spec.ts'))
  .map((name) => readFileSync(join(LIB, '..', name), 'utf8'))
  .join('\n');

const parse = (file: string): ts.SourceFile =>
  ts.createSourceFile(file, readFileSync(join(LIB, file), 'utf8'), ts.ScriptTarget.Latest, true);

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

describe('the negative controls', () => {
  it('cover every reason a computation can be refused with', () => {
    expect(sources).toEqual(
      expect.arrayContaining(['compute.ts', 'dates.ts', 'evaluators.ts', 'types.ts']),
    );
    const all = sources.flatMap((file) => reasonsIn(file).map((parts) => ({ file, parts })));
    expect(all.length).toBeGreaterThanOrEqual(20);
    const untested = all
      .map(({ file, parts }) => ({
        file,
        parts: parts.map((part) => part.trim()).filter((part) => part.length >= 4),
      }))
      .filter(({ parts }) => parts.length > 0 && !parts.every((part) => specs.includes(part)))
      .map(({ file, parts }) => `${file}: ${parts.join(' … ')}`);
    expect(untested).toEqual([]);
  });

  it('can be found: a refusal is built by refuse() alone', () => {
    const built = sources.flatMap((file) =>
      refusalsBuiltIn(file).map((inside) => `${file}: ${inside || 'the module'}`),
    );
    expect(built).toEqual(['types.ts: refuse']);
  });
});
