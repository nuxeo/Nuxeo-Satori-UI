/**
 * A script's shape, to tell the scripts Studio generates from customer code
 * (docs/business-apps/studio-migration.md, section 2: the converter recognises Studio's templates,
 * and anything else in a script is customer code).
 *
 * The shape is the script's tokens with comments and whitespace dropped, every literal replaced by
 * a placeholder, and trailing commas removed. Two scripts that differ only in their names, labels
 * and layout therefore share a shape. The sort options of a search results script are configuration,
 * not code, so a run of them counts as one. The shape is hashed with SHA-256 and compared with the
 * shapes in `catalogue/scripts.json`.
 *
 * The TypeScript scanner splits the text into tokens. It parses nothing and runs nothing.
 */
import { createHash } from 'node:crypto';
import * as ts from 'typescript';

/** One of Studio's sort options, as its search results script lists them, once tokenised. */
const SORT_OPTION =
  /\{ field : "S" , label : this \. i18n \( "S" \) , order : "S"(?: , selected : (?:true|false))? \}/g;

export function scriptTokens(source: string): string[] {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    ts.LanguageVariant.Standard,
    source,
  );
  const tokens: string[] = [];
  // For each template literal whose substitution is open, the brace depth it opened at.
  const templates: number[] = [];
  let braces = 0;
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    if (kind === ts.SyntaxKind.CloseBraceToken && templates.at(-1) === braces) {
      // The `}` closing a template substitution: the template carries on from here.
      if (scanner.reScanTemplateToken(false) === ts.SyntaxKind.TemplateTail) templates.pop();
      tokens.push('`T`');
      continue;
    }
    switch (kind) {
      case ts.SyntaxKind.OpenBraceToken:
        braces++;
        tokens.push('{');
        break;
      case ts.SyntaxKind.CloseBraceToken:
        braces--;
        tokens.push('}');
        break;
      case ts.SyntaxKind.TemplateHead:
        templates.push(braces);
        tokens.push('`T`');
        break;
      case ts.SyntaxKind.StringLiteral:
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
        tokens.push('"S"');
        break;
      case ts.SyntaxKind.NumericLiteral:
      case ts.SyntaxKind.BigIntLiteral:
        tokens.push('N');
        break;
      default:
        tokens.push(scanner.getTokenText());
    }
  }
  return tokens.filter(
    (token, index) => !(token === ',' && (tokens[index + 1] === '}' || tokens[index + 1] === ']')),
  );
}

/** The shape as text, before hashing: what two scripts must share to be the same template. */
export function scriptShapeText(source: string): string {
  return scriptTokens(source)
    .join(' ')
    .replace(SORT_OPTION, 'SORT')
    .replace(/SORT(?: , SORT)+/g, 'SORT');
}

export function scriptShape(source: string): string {
  return createHash('sha256').update(scriptShapeText(source)).digest('hex');
}
