import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

// Every message the validators can give must appear in the expectations of a spec, so that a
// refusal added without a negative control fails here. The messages are read from the source:
//
// - the last argument of each `add(...)` call, and each `message:` of a finding built whole;
// - each problem the model reader pushes, `problems.push(...)`;
// - a message given back as a value: the text a function returns, and the text beside a `null` in
//   a conditional, which is how a widget parameter's check and an image's rules say what is wrong.
//
// One is compared by its literal text, the parts between its placeholders. A message with none is
// made of messages tested elsewhere.
//
// What this proves is that every message has a control, not that every guard has one: two guards
// that give the same message look the same here. The mutation checks are for guards.
const LIB = import.meta.dirname;
const sources = readdirSync(LIB).filter(
  (name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'),
);
const specs = readdirSync(join(LIB, '..'), { recursive: true, encoding: 'utf8' })
  .filter((name) => name.endsWith('.spec.ts') && !name.endsWith('messages.spec.ts'))
  .map((name) => readFileSync(join(LIB, '..', name), 'utf8'))
  .join('\n');

const literals = (node: ts.Node): string[] =>
  ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? [node.text]
    : ts.isTemplateExpression(node)
      ? [node.head.text, ...node.templateSpans.map((span) => span.literal.text)]
      : [];

function messagesIn(file: string): string[][] {
  const source = ts.createSourceFile(
    file,
    readFileSync(join(LIB, file), 'utf8'),
    ts.ScriptTarget.Latest,
  );
  const found: string[][] = [];
  const visit = (node: ts.Node): void => {
    const callee = ts.isCallExpression(node) ? node.expression : undefined;
    const isAdd =
      callee !== undefined &&
      ((ts.isIdentifier(callee) && callee.text === 'add') ||
        (ts.isPropertyAccessExpression(callee) && callee.name.text === 'add'));
    const isProblem =
      callee !== undefined &&
      ts.isPropertyAccessExpression(callee) &&
      callee.name.text === 'push' &&
      ts.isIdentifier(callee.expression) &&
      callee.expression.text === 'problems';
    const message =
      isAdd && ts.isCallExpression(node)
        ? node.arguments[2]
        : isProblem && ts.isCallExpression(node)
          ? node.arguments[0]
          : ts.isPropertyAssignment(node) &&
              ts.isIdentifier(node.name) &&
              node.name.text === 'message'
            ? node.initializer
            : undefined;
    if (message) found.push(literals(message));
    if (ts.isReturnStatement(node) && node.expression && literals(node.expression).length > 0)
      found.push(literals(node.expression));
    if (ts.isConditionalExpression(node)) {
      const isNull = (branch: ts.Expression): boolean => branch.kind === ts.SyntaxKind.NullKeyword;
      if (isNull(node.whenTrue)) found.push(literals(node.whenFalse));
      if (isNull(node.whenFalse)) found.push(literals(node.whenTrue));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('the negative controls', () => {
  it('cover every message the validators can give', () => {
    const all = sources.flatMap((file) => messagesIn(file).map((parts) => ({ file, parts })));
    expect(sources).toEqual(
      expect.arrayContaining([
        'checker.ts',
        'app.ts',
        'queue.ts',
        'actions.ts',
        'registries.ts',
        'image-source.ts',
        'content-model.ts',
        'layout-model.ts',
      ]),
    );
    expect(all.length).toBeGreaterThan(120);
    const untested = all
      .map(({ file, parts }) => ({
        file,
        parts: parts.map((part) => part.trim()).filter((part) => part.length >= 4),
      }))
      .filter(({ parts }) => parts.length > 0 && !parts.every((part) => specs.includes(part)))
      .map(({ file, parts }) => `${file}: ${parts.join(' … ')}`);
    expect(untested).toEqual([]);
  });
});
