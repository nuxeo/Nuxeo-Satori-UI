/**
 * Test-only: every kind of finding the tool can print, read from its source, for the support
 * playbook's coverage check (`playbook.spec.ts`, docs/business-apps/studio-migration-support.md).
 *
 * A finding is a line the tool prints about something wrong or undecided: under a check that
 * failed, under the verdict, in the inventory's "Decisions needed", about a `decisions.json`, or in
 * lab mode. The tool builds each as a text and adds it to a list: `findings` or `problems`, which
 * it pushes them to, or `blockers` (the verdict) and `decisions` (the inventory's), which it builds
 * whole. A kind is that text with each part filled in as it runs written `…`:
 * `` `the schema ${schema.name} has no field ${name}` `` is the kind `the schema … has no field …`.
 * A text that picks one of two, `cond ? 'a' : 'b'`, is two kinds.
 *
 * A finding the scanner cannot read as text, such as one held in a variable it cannot trace, is
 * listed in `unread`, with where it is, rather than left out: so a finding added in a form the
 * scanner does not know fails the check until it is read, never passes it unseen. So does a file
 * that adds findings but has no section in {@link SOURCES} or reason in {@link NOT_FINDINGS}.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';

/**
 * The playbook's section for each file's findings: one for the file, or one for each function of
 * it that adds them, by the outermost named function they are added in.
 */
export const SOURCES: Readonly<Record<string, string | Readonly<Record<string, string>>>> = {
  'account.ts': "The inventory's decisions",
  'inventory.ts': "The inventory's decisions",
  'harness.ts': {
    nothingDropped: 'Check 1',
    labels: 'Check 4',
    theme: 'Check 8',
    runHarness: 'The verdict',
  },
  'check-fields.ts': 'Check 2',
  'check-model.ts': 'Check 3',
  'model.ts': 'Check 3',
  'check-conditions.ts': 'Check 5',
  'check-seen.ts': 'Check 6',
  'check-requests.ts': 'Check 7',
  'check-package.ts': 'Check 10',
  'decisions.ts': 'decisions.json',
  'lab.ts': 'Lab mode: the request-log rule',
  'lab-server.ts': 'Lab mode: the server halves',
  'lab-browser.ts': 'Lab mode: as the same user',
};

/**
 * Files whose lists of problems are not findings a person reads one by one, with why. The playbook
 * names each where it says what happens instead.
 */
export const NOT_FINDINGS: Readonly<Record<string, string>> = {
  'catalogue.ts':
    'the tool\'s own catalogue, checked as it loads: any problem in it stops every command with one refusal, "the catalogue in … is wrong", a defect of the tool and never of a package',
};

/** The lists a finding is pushed to. */
const PUSHED = new Set(['findings', 'problems']);

/** The lists built whole, by file: the verdict's lines, and the inventory's decisions. */
const BUILT: Readonly<Record<string, ReadonlySet<string>>> = {
  'harness.ts': new Set(['blockers']),
  'account.ts': new Set(['decisions']),
};

/**
 * A property whose text is a finding, by file: decisions.ts's refusal of a whole file, and the
 * inventory's problem with a file, which the inventory's decisions print after "could not be read".
 */
const PROPERTIES: Readonly<Record<string, ReadonlySet<string>>> = {
  'decisions.ts': new Set(['refused']),
  'inventory.ts': new Set(['message']),
};

/**
 * Findings that another part of the repository words, by the function that gives them, and the
 * kind the playbook names them by.
 */
export const WORDED_ELSEWHERE: Readonly<Record<string, string>> = {
  judgeMe: "<the Beta harness's identity guard on /me>",
};

export interface FindingKind {
  readonly section: string;
  readonly kind: string;
  /** `file:line` of where it is built. */
  readonly at: string;
}

export interface Scanned {
  readonly kinds: readonly FindingKind[];
  /** Each finding the scanner could not read, as `file:line: why`. */
  readonly unread: readonly string[];
}

/** Every finding kind in the tool's source, `directory` being its `src`. */
export function findingKinds(directory: string): Scanned {
  const kinds: FindingKind[] = [];
  const unread: string[] = [];
  const files = readdirSync(directory)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.d.ts'))
    .sort();
  const scans = new Map<string, FileScan>();
  for (const file of files) {
    const source = ts.createSourceFile(
      file,
      readFileSync(join(directory, file), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    scans.set(file, new FileScan(file, source, kinds, unread, scans));
  }
  for (const scan of scans.values()) scan.run();
  return { kinds, unread };
}

type Found = readonly string[] | { readonly why: string };

const isUnread = (found: Found): found is { readonly why: string } => !Array.isArray(found);
const cannot = (why: string): Found => ({ why });

function all(found: readonly Found[]): Found {
  const texts: string[] = [];
  for (const one of found) {
    if (isUnread(one)) return one;
    texts.push(...one);
  }
  return [...new Set(texts)];
}

type FunctionLike = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;

const isFunctionLike = (node: ts.Node): node is FunctionLike =>
  ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node);

class FileScan {
  /** Each function imported from another file of the tool, by the file it is from. */
  private readonly imported = new Map<string, string>();
  /** The functions of this file whose returned findings another file has had read. */
  private readonly returnsRead = new Set<string>();

  constructor(
    private readonly file: string,
    private readonly source: ts.SourceFile,
    private readonly kinds: FindingKind[],
    private readonly unread: string[],
    private readonly scans: ReadonlyMap<string, FileScan>,
  ) {
    for (const statement of source.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        !statement.moduleSpecifier.text.startsWith('./')
      )
        continue;
      const from = `${statement.moduleSpecifier.text.slice(2)}.ts`;
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings))
        for (const element of bindings.elements) this.imported.set(element.name.text, from);
    }
  }

  /**
   * The findings a function of this file returns, when another file takes what it returns as
   * findings, as lab-cli.ts takes `confirmPlatform`'s: each is added here, in this file's section,
   * where it is returned.
   */
  readReturns(name: string): void {
    if (this.returnsRead.has(name)) return;
    this.returnsRead.add(name);
    const declared = this.declaredFunction(name);
    if (!declared?.body) return;
    const values = ts.isBlock(declared.body) ? returnsOf(declared.body) : [declared.body];
    for (const value of values) this.add(value, this.list(value));
  }

  run(): void {
    const visit = (node: ts.Node): void => {
      this.visit(node);
      ts.forEachChild(node, visit);
    };
    visit(this.source);
  }

  private visit(node: ts.Node): void {
    // `findings.push(…)`, `problems.push(…)`
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'push' &&
      ts.isIdentifier(node.expression.expression) &&
      PUSHED.has(node.expression.expression.text)
    ) {
      for (const argument of node.arguments)
        this.add(
          argument,
          ts.isSpreadElement(argument)
            ? this.list(argument.expression)
            : ts.isObjectLiteralExpression(argument)
              ? [] // a problem with its parts: its text is a property, read below
              : this.texts(argument),
        );
      return;
    }
    // A property whose text is a finding: `refused: '…'`, `message: '…'`
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      PROPERTIES[this.file]?.has(node.name.text)
    ) {
      this.add(node.initializer, this.texts(node.initializer));
      return;
    }
    // `findings: …` in an object: a list, or what another list holds
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && PUSHED.has(node.name.text)) {
      this.add(node.initializer, this.list(node.initializer));
      return;
    }
    // A list built whole: `const blockers = [...]`
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      BUILT[this.file]?.has(node.name.text) &&
      node.initializer !== undefined
    )
      this.add(node.initializer, this.list(node.initializer));
  }

  private at(node: ts.Node): string {
    return `${this.file}:${this.source.getLineAndCharacterOfPosition(node.getStart(this.source)).line + 1}`;
  }

  private add(node: ts.Node, found: Found): void {
    if (isUnread(found)) {
      this.unread.push(`${this.at(node)}: ${found.why}`);
      return;
    }
    if (found.length === 0) return;
    const section = this.sectionOf(node);
    if (section === undefined) {
      if (!Object.hasOwn(NOT_FINDINGS, this.file))
        this.unread.push(
          `${this.at(node)}: a finding in a file, or a function, with no section of the playbook in SOURCES`,
        );
      return;
    }
    for (const kind of found) this.kinds.push({ section, kind, at: this.at(node) });
  }

  private sectionOf(node: ts.Node): string | undefined {
    const mapped = Object.hasOwn(SOURCES, this.file) ? SOURCES[this.file] : undefined;
    if (mapped === undefined || typeof mapped === 'string') return mapped;
    let name: string | undefined;
    for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent)
      if (ts.isFunctionDeclaration(parent) && parent.name) name = parent.name.text;
    return name !== undefined && Object.hasOwn(mapped, name) ? mapped[name] : undefined;
  }

  /** The texts one finding can be. */
  private texts(node: ts.Expression): Found {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
    if (ts.isTemplateExpression(node)) {
      let text = node.head.text;
      for (const span of node.templateSpans) text += `…${span.literal.text}`;
      return [text.replace(/…+/g, '…')];
    }
    if (ts.isParenthesizedExpression(node)) return this.texts(node.expression);
    if (ts.isConditionalExpression(node))
      return all([this.texts(node.whenTrue), this.texts(node.whenFalse)]);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = this.texts(node.left);
      const right = this.texts(node.right);
      if (isUnread(left)) return left;
      if (isUnread(right)) return right;
      return [...new Set(left.flatMap((a) => right.map((b) => `${a}${b}`.replace(/…+/g, '…'))))];
    }
    // `null` and `undefined` are no finding.
    if (node.kind === ts.SyntaxKind.NullKeyword) return [];
    if (ts.isIdentifier(node)) {
      if (node.text === 'undefined') return [];
      return this.traced(node, (value) => this.texts(value));
    }
    if (ts.isPropertyAccessExpression(node)) {
      // `reading.refused`: a finding property, read where it is set.
      if (PROPERTIES[this.file]?.has(node.name.text)) return [];
      const called = ts.isCallExpression(node.expression) ? node.expression.expression : undefined;
      if (called && ts.isIdentifier(called) && Object.hasOwn(WORDED_ELSEWHERE, called.text))
        return [WORDED_ELSEWHERE[called.text]];
    }
    return cannot(
      `a finding built as ${this.describe(node)}, which the scanner cannot read as text`,
    );
  }

  /** The texts a list of findings can hold. */
  private list(node: ts.Expression): Found {
    if (ts.isArrayLiteralExpression(node))
      return all(
        node.elements.map((element) =>
          ts.isSpreadElement(element) ? this.list(element.expression) : this.texts(element),
        ),
      );
    if (ts.isParenthesizedExpression(node) || ts.isAwaitExpression(node))
      return this.list(node.expression);
    if (ts.isConditionalExpression(node))
      return all([this.list(node.whenTrue), this.list(node.whenFalse)]);
    // Another list of findings, `findings` or `x.findings`: read where its texts are added.
    // `[...new Set(findings)]`: the same texts, each once.
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'Set' &&
      node.arguments?.length === 1
    )
      return this.list(node.arguments[0]);
    if (ts.isIdentifier(node) && PUSHED.has(node.text)) return [];
    if (ts.isPropertyAccessExpression(node) && PUSHED.has(node.name.text)) return [];
    if (ts.isIdentifier(node)) return this.traced(node, (value) => this.list(value));
    if (ts.isCallExpression(node)) return this.call(node);
    return cannot(
      `a list of findings given as ${this.describe(node)}, which the scanner cannot read`,
    );
  }

  /**
   * A list a call gives: what `.map`, `.flatMap` or `.filter` give of a list, or a function of the
   * tool's, whose findings are read where it adds them or, when it adds none, where it returns
   * them.
   */
  private call(node: ts.CallExpression): Found {
    const callee = node.expression;
    if (ts.isPropertyAccessExpression(callee)) {
      const method = callee.name.text;
      const [mapper] = node.arguments;
      if ((method === 'map' || method === 'flatMap') && mapper && isFunctionLike(mapper)) {
        const each = (value: ts.Expression): Found =>
          method === 'map' ? this.texts(value) : this.list(value);
        const body = mapper.body;
        const mapped =
          body === undefined
            ? cannot('a mapper with no body')
            : ts.isBlock(body)
              ? all(returnsOf(body).map(each))
              : each(body);
        // A list of findings mapped to others, as check-package.ts prefixes what `versionOne`
        // finds with its file: what that function returns are kinds too, as it returns them.
        const receiver = callee.expression;
        const given =
          ts.isCallExpression(receiver) &&
          ts.isIdentifier(receiver.expression) &&
          this.declaredFunction(receiver.expression.text)
            ? this.call(receiver)
            : [];
        return all([mapped, given]);
      }
      // `.filter(…)`, `.slice(…)`: no text of its own; the list it is called on holds them.
      if (method === 'filter' || method === 'slice') return [];
    }
    if (ts.isIdentifier(callee)) {
      const declared = this.declaredFunction(callee.text);
      if (declared) {
        if (!declared.body) return [];
        // What it pushes is read where it pushes it, and `return findings` adds nothing more; any
        // other list it returns, such as an early `return ['…']`, is read here.
        return ts.isBlock(declared.body)
          ? all(returnsOf(declared.body).map((value) => this.list(value)))
          : this.list(declared.body);
      }
      const from = this.imported.get(callee.text);
      if (
        from !== undefined &&
        (Object.hasOwn(SOURCES, from) || Object.hasOwn(NOT_FINDINGS, from))
      ) {
        // Read where it is returned, in its own file and section.
        this.scans.get(from)?.readReturns(callee.text);
        return [];
      }
    }
    return cannot(`a list from ${this.describe(node)}, which the scanner cannot read`);
  }

  /**
   * A name's texts: those each call gives it when it is a parameter, as check-requests.ts's `list`
   * is given the line for a queue that is missing, or its value's when it is a constant.
   */
  private traced(node: ts.Identifier, read: (value: ts.Expression) => Found): Found {
    for (let scope: ts.Node | undefined = node.parent; scope; scope = scope.parent) {
      if (isFunctionLike(scope)) {
        const index = scope.parameters.findIndex(
          (parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === node.text,
        );
        if (index >= 0) return this.givenTo(scope, index, read);
      }
      const constant = declarationIn(scope, node.text);
      if (constant?.initializer) return read(constant.initializer);
    }
    return cannot(`a finding held in ${node.text}, which the scanner cannot trace`);
  }

  private givenTo(fn: FunctionLike, index: number, read: (value: ts.Expression) => Found): Found {
    const name = functionName(fn);
    if (name === undefined) return cannot('a finding a nameless function is given');
    const found: Found[] = [];
    const visit = (candidate: ts.Node): void => {
      if (
        ts.isCallExpression(candidate) &&
        ts.isIdentifier(candidate.expression) &&
        candidate.expression.text === name &&
        candidate.arguments[index] !== undefined
      )
        found.push(read(candidate.arguments[index]));
      ts.forEachChild(candidate, visit);
    };
    visit(this.source);
    return found.length === 0 ? cannot(`a finding ${name} is never given`) : all(found);
  }

  private declaredFunction(name: string): FunctionLike | undefined {
    for (const statement of this.source.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return statement;
      if (ts.isVariableStatement(statement))
        for (const declaration of statement.declarationList.declarations)
          if (
            ts.isIdentifier(declaration.name) &&
            declaration.name.text === name &&
            declaration.initializer &&
            isFunctionLike(declaration.initializer)
          )
            return declaration.initializer;
    }
    return undefined;
  }

  private describe(node: ts.Node): string {
    const text = node.getText(this.source).replace(/\s+/g, ' ');
    return `\`${text.length > 60 ? `${text.slice(0, 57)}...` : text}\``;
  }
}

/** The values a function body returns, less those of the functions inside it. */
function returnsOf(body: ts.Block): ts.Expression[] {
  const values: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    if (isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression) values.push(node.expression);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  return values;
}

/** A `const` of that name declared directly in a block, a function body or the file. */
function declarationIn(scope: ts.Node, name: string): ts.VariableDeclaration | undefined {
  const statements = ts.isBlock(scope) || ts.isSourceFile(scope) ? scope.statements : undefined;
  for (const statement of statements ?? [])
    if (ts.isVariableStatement(statement) && statement.declarationList.flags & ts.NodeFlags.Const)
      for (const declaration of statement.declarationList.declarations)
        if (ts.isIdentifier(declaration.name) && declaration.name.text === name) return declaration;
  return undefined;
}

function functionName(fn: FunctionLike): string | undefined {
  if (ts.isFunctionDeclaration(fn)) return fn.name?.text;
  const parent = fn.parent;
  return ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)
    ? parent.name.text
    : undefined;
}
