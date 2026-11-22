import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

// A branding image's source has one set of rules, version 1's, in two places: the app reads them
// from `libs/shared/app-config`, and this library cannot import them without Angular. So this
// library keeps a copy, and this test fails the moment the copy differs from the original, text
// for text, so that a fifth correction to version 1's rules cannot miss the pipeline.
const ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');

function describeLogoSrcFormIn(file: string): string {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  let text: string | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'describeLogoSrcForm')
      text = node.getText(source).replace(/^export\s+/, '');
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (text === undefined) throw new Error(`${file} has no describeLogoSrcForm`);
  return text;
}

describe("a branding image's source", () => {
  it("is held to version 1's rules, copied unchanged", () => {
    const original = describeLogoSrcFormIn(
      join(ROOT, 'libs', 'shared', 'app-config', 'src', 'lib', 'bootstrap-config.ts'),
    );
    expect(original.split('\n').length).toBeGreaterThan(40);
    expect(describeLogoSrcFormIn(join(import.meta.dirname, 'image-source.ts'))).toBe(original);
  });
});
