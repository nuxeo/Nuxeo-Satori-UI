#!/usr/bin/env node
/**
 * Sanitizer bypass audit — the durable half of the SonarCloud security remediation.
 *
 * `docs/sonarcloud-security-remediation-plan.md` section 5 asks for a gate whose job is *not*
 * to find the 34 issues (Sonar already did) but to make the reasoning in section 4 survive the
 * next agent who has not read it. Five checks:
 *
 *   1  Unregistered bypass          every `bypassSecurityTrust*` needs an allowlist entry
 *   2  Stale allowlist entry        an entry whose file or member no longer has a bypass
 *   3  Redundant bypass             a bypass on a locally-minted object URL, unrecorded
 *   4  `Safe*` in a NONE context    `source[src]` / `audio[src]` / `video[poster]`
 *   5  Unpaired trusted HTML        `bypassSecurityTrustHtml` with no sanitiser beside it
 *
 * Plus a **ratchet**: `budgets` in the allowlist caps how many category A and B entries may
 * exist. The counts may shrink and never grow, which is what makes PRs 3–5 of the plan
 * verifiable rather than self-reported.
 *
 * ## Why this parses TypeScript instead of grepping it
 *
 * The first cut of this script used regexes for "enclosing member" and emitted 100+ findings
 * naming things like `of`, `pipe`, `subscribe` and `if` as members. A gate nobody can read is a
 * gate that gets switched off, so it walks the TypeScript **AST** via `ts.createSourceFile`
 * instead — `typescript` is already a dependency, so this costs no install.
 *
 * Check 4 is the one that most needed it. Angular's DOM security schema puts `source[src]`,
 * `audio[src]` and `video[poster]` in `SecurityContext.NONE`, where **no sanitiser runs** and so
 * a `Safe*` value is never unwrapped — it is assigned to the DOM property and coerced by
 * `toString()`, writing the literal string `"SafeValue must use [property]=binding: …"` into
 * `src`. Deciding whether a binding is affected therefore means following the *type* the
 * expression carries, hopping through interfaces (`src.url` → `VideoSource.url`) and `@for` loop
 * variables. Pattern-matching the expression text cannot do that.
 *
 * ## How check 4 decides, and what makes that safe
 *
 * It asks the compiler. `createTypeProgram` builds a real `ts.Program` over `apps/` and `libs/`, and
 * `resolveTemplateType` resolves each binding through its `TypeChecker`. Five rounds before that,
 * type resolution was syntactic — annotation text, declarations gathered by name, alias expansion —
 * and each round found a spelling that slipped past it: `type MediaUrl = SafeResourceUrl`, an
 * imported interface, a *lowercase* alias, an `input.required<T>()`. Each fix closed one spelling;
 * none could close the class, because "does this text look like a Safe type" is not the question.
 * The syntactic resolver is gone rather than dormant — keeping a superseded security implementation
 * beside the live one is how the wrong half gets maintained.
 *
 * Templates are parsed with Angular's own `parseTemplate` for the same reason. A regex asking for
 * `[src]="…"` matched one spelling of a binding and missed `bind-src="…"`, which is the canonical
 * form of the identical property binding, and `[attr.src]="…"`, which reaches the same NONE-context
 * attribute. The compiler's parser enumerates the bindings a template actually has instead of being
 * asked about one syntax at a time.
 *
 * Neither of those is what makes check 4 trustworthy. **It fails closed.** A NONE-context binding
 * whose type the checker cannot resolve — `any`, `unknown` and the error type included, since those
 * are the checker declining to answer rather than answering — is reported, not skipped, and so is a
 * template that will not parse. That is what converts every remaining gap, present and future, from
 * a silent pass into a visible finding.
 *
 * Section 5.1 of the plan is explicit that a template check which cannot see through an alias is
 * worse than none, because it will be trusted wrongly. It was, for five rounds. Hence the checker
 * and the fail-closed default.
 *
 * Usage:
 *   node scripts/beta-harness/sanitizer-audit.mjs
 *   node scripts/beta-harness/sanitizer-audit.mjs --print          # dump every bypass as JSON
 *   node scripts/beta-harness/sanitizer-audit.mjs --only 4         # run one check (for evidence)
 */

import { BindingType, TmplAstRecursiveVisitor, parseTemplate } from '@angular/compiler';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { auditPath } from './sanitizer-path.mjs';
import { isLeftover, readMarker } from './sanitizer-selftest-state.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const ALLOWLIST_PATH = '.ai/state/sanitizer-allowlist.json';

/**
 * The helpers permitted to hold a bypass — **empty until they exist.**
 *
 * This used to name `libs/shared/security/src/lib/trust-object-url.ts` and
 * `libs/shared/ui/src/lib/render-trusted-html.ts`, neither of which is in the tree; they arrive with
 * the plan's PRs 3 and 4. Two things were wrong with pre-registering them. The exemptions could
 * never fire, so checks 3 and 5 carried dead branches whose only exercise was a selftest control
 * that patched this map inside the script. And it silently pre-approved whatever later appears at
 * those paths, matched by exact member name — so a helper landing under a different export name gets
 * no exemption while one landing with a *matching* name gets an unreviewed one.
 *
 * `assertApprovedHelpersExist` keeps this honest in the other direction: once an entry is added, the
 * file must exist, so the map cannot rot back into naming nothing.
 */
const APPROVED_HELPERS = new Map([]);

const BYPASS_RE = /^bypassSecurityTrust(Url|ResourceUrl|Html|Style|Script)$/;

/**
 * The member name a callee reads, whether it is written `x.member` or `x['member']`.
 *
 * `sanitizer['bypassSecurityTrustHtml'](raw)` is an `ElementAccessExpression`, and every place that
 * looked for a bypass tested `ts.isPropertyAccessExpression` only. So the bracketed spelling was
 * invisible to `collectBypasses` — hence to registration, to the declared-call count and to the
 * category budget — and invisible to checks 3 and 5, which walk for the call themselves. It is
 * ordinary TypeScript that compiles to the same property read, so it was a one-character evasion of
 * the entire gate.
 *
 * A literal index is read directly, so this keeps working with no checker. A non-literal one is
 * resolved **through the checker**, because a string constant is the next spelling along and the
 * comment here used to decline it on the grounds that resolving it "would be the syntactic guessing
 * this file has been burned by". It is the opposite of that: asking `getTypeAtLocation` for a
 * string-literal type is the compiler answering, which is precisely what closed the alias class in
 * check 4 and the identity class in check 5.
 *
 * The same comment claimed nothing was silently admitted by the limit, "because check 5's
 * indirect-reference finding still fires on the reference that produced `name`". It does not, and
 * `const M = 'bypassSecurityTrustHtml'; sanitizer[M](raw)` is why: `M` is a string, not a reference
 * to the member, so there is no indirect read for that finding to see. Run against the pre-fix
 * script with raw markdown passed to it, checks 1, 3 and 5 all printed
 * `PASS — 31 bypass call(s), all accounted for`.
 * @returns {string|null}
 */
function accessedMemberName(node, checker) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (!ts.isElementAccessExpression(node)) return null;

  return keyExpressionName(node.argumentExpression, checker);
}

/**
 * The member name a key expression denotes — a literal read directly, anything else resolved through
 * the checker as a string-literal type — or `null`.
 *
 * Shared by element access (`sanitizer[key]`) and computed destructuring
 * (`const { [key]: trust } = sanitizer`). They were fixed one at a time and the second was missed:
 * closing `sanitizer[key](raw)` while leaving `const { [key]: trust } = sanitizer; trust(raw)` open
 * left the identical evasion one syntax along, which is the mistake this file keeps making. One
 * function now answers the question for both.
 */
function keyExpressionName(key, checker) {
  if (!key) return null;
  if (ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key)) return key.text;
  // A numeric key is an array read, not a member name; short-circuiting it keeps the checker out of
  // the hot path for the many `a[0]` in the tree.
  if (!checker || ts.isNumericLiteral(key)) return null;

  let type;
  try {
    type = checker.getTypeAtLocation(key);
  } catch {
    return null;
  }
  for (const part of type?.isUnionOrIntersection?.() ? type.types : [type]) {
    if (part?.isStringLiteral?.()) return part.value;
  }
  return null;
}

/**
 * Whether an expression's type is Angular's `DomSanitizer`.
 *
 * The backstop for an element access whose member cannot be named. Resolving a constant index
 * through the checker covers `as const` and an explicit literal type, but a `let`-widened `string`
 * has no literal type to resolve, and `sanitizer[widened](raw)` would go back to being invisible.
 *
 * "It would not compile" is not available as a defence here. `createTypeProgram` loads
 * `tsconfig.base.json`, which sets **neither `strict` nor `noImplicitAny`** — the libraries turn
 * `strict` on in their own tsconfigs — so indexing `DomSanitizer` with a `string` is an error to
 * `nx build` and not an error to this audit's own checker. Depending on another gate to catch it is
 * how a hole ends up owned by nobody.
 *
 * So the object's type is the thing asked about: an element access on a `DomSanitizer` whose member
 * this cannot name is reported. The member is unknown, so it cannot be classified, budgeted or
 * paired — and a bypass this cannot name must not become a bypass it cannot see.
 */
function isDomSanitizerExpression(node, checker) {
  if (!checker) return false;
  let type;
  try {
    type = checker.getTypeAtLocation(node);
  } catch {
    return false;
  }
  if (!type) return false;
  for (const part of type.isUnionOrIntersection?.() ? type.types : [type]) {
    const name = part?.aliasSymbol?.getName() ?? part?.getSymbol?.()?.getName();
    if (name === 'DomSanitizer') return true;
  }
  return false;
}

/**
 * Whether a binding element is destructuring a `DomSanitizer`.
 *
 * The initialiser lives on the enclosing `VariableDeclaration` (or parameter), not on the element,
 * so it is reached through the parents rather than read off `n`.
 */
function isDomSanitizerDestructuring(element, checker) {
  if (!checker) return false;
  for (let p = element.parent; p; p = p.parent) {
    if (ts.isVariableDeclaration(p)) {
      return p.initializer ? isDomSanitizerExpression(p.initializer, checker) : false;
    }
    if (ts.isParameter(p)) return isDomSanitizerExpression(p, checker);
    if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      return isDomSanitizerExpression(p.right, checker);
    }
    if (ts.isSourceFile(p)) break;
  }
  return false;
}

/**
 * The property a binding element destructures, when it names one explicitly.
 *
 * `{ bypassSecurityTrustHtml }` carries no `propertyName`, so matching on the bound name was right
 * for it. `{ 'bypassSecurityTrustHtml': trust }` and `{ ['bypassSecurityTrustHtml']: trust }` do
 * carry one, and the identifier-only test fell through to the bound name — reading the local alias
 * `trust`, which matches nothing. Verified against the pre-fix script: check 1 printed
 * `PASS — 31 bypass call(s), all accounted for` with the quoted form in place.
 *
 * A computed key goes through `keyExpressionName`, the same resolution element access uses, so
 * `const key = 'bypassSecurityTrustHtml' as const; const { [key]: trust } = sanitizer` is named.
 * That case was open for one round because element access and destructuring each had their own copy
 * of the logic and only one was fixed — the reason there is now a single shared function.
 * @returns {string|null}
 */
function destructuredPropertyName(element, checker) {
  const name = element.propertyName;
  if (!name) return null;
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isComputedPropertyName(name)) return keyExpressionName(name.expression, checker);
  return keyExpressionName(name, checker);
}

/**
 * The member an **assignment**-pattern property reads, and whether its key was resolvable.
 *
 * `const { bypassSecurityTrustHtml: trust } = sanitizer` is a declaration, so its left side is a
 * binding pattern made of `BindingElement`s. `({ bypassSecurityTrustHtml: trust } = sanitizer)` is
 * an assignment, and TypeScript parses that left side as an **object literal** — a
 * `PropertyAssignment` or `ShorthandPropertyAssignment`, not a `BindingElement`. So the collector
 * saw no binding element, no property access and no element access on the sanitizer, and `trust(raw)`
 * afterwards is an ordinary identifier call. Verified against 5fe82d4: an unsanitised HTML bypass
 * written this way left the audit at `PASS — 31 bypass call(s), all accounted for`, outside checks 1
 * and 5 and outside the budget.
 *
 * `computed` distinguishes "this key names nothing" from "this key is not computed at all", so the
 * caller can fail closed on the former exactly as it does for a bracketed index.
 * @returns {{name: string|null, computed: boolean}}
 */
function assignmentPropertyName(property, checker) {
  if (ts.isShorthandPropertyAssignment(property)) {
    return { name: property.name.text, computed: false };
  }
  if (!ts.isPropertyAssignment(property)) return { name: null, computed: false };

  const name = property.name;
  if (ts.isIdentifier(name)) return { name: name.text, computed: false };
  if (ts.isComputedPropertyName(name)) {
    return { name: keyExpressionName(name.expression, checker), computed: true };
  }
  return { name: keyExpressionName(name, checker), computed: false };
}

/**
 * Angular's `SecurityContext.NONE` members, verified against
 * `@angular/compiler/fesm2022/compiler.mjs` (the DOM security schema). No sanitiser runs on
 * these, so a `Safe*` value bound here stringifies and silently breaks playback.
 */
const NONE_CONTEXT_BINDINGS = [
  { element: 'source', attr: 'src' },
  { element: 'audio', attr: 'src' },
  { element: 'video', attr: 'poster' },
  // Derived from the same `registerContext(SecurityContext.URL, …)` list: it registers only
  // `*|formAction`, `area|href`, `a|href`, `a|xlink:href`, `form|action`, `img|src` and `video|src`.
  // Everything else that takes a URL is therefore NONE, including these. Nothing in the repository
  // binds them today, so they are a guard against a future binding rather than a live defect — but
  // the previous list of three read as exhaustive, which is how a checked set becomes a stale one.
  { element: 'track', attr: 'src' },
  { element: 'input', attr: 'src' },
  { element: 'img', attr: 'srcset' },
  { element: 'source', attr: 'srcset' },
];

/** `NONE_CONTEXT_BINDINGS` keyed for lookup while walking a parsed template. */
const NONE_CONTEXT_BY_ELEMENT = new Map();
for (const { element, attr } of NONE_CONTEXT_BINDINGS) {
  if (!NONE_CONTEXT_BY_ELEMENT.has(element)) NONE_CONTEXT_BY_ELEMENT.set(element, new Set());
  NONE_CONTEXT_BY_ELEMENT.get(element).add(attr);
}

/**
 * Binding kinds that put their value into the DOM property or attribute this check guards.
 *
 * `Property` covers both `[src]="…"` and `bind-src="…"` — the parser reports them identically,
 * which is the point of parsing rather than matching text. `Attribute` is `[attr.src]="…"`, which
 * reaches the same NONE-context attribute by a different route, and `TwoWay` is `[(src)]="…"`.
 * `Class`, `Style` and the animation kinds cannot carry a URL and are not included.
 */
const URL_CARRYING_BINDING_TYPES = new Set([BindingType.Property, BindingType.Attribute, BindingType.TwoWay]);

const argv = process.argv.slice(2);
const printOnly = argv.includes('--print');
const only = argv.includes('--only') ? Number(argv[argv.indexOf('--only') + 1]) : null;

// ---------------------------------------------------------------------------------------------
// file discovery
// ---------------------------------------------------------------------------------------------

const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.nx', '.git', 'tmp', '.tmp']);

/** @returns {string[]} repo-relative paths */
function findFiles(dir, extensions) {
  const out = [];
  const abs = join(ROOT, dir);
  let entries;
  try {
    entries = readdirSync(abs);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const rel = join(dir, entry);
    let st;
    try {
      st = statSync(join(ROOT, rel));
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      out.push(...findFiles(rel, extensions));
    } else if (extensions.some((e) => entry.endsWith(e)) && !entry.endsWith('.spec.ts')) {
      // Registry keys use repository separators; stat/read operations still use native paths.
      out.push(auditPath(rel));
    }
  }
  return out;
}

function parse(relPath) {
  const text = readFileSync(join(ROOT, relPath), 'utf8');
  // setParentNodes = true — the enclosing-member walk depends on `.parent`.
  return { sf: ts.createSourceFile(relPath, text, ts.ScriptTarget.Latest, true), text };
}

function lineOf(sf, node) {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function eachNode(node, visit) {
  visit(node);
  node.forEachChild((c) => eachNode(c, visit));
}

// ---------------------------------------------------------------------------------------------
// AST: enclosing member, bypasses, type shapes
// ---------------------------------------------------------------------------------------------

/**
 * The named declaration a node sits inside — a class member, a function, or a top-level
 * variable. This is the allowlist key, deliberately not a line number: line numbers churn on
 * every edit above them and would turn the allowlist into noise.
 */
function enclosingMemberName(node) {
  for (let n = node.parent; n; n = n.parent) {
    if (
      ts.isMethodDeclaration(n) ||
      ts.isPropertyDeclaration(n) ||
      ts.isGetAccessorDeclaration(n) ||
      ts.isSetAccessorDeclaration(n) ||
      ts.isFunctionDeclaration(n)
    ) {
      if (n.name && !ts.isComputedPropertyName(n.name)) return n.name.getText(n.getSourceFile());
    }
    if (ts.isConstructorDeclaration(n)) return 'constructor';
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) {
      // Only treat as the member if it is not itself nested in something named.
      const outer = enclosingMemberName(n);
      return outer === '<module>' ? n.name.text : outer;
    }
  }
  return '<module>';
}

/**
 * Every place a `bypassSecurityTrust*` member is reached, whether it is *called* there or merely
 * referenced.
 *
 * Matching only `CallExpression`s with a `PropertyAccessExpression` callee — which is what this did
 * — does not survive one line of indirection. Both of these reported zero bypasses and PASS:
 *
 *     const trust = this.sanitizer.bypassSecurityTrustResourceUrl.bind(this.sanitizer);
 *     trust(u);
 *
 *     const { bypassSecurityTrustHtml } = this.sanitizer;
 *     bypassSecurityTrustHtml.call(this.sanitizer, raw);
 *
 * That matters beyond the count: checks 1, 3 and 5 and the ratchet are all driven from this list, so
 * an invisible bypass is unregistered, unbudgeted and unchecked for sanitisation, while the
 * allowlist's own header promises that *every* `bypassSecurityTrust*` call appears in it.
 *
 * A reference is recorded rather than only a call because that is where the escape happens — once
 * the function is in a variable, its call site is an ordinary identifier this cannot recognise.
 *
 * Deduplication is by **AST node position**, not by line. Keying on the line meant two bypass calls
 * written on one line counted as one, and the count is not cosmetic: it is compared against the
 * entry's declared `calls`, summed into the category budget and ratcheted per member against the
 * merge base. Demonstrated on this repository — putting a fourth `bypassSecurityTrustHtml` on a line
 * that already held one in `highlightExcerpt`, whose entry declares 3, left check 1 printing
 * `PASS — 31 bypass call(s), all accounted for` with four bypasses in the member.
 *
 * The position also does what the line was there for. Two records can only collide when they are the
 * same node, so a construct visited by more than one branch of the walk still collapses to one entry,
 * while two genuinely separate calls stay two however they are formatted.
 * @returns {{bypasses: {member: string, kind: string, line: number, indirect: boolean}[], unnameable: {member: string, line: number, text: string}[]}}
 */
function collectBypasses(sf, checker) {
  const found = [];
  /** Element accesses on a `DomSanitizer` whose member could not be named — reported by check 1. */
  const unnameable = [];
  /** Keyed by node start offset, so formatting cannot merge two bypasses into one. */
  const seenNodes = new Set();

  const record = (node, name, indirect) => {
    const key = `${node.getStart(sf)}:${name}`;
    if (seenNodes.has(key)) return;
    seenNodes.add(key);
    found.push({
      member: enclosingMemberName(node),
      kind: name.replace('bypassSecurityTrust', ''),
      line: lineOf(sf, node),
      indirect,
    });
  };

  eachNode(sf, (n) => {
    // `x.bypassSecurityTrustHtml(...)` / `x['bypassSecurityTrustHtml'](...)` — the direct forms.
    if (ts.isCallExpression(n)) {
      const name = accessedMemberName(n.expression, checker);
      if (name && BYPASS_RE.test(name)) {
        record(n, name, false);
        return;
      }
    }

    // The same member read in any position that is not the callee of its own call — `.bind`,
    // an assignment, an argument, a return.
    if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) {
      const name = accessedMemberName(n, checker);
      if (name && BYPASS_RE.test(name)) {
        const isOwnCallee = ts.isCallExpression(n.parent) && n.parent.expression === n;
        if (!isOwnCallee) record(n, name, true);
      }
      // Fails closed on the one thing naming cannot reach: an element access on a `DomSanitizer`
      // whose member this cannot name. `let key = 'bypassSecurityTrustHtml'` widens to `string`, so
      // there is no literal type for the checker to return, and no separate property read for
      // check 5's indirect finding to see either.
      if (!name && ts.isElementAccessExpression(n) && isDomSanitizerExpression(n.expression, checker)) {
        const key = `${n.getStart(sf)}:<unnameable>`;
        if (!seenNodes.has(key)) {
          seenNodes.add(key);
          unnameable.push({
            member: enclosingMemberName(n),
            line: lineOf(sf, n),
            text: n.getText(sf).slice(0, 60),
          });
        }
      }
    }

    // `const { bypassSecurityTrustHtml } = this.sanitizer;`
    if (ts.isBindingElement(n) && n.name && ts.isIdentifier(n.name)) {
      const declared = destructuredPropertyName(n, checker);
      const bound = declared ?? n.name.text;
      if (BYPASS_RE.test(bound)) {
        record(n, bound, true);
      } else if (
        declared === null &&
        n.propertyName &&
        ts.isComputedPropertyName(n.propertyName) &&
        isDomSanitizerDestructuring(n, checker)
      ) {
        // The same backstop the element-access path has: a computed key that does not resolve names
        // no member, so the local it binds could be any of them. Reported rather than assumed benign.
        const key = `${n.getStart(sf)}:<unnameable>`;
        if (!seenNodes.has(key)) {
          seenNodes.add(key);
          unnameable.push({
            member: enclosingMemberName(n),
            line: lineOf(sf, n),
            text: n.getText(sf).slice(0, 60),
          });
        }
      }
    }

    // `({ bypassSecurityTrustHtml: trust } = this.sanitizer)` — the ASSIGNMENT form. Its left side is
    // an object literal, not a binding pattern, so the branch above never sees it.
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isObjectLiteralExpression(n.left)
    ) {
      const fromSanitizer = isDomSanitizerExpression(n.right, checker);
      for (const property of n.left.properties) {
        const { name, computed } = assignmentPropertyName(property, checker);
        if (name && BYPASS_RE.test(name)) {
          record(property, name, true);
        } else if (name === null && computed && fromSanitizer) {
          // Same fail-closed rule as everywhere else a key will not resolve.
          const key = `${property.getStart(sf)}:<unnameable>`;
          if (!seenNodes.has(key)) {
            seenNodes.add(key);
            unnameable.push({
              member: enclosingMemberName(property),
              line: lineOf(sf, property),
              text: n.getText(sf).slice(0, 60),
            });
          }
        }
      }
    }
  });

  return { bypasses: found, unnameable };
}

/**
 * A transform argument that cannot introduce unchecked text: a literal, a regex, or a number.
 *
 * `escaped.replace(/x/g, '&amp;')` is fine — the replacement is author-written. `escaped.replace(/x/,
 * raw)` is not, and has to be proven sanitised on its own.
 */
function isInertTransformArg(arg) {
  return (
    ts.isStringLiteral(arg) ||
    ts.isNoSubstitutionTemplateLiteral(arg) ||
    ts.isRegularExpressionLiteral(arg) ||
    ts.isNumericLiteral(arg)
  );
}

/**
 * A short hash of the declaration a call resolves to, with whitespace normalised.
 *
 * Whitespace-insensitive so reformatting does not lapse a registration, but sensitive to any change
 * in what the code does.
 */
function declarationHash(node, checker) {
  if (!checker) return null;
  const callee = node.expression;
  const target = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
  let symbol = checker.getSymbolAtLocation(target);
  if (!symbol) return null;
  if (symbol.flags & ts.SymbolFlags.Alias) {
    try {
      symbol = checker.getAliasedSymbol(symbol);
    } catch {
      /* not an alias */
    }
  }
  const decl = symbol.valueDeclaration ?? symbol.declarations?.[0];
  if (!decl) return null;
  const normalised = decl.getText(decl.getSourceFile()).replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(normalised).digest('hex').slice(0, 16);
}

/**
 * The declaration a call's callee actually resolves to, as `file::name`, or `null`.
 *
 * This replaces three successive attempts to establish sanitiser identity from syntax — full callee
 * text, then final callee name, then "a same-named import exists in this file" — each of which review
 * defeated in one line. The last was the clearest lesson: an import existing *somewhere* in a file
 * says nothing about what a particular callee resolves to, because a local declaration can shadow it.
 *
 * Only the checker knows. `getSymbolAtLocation` follows aliases to the declaration that will actually
 * run, so a shadowing local, an identity function of the right name, and a re-export all reduce to
 * their real declaration site — which is either the reviewed one or it is not.
 */
function resolveCalleeDeclaration(node, checker) {
  // No checker means no proof of identity, and check 5 rejects what it cannot prove.
  if (!checker) return null;
  const callee = node.expression;
  const target = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
  if (!ts.isIdentifier(target) && !ts.isPrivateIdentifier(target)) return null;

  let symbol = checker.getSymbolAtLocation(target);
  if (!symbol) return null;
  if (symbol.flags & ts.SymbolFlags.Alias) {
    try {
      symbol = checker.getAliasedSymbol(symbol);
    } catch {
      /* not an alias after all */
    }
  }
  const decl = symbol.valueDeclaration ?? symbol.declarations?.[0];
  if (!decl) return null;
  const abs = decl.getSourceFile().fileName;
  return `${auditPath(abs, ROOT)}::${symbol.getName()}`;
}

/**
 * String transforms that carry sanitised-ness through from their *receiver*.
 *
 * Deliberately excludes `concat` and `join`, and every argument is still checked: `escaped.concat(raw)`
 * and `escaped.replace(/x/, raw)` append attacker-controlled text to a sanitised receiver, and marking
 * them safe purely because the receiver was sanitised is how the decoy gets back in through the side
 * door. Only transforms that cannot introduce unchecked text remain.
 */
const STRING_TRANSFORMS = new Set([
  'replace',
  'replaceAll',
  'trim',
  'slice',
  'substring',
  'toString',
  'toLowerCase',
  'toUpperCase',
]);

/**
 * Whether a binary operator assigns to its left operand.
 *
 * `=` and every compound form. Only `EqualsToken` was tested, so `clean += raw` was not recorded as
 * a source of `clean` and the provenance walk never saw the appended value — verified silent on this
 * repository with attacker-authored markdown concatenated onto a DOMPurify result.
 *
 * All of them, not just `+=`: the arithmetic ones cannot produce a string in practice, but "cannot
 * in practice" is the reasoning that produced this hole. An assignment is a new value for the
 * variable, and check 5 has to see every new value or it is proving nothing.
 */
function isAssignmentOperator(kind) {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

/**
 * Whether the value in `expr` demonstrably came from a sanitiser.
 *
 * Check 5 used to ask a weaker question: does the enclosing member's *text* contain
 * `DOMPurify.sanitize(` anywhere? That passes on
 *
 *     const heading = DOMPurify.sanitize(this.staticTitle);   // sanitised, and unused below
 *     return this.sanitizer.bypassSecurityTrustHtml(note);    // attacker-authored, untouched
 *
 * — a decoy satisfies the guard while user-authored HTML is trusted raw. That guard is what
 * `.ai/state/supply-chain-allowlist.json` cites as its reason for accepting the Quill XSS advisory,
 * so "a sanitiser is nearby" was doing load-bearing work it could not support.
 *
 * This follows the argument instead: a direct sanitiser call, a template literal or concatenation
 * whose parts are each sanitised, or a local `const`/`let` in the same member assigned from one.
 * Anything it cannot trace is reported — the same fail-closed stance as check 4, for the same
 * reason: the alternative is a guard that is silent precisely when it is being evaded.
 */
function sanitizerReaches(expr, host, sf, checker, approvedSanitisers) {
  const seen = new Set();
  /** Names already proven sanitised, so a self-referential transform can reference them. */
  const safeNames = new Set();

  const calleeName = (node) => {
    const callee = node.expression;
    if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
    if (ts.isIdentifier(callee)) return callee.text;
    return null;
  };

  /**
   * Accepts a call only when its callee **resolves** to a reviewed sanitiser declaration.
   *
   * Admissibility is a registry, not an inference. Five rounds were spent trying to prove
   * "this function escapes HTML" from syntax — entity text in the body, then a `replace`-derived
   * return — and each attempt was defeated by something trivial (dead marker text,
   * `value.replace(/x/g, 'x')`). That proof is not available syntactically, and pretending otherwise
   * produced a guard that looked stronger each round while still being one line from a bypass.
   *
   * So the semantics are established by a human once, recorded in `sanitisers` in the allowlist with a
   * justification, and enforced here by identity: the checker resolves the callee to a declaration
   * site, and only the recorded sites count. A no-op `replace`, an identity function, a shadowing
   * local and a same-named helper elsewhere all resolve to declarations that are not in the registry,
   * so all four fail — without this ever needing to understand what escaping is.
   */
  const isSanitiser = (node) => {
    const resolved = resolveCalleeDeclaration(node, checker);
    if (!resolved) return false;
    if (approvedSanitisers.has(resolved)) {
      // The registry records *what was reviewed*, pinned by a hash of the declaration. Identity alone
      // would accept a registered helper that has since been edited into a no-op — the one hole a
      // reviewed-list design otherwise leaves open. A changed body means the review no longer applies,
      // so registration lapses and check 5 reports until someone re-reviews and re-pins.
      const expected = approvedSanitisers.get(resolved);
      const actual = declarationHash(node, checker);
      return actual !== null && actual === expected;
    }
    // DOMPurify ships its own types; accept `sanitize` from the package itself rather than pinning a
    // version-specific declaration path in the registry.
    const [declFile, name] = resolved.split('::');
    return name === 'sanitize' && /node_modules\/dompurify\//.test(declFile);
  };

  const walk = (node, depth) => {
    if (!node || depth > 8) return false;

    if (ts.isCallExpression(node)) {
      if (isSanitiser(node)) return true;
      // `sanitised.replace(...)` stays sanitised — but only if every argument is too.
      // `escaped.replace(/x/, raw)` splices attacker text into an escaped string, so the receiver
      // being clean says nothing about the result.
      const name = calleeName(node);
      if (
        name &&
        STRING_TRANSFORMS.has(name) &&
        ts.isPropertyAccessExpression(node.expression) &&
        walk(node.expression.expression, depth + 1) &&
        (node.arguments ?? []).every((a) => isInertTransformArg(a) || walk(a, depth + 1))
      ) {
        return true;
      }
      return false;
    }
    // `cond ? a : b`, `a ?? b`, `(a)` — safe only if every branch that can reach the bypass is.
    if (ts.isParenthesizedExpression(node)) return walk(node.expression, depth + 1);
    if (ts.isConditionalExpression(node)) {
      return walk(node.whenTrue, depth + 1) && walk(node.whenFalse, depth + 1);
    }
    if (ts.isBinaryExpression(node)) {
      return walk(node.left, depth + 1) && walk(node.right, depth + 1);
    }
    // A template literal is safe if every interpolation is. Its literal chunks are author-written.
    if (ts.isTemplateExpression(node)) {
      return node.templateSpans.every((span) => walk(span.expression, depth + 1));
    }
    if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isStringLiteral(node)) return true;

    // An identifier: every value it can hold must be sanitised, not merely its declaration.
    //
    // Following only the initialiser would accept
    //     let html = escapeHtml(x);
    //     html = req.body;            // <- reassigned to something untrusted
    // so the declaration *and* every assignment inside this member are collected, and all of them
    // must trace back to a sanitiser. `html = html.replace(...)` self-references, which the `seen`
    // guard would otherwise reject, so a self-reference is skipped rather than failed — the other
    // sources of the same variable still have to pass.
    //
    // Sources are matched by **symbol**, not by name, and **every** assignment operator counts. Both
    // of those were fail-open, and both were reproduced on this repository before being fixed:
    //
    //   - Collecting every same-named declaration in the member let an unrelated *shadow* vouch for
    //     the variable that actually reaches the bypass. A parameter contributes no source at all, so
    //     for `trust(clean: string)` an inner `const clean = DOMPurify.sanitize(...)` in a branch that
    //     never runs was the *only* source collected, and "every source is sanitised" was satisfied
    //     by a value that never gets there. `getSymbolAtLocation` distinguishes the two `clean`s.
    //   - Only `EqualsToken` was recorded, so `clean += raw` was not a source at all:
    //     `let clean = DOMPurify.sanitize(raw); clean += raw;` passed with attacker-authored markdown
    //     concatenated onto the sanitised string. Every assignment operator is recorded now, and the
    //     appended value has to be sanitised on its own — `+=` puts `d.right` in the independent set,
    //     which is the same treatment `x = x + untrusted` already got through the `+` walk.
    if (ts.isIdentifier(node)) {
      const name = node.text;
      if (safeNames.has(name)) return true;
      if (seen.has(name)) return false;
      seen.add(name);

      // The declaration this identifier actually refers to. Without a checker there is nothing to
      // resolve with, and nothing can be proven anyway — `isSanitiser` already rejects everything —
      // so the name comparison is kept as an inert fallback rather than a second code path.
      const symbol = checker ? checker.getSymbolAtLocation(node) : null;
      const isSameBinding = (candidate) => {
        if (!symbol) return candidate.text === name;
        const candidateSymbol = checker.getSymbolAtLocation(candidate);
        return candidateSymbol !== undefined && candidateSymbol === symbol;
      };

      const sources = [];
      eachNode(host, (d) => {
        if (ts.isVariableDeclaration(d) && ts.isIdentifier(d.name) && isSameBinding(d.name)) {
          if (d.initializer) sources.push(d.initializer);
        }
        if (
          ts.isBinaryExpression(d) &&
          isAssignmentOperator(d.operatorToken.kind) &&
          ts.isIdentifier(d.left) &&
          isSameBinding(d.left)
        ) {
          sources.push(d.right);
        }
      });
      // No source at all is the parameter case, among others: nothing to trace, nothing proven.
      if (sources.length === 0) return false;

      const selfReferential = (source) =>
        (source.getText(sf).match(new RegExp(`\\b${name}\\b`, 'g')) ?? []).length > 0;
      const independent = sources.filter((source) => !selfReferential(source));
      if (independent.length === 0) return false;
      if (!independent.every((source) => walk(source, depth + 1))) return false;

      // Every independent source is sanitised, so the variable is — provisionally. Now the
      // self-referential assignments have to preserve that, which is where `html = html + untrusted`
      // is caught: `+` requires both operands to pass, and `untrusted` does not.
      safeNames.add(name);
      const carried = sources
        .filter(selfReferential)
        .every((source) => walk(source, depth + 1));
      if (!carried) safeNames.delete(name);
      return carried;
    }

    return false;
  };

  return walk(expr, 0);
}


// ---------------------------------------------------------------------------------------------
// templates
// ---------------------------------------------------------------------------------------------

/**
 * Every template belonging to a component, whether it is an external `templateUrl` or an inline
 * `template:` string. `attachment-preview-dialog.ts` is inline and carries two of the five known
 * NONE-context defects, so scanning `.html` alone would miss them.
 * @returns {{template: string, offsetLine: number, tsFile: string, htmlFile: string|null}[]}
 */
function templatesFor(tsFile, sf, checker) {
  const out = [];
  const unresolved = [];
  eachNode(sf, (n) => {
    // Shorthand counts. `@Component({ templateUrl })` with `const templateUrl = './viewer.html'` is a
    // `ShorthandPropertyAssignment`, not a `PropertyAssignment`, and Angular statically evaluates it
    // perfectly well — but this predicate skipped it silently, recording neither the template nor an
    // unreadable-template finding. That is the fifth fail-open spelling in this discovery path, after
    // the binding syntax, the decorator, the template value and the quoted key, and it is the same
    // shape every time: a form the compiler understands and the audit does not, which reads as "this
    // component has no template" rather than "this component was not examined".
    const shorthand = ts.isShorthandPropertyAssignment(n);
    if (!shorthand && (!ts.isPropertyAssignment(n) || !n.name)) return;

    // Only `template`/`templateUrl` on a `@Component`, and only with the class that owns it.
    const classDecl = componentClassOf(n);
    if (!classDecl) return;

    // `n.name.getText(sf)` returns `'templateUrl'` **with the quotes** for a quoted key, so
    // `@Component({ 'templateUrl': './viewer.html' })` compared unequal and the component was
    // skipped entirely — the fourth fail-open spelling in this discovery path, after the binding
    // syntax, the decorator and the template value. `assignmentPropertyName` is the resolver the
    // bypass collector already uses for exactly this question, so a quoted, computed or
    // constant-keyed metadata property resolves to the same name an identifier does.
    // For shorthand the name IS the key and also the value expression: `{ templateUrl }` names the
    // property and reads the identifier of the same name.
    const key = shorthand ? n.name.text : assignmentPropertyName(n, checker).name;
    if (key !== 'template' && key !== 'templateUrl') return;

    const valueExpr = shorthand ? n.name : n.initializer;
    const value = staticStringValue(valueExpr, checker);
    if (value === null) {
      // A `@Component` whose template value this cannot read is a component whose bindings were
      // never enumerated, so it is reported rather than skipped — the same stance as a template
      // Angular's parser rejects.
      unresolved.push({
        tsFile,
        key,
        line: lineOf(sf, n),
        text: valueExpr ? valueExpr.getText(sf).slice(0, 60) : '<missing>',
      });
      return;
    }

    if (key === 'template') {
      out.push({
        template: value,
        // An inline template's findings are reported against the initialiser's line. That is only
        // exact for a literal written in place; for a value read from elsewhere the offset is the
        // reference, which is the closest honest anchor available.
        offsetLine: lineOf(sf, valueExpr),
        tsFile,
        htmlFile: null,
        classDecl,
      });
      return;
    }

    const dir = tsFile.split('/').slice(0, -1).join('/');
    const htmlFile = join(dir, value).replace(/\\/g, '/');
    try {
      out.push({
        template: readFileSync(join(ROOT, htmlFile), 'utf8'),
        offsetLine: 0,
        tsFile,
        htmlFile,
        classDecl,
      });
    } catch {
      /* template missing is a compile error, not this gate's business */
    }
  });
  return { templates: out, unresolved };
}

/**
 * The string a `template`/`templateUrl` initialiser evaluates to, or `null`.
 *
 * A literal is read directly; anything else is resolved through the checker as a string-literal
 * type. This accepted **only** literals, and Angular's compiler statically evaluates more than
 * that, so an ordinary refactor removed a component from the audit entirely:
 *
 *     const VIEWER_TEMPLATE = '<video [poster]="posterUrl()"></video>';
 *     @Component({ template: VIEWER_TEMPLATE })
 *
 * Verified — with `posterUrl` retyped to `SafeResourceUrl`, moving the template to a constant
 * returned check 4 to `PASS`. Angular compiles that and reaches the same unsanitised DOM property,
 * so the gate was silent on a live defect because of where the string was written.
 *
 * Asking the checker for a literal type covers a `const`, an `as const`, and an imported or
 * re-exported constant, which is the same move that closed the bypass index and the sanitiser
 * identity. What it cannot resolve — a `let`-widened string, a concatenation, a function call — the
 * caller **reports**, so the set of templates this understands can only grow, and a template it
 * cannot read is never mistaken for a component that has none.
 */
function staticStringValue(node, checker) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (!checker) return null;
  let type;
  try {
    type = checker.getTypeAtLocation(node);
  } catch {
    return null;
  }
  if (!type) return null;
  for (const part of type.isUnionOrIntersection?.() ? type.types : [type]) {
    if (part?.isStringLiteral?.()) return part.value;
  }
  return null;
}

/**
 * Whether a decorator call could carry a component template.
 *
 * This tested `decoratorExpr.expression.getText(sf) !== 'Component'` — the same decide-by-source-text
 * mistake the rest of this file has been rewritten twice to stop making, and here in the **fail-open**
 * direction. `import { Component as NgComponent } from '@angular/core'; @NgComponent({ … })` is
 * ordinary TypeScript and produced no template entry at all, so check 4 had nothing to report on.
 * Verified: aliasing the decorator on `document-viewer.component.ts` while binding a
 * `SafeResourceUrl` to `video[poster]` returned the audit to
 * `PASS — 31 bypass call(s), all accounted for`. `@ngCore.Component({ … })` was invisible the same
 * way.
 *
 * Resolving the identifier through the checker to Angular's own `Component` closes both, and was the
 * first fix here. It is **not** what this does, because it leaves the same shape of hole one step
 * further out: a decorator that wraps or re-exports `Component` from the application's own code
 * resolves to the wrapper, and the template would be skipped again. Establishing identity is the
 * right tool for check 5, where the question is "is this the reviewed sanitiser". It is the wrong
 * tool here.
 *
 * The question check 4 actually needs answered is not "is this Angular's decorator" but "is there a
 * template here, and which class does it belong to". `template`/`templateUrl` inside a decorator
 * argument is itself the evidence, so **any** decorator qualifies, and the identity of the decorator
 * never has to be established.
 *
 * That is inclusive rather than fail-open, and the asymmetry is the justification: a template
 * scanned that no Angular decorator ever compiles can at worst produce one finding on a dormant
 * binding — which is the same trade check 4 already takes everywhere else, since a false positive
 * costs one allowlist line and a false negative is a shipped defect. There is also no way to switch
 * the check off by renaming an import.
 */
function couldCarryComponentTemplate(decoratorCall) {
  const callee = decoratorCall.expression;
  const target = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
  return ts.isIdentifier(target);
}

/**
 * The class whose `@Component` decorator this property assignment belongs to, or `null`.
 *
 * It used to answer only *whether* the property was inside a `@Component`, and check 4 then resolved
 * template expressions against "whichever class in the file resolves the path first". That is a
 * silent pass waiting to happen, and it happens in one valid file: declare a class before the
 * component with a same-named member of a plain type, and the real component's `SafeResourceUrl`
 * member is never consulted. Reproduced with a two-class file — a `PosterDecoy` exposing
 * `posterUrl(): string | null` ahead of the component whose `posterUrl` is
 * `input<SafeResourceUrl | null>()` — and check 4 printed PASS on a live defect.
 *
 * The owning class is the only correct answer, so it is carried through to check 4 rather than
 * rediscovered there.
 */
function componentClassOf(node) {
  let current = node.parent;

  // Up to the ObjectLiteralExpression holding this property.
  while (current && !ts.isObjectLiteralExpression(current)) {
    current = current.parent;
  }
  if (!current) return null;

  // That object literal must be the argument of a `@Component(...)` decorator.
  const call = current.parent;
  if (!call || !ts.isCallExpression(call)) return null;
  const decorator = call.parent;
  if (!decorator || !ts.isDecorator(decorator)) return null;
  const decoratorExpr = decorator.expression;
  if (!ts.isCallExpression(decoratorExpr)) return null;
  if (!couldCarryComponentTemplate(decoratorExpr)) return null;

  // And the decorator hangs off the class this template belongs to.
  const classDecl = decorator.parent;
  return classDecl && ts.isClassDeclaration(classDecl) ? classDecl : null;
}

/**
 * Walks a parsed template collecting NONE-context bindings, with the `@for` variables in scope at
 * each one.
 */
class NoneContextBindingCollector extends TmplAstRecursiveVisitor {
  constructor() {
    super();
    /** @type {{element:string, attr:string, expr:string, line:number, loopVars:Map<string,string>}[]} */
    this.bindings = [];
    this.loopVars = new Map();
  }

  visitElement(element) {
    const guarded = NONE_CONTEXT_BY_ELEMENT.get(element.name);
    if (guarded) {
      for (const input of element.inputs) {
        if (!URL_CARRYING_BINDING_TYPES.has(input.type)) continue;
        if (!guarded.has(input.name)) continue;
        this.bindings.push({
          element: element.name,
          attr: input.name,
          expr: (input.value?.source ?? '').trim(),
          line: input.sourceSpan.start.line + 1,
          loopVars: new Map(this.loopVars),
        });
      }
    }
    super.visitElement(element);
  }

  visitForLoopBlock(block) {
    const outer = this.loopVars;
    this.loopVars = new Map(outer);
    // `resolveTemplateType` looks the iterated expression up as a class member, so `videoSources()`
    // is recorded as `videoSources`. Anything more complex simply fails to resolve, and check 4
    // reports rather than skips — which is the correct answer for an iteration it cannot follow.
    this.loopVars.set(block.item.name, (block.expression?.source ?? '').trim().replace(/\(\s*\)$/, ''));
    super.visitForLoopBlock(block);
    this.loopVars = outer;
  }
}

/**
 * Every NONE-context binding in one template, or the reason the template could not be read.
 *
 * Parsed with Angular's own `parseTemplate` rather than matched with a regex. The regex asked for
 * one spelling — `<audio [src]="…">` — and Angular accepts three that reach the identical DOM
 * property: `bind-src="…"` is the canonical form the bracket syntax desugars to, `[attr.src]="…"`
 * writes the same attribute, and `[(src)]="…"` binds it two-way. `<audio bind-src="blobUrl()">`
 * therefore put a `Safe*` value into a NONE context while check 4 stayed green. Enumerating the
 * bindings the compiler found closes the class instead of adding a fourth alternation.
 *
 * A template that will not parse yields no bindings, so the failure is returned rather than
 * swallowed — the caller reports it, on the same fail-closed grounds as an unresolvable type.
 * @returns {{bindings: object[], parseError: string|null}}
 */
function noneContextBindingsIn(template, templateName) {
  let parsed;
  try {
    parsed = parseTemplate(template, templateName);
  } catch (err) {
    return { bindings: [], parseError: err instanceof Error ? err.message : String(err) };
  }
  if (parsed.errors?.length) {
    return { bindings: [], parseError: parsed.errors.map((e) => e.msg ?? String(e)).join('; ') };
  }
  const collector = new NoneContextBindingCollector();
  for (const node of parsed.nodes) node.visit(collector);
  return { bindings: collector.bindings, parseError: null };
}

// ---------------------------------------------------------------------------------------------
// the checks
// ---------------------------------------------------------------------------------------------

/** A justification of fewer than this many characters is a placeholder, not a rationale. */
const MIN_JUSTIFICATION = 40;

/**
 * Load the allowlist, rejecting entries that do not carry what the gate claims to require.
 *
 * The whole premise is "a bypass is registered *with a written justification*". Accepting an entry
 * on `file::member` alone made `{ "member": "loadPreview" }` sufficient — check 1 passed and the
 * bypass was reported as accounted for, so the gate enforced bookkeeping rather than review. A
 * blank or one-word justification is the same hole with extra steps, hence the length floor.
 * @returns {{raw: object, entries: Map<string, object>, malformed: string[]}}
 */
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

// ---------------------------------------------------------------------------------------------
// the type checker
// ---------------------------------------------------------------------------------------------

/**
 * A real `ts.Program` and `TypeChecker` over `apps/` and `libs/`.
 *
 * Five review rounds argued about the same thing and each ended the same way. The resolver was
 * syntactic — annotation text, declarations gathered by name, alias expansion — and every round found
 * a new spelling that slipped past it: a type alias, an imported interface, a *lowercase* alias, a
 * `computed()` with no type argument, an `as` cast, a generic. Each fix closed one spelling. None
 * could close the class, because "does this text look like a Safe type" is not the question; "what
 * type is this" is, and only the compiler answers that.
 *
 * So it asks the compiler. `checker.getTypeAtLocation` resolves aliases, imports, re-exports, generics
 * and inference identically and by construction, which retires that entire class of finding rather
 * than deflecting the next instance of it.
 *
 * Costs about 2.5s over ~350 files, against a gate that was 0.7s. Worth it: the alternative was a
 * cheap check whose cheapness was the reason it kept being wrong.
 */
function createTypeProgram(tsFiles) {
  let compilerOptions = {};
  try {
    const raw = readFileSync(join(ROOT, 'tsconfig.base.json'), 'utf8');
    // `tsconfig.base.json` carries comments; `ts.parseConfigFileTextToJson` handles them.
    const json = ts.parseConfigFileTextToJson('tsconfig.base.json', raw).config ?? {};
    compilerOptions = ts.parseJsonConfigFileContent(json, ts.sys, ROOT).options;
  } catch {
    // Falling back to defaults still resolves same-file and relative types; path-mapped imports may
    // not resolve, which surfaces as "unresolvable" and therefore as a finding, not a silent pass.
  }
  const program = ts.createProgram(
    tsFiles.map((f) => join(ROOT, f)),
    { ...compilerOptions, noEmit: true, skipLibCheck: true, allowJs: false },
  );
  return { program, checker: program.getTypeChecker() };
}

const SAFE_TYPE_NAME = /^Safe(Url|ResourceUrl|Html|Style|Script|Value)$/;
const SIGNAL_WRAPPERS = new Set([
  'Signal',
  'WritableSignal',
  'InputSignal',
  'InputSignalWithTransform',
  'ModelSignal',
  'OutputRef',
]);

/**
 * Every alternative a template expression can evaluate to.
 *
 * Check 4 previously took `expr.split(/\?\?|\|\|/)[0]` — the first operand only. So
 * `[src]="rawBlobUrl() ?? blobUrl()"` was classified from the plain-string left side and passed,
 * while at runtime a null left side hands Angular the `SafeResourceUrl` on the right and reproduces
 * the exact NONE-context defect this check exists to catch. Every branch is resolved now, and the
 * binding is reported if *any* branch is Safe or unresolvable.
 */
function expressionAlternatives(expr) {
  return expr
    .split(/\?\?|\|\|/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Union and intersection constituents, or the type itself. */
function constituents(type) {
  if (type.isUnionOrIntersection()) return type.types.flatMap(constituents);
  return [type];
}

/** `InputSignal<T>` / `Signal<T>` -> `T`; anything else unchanged. */
function unwrapSignal(type, checker) {
  const name = type.getSymbol()?.getName();
  if (name && SIGNAL_WRAPPERS.has(name)) {
    const args = checker.getTypeArguments(type);
    if (args.length > 0) return args[0];
  }
  return type;
}

/**
 * Whether any constituent of `type` is one of Angular's `Safe*` marker interfaces.
 *
 * Resolved through the symbol, not the printed name, so an alias — of any capitalisation — an import,
 * a re-export or a generic instantiation all reduce to the same answer.
 */
/**
 * How deep a type hierarchy this will walk before giving up.
 *
 * Generous, because cycles are handled by identity below rather than by this cap, so the cap only
 * fires for a genuinely deep chain. Exhausting it is reported as indeterminate, never as safe.
 */
const MAX_TYPE_DEPTH = 24;

/**
 * Whether `type` is, or wraps, one of Angular's `Safe*` marker interfaces.
 *
 * Returns a tri-state, and the third state is the point. Review found the previous version fail-OPEN
 * for a valid hierarchy: an interface can extend another six times before reaching `SafeResourceUrl`,
 * and a depth cap that `return false`d on exhaustion classified that as "not a Safe* type", allowing
 * the wrapped value into a NONE-context binding. Worse, I had written that carve-out into a comment as
 * deliberate — in a file whose entire stated stance is that what it cannot determine, it reports.
 *
 * So: cycles are now prevented by tracking type identity, which is what the cap was standing in for,
 * and exhausting `MAX_TYPE_DEPTH` sets `indeterminate` so the caller routes it to the same
 * "unresolvable type in a NONE context" finding as an unreadable expression. Resolved through symbols
 * rather than printed names, so an alias of any capitalisation, an import, a re-export, a generic
 * instantiation, an array and now a base type all reduce to the same answer.
 *
 * @returns {{safe: boolean, indeterminate: boolean}}
 */
function classifySafeType(type, checker) {
  const seen = new Set();
  let indeterminate = false;

  /** @returns {boolean} true as soon as any constituent is a `Safe*` marker. */
  const walk = (current, depth) => {
    if (!current) return false;
    if (depth > MAX_TYPE_DEPTH) {
      indeterminate = true;
      return false;
    }
    for (const part of constituents(current)) {
      // Identity, not depth, is what makes this terminate. A self-referential or mutually recursive
      // generic can revisit the same type object forever; seeing it twice adds nothing.
      if (seen.has(part)) continue;
      seen.add(part);

      const unwrapped = unwrapSignal(part, checker);
      if (unwrapped !== part) {
        if (walk(unwrapped, depth + 1)) return true;
        continue;
      }

      const symbol = part.aliasSymbol ?? part.getSymbol();
      if (symbol && SAFE_TYPE_NAME.test(symbol.getName())) return true;

      // `SafeResourceUrl[]` and other array wrappers.
      const element = checker.getElementTypeOfArrayType?.(part);
      if (element && walk(element, depth + 1)) return true;

      // Base types. `interface MediaUrl extends SafeResourceUrl {}` still carries Angular's wrapper at
      // runtime and still stringifies in a NONE context, but its own symbol is named `MediaUrl`, so the
      // name test above read it as an ordinary type and the binding was never flagged.
      if (part.isClassOrInterface?.()) {
        for (const base of checker.getBaseTypes(part) ?? []) {
          if (walk(base, depth + 1)) return true;
        }
      }
    }
    return false;
  };

  const safe = walk(type, 0);
  // A hierarchy that turned out to contain a `Safe*` type is not indeterminate, whatever else it hit.
  return { safe, indeterminate: indeterminate && !safe };
}

/**
 * The type a single template expression path resolves to, using the checker, or `null` if it cannot be
 * determined.
 *
 * `null` is reported by the caller, not skipped — that fail-closed default is what makes the check
 * sound regardless of how much of a template grammar this understands.
 */
function resolveTemplateType(expr, classDecl, checker, loopVars) {
  const cleaned = expr.replace(/\(\s*\)/g, '').replace(/\?\./g, '.').replace(/!$/, '').trim();
  const path = cleaned.split('.').map((s) => s.trim()).filter(Boolean);
  if (path.length === 0) return null;
  // Anything with a call argument, index access or operator is out of scope — and therefore reported.
  if (path.some((p) => /[^\w$]/.test(p))) return null;

  const classType = checker.getTypeAtLocation(classDecl);
  const memberType = (holderType, name) => {
    const prop = holderType.getProperty(name);
    if (!prop) return null;
    const declared = prop.valueDeclaration ?? prop.declarations?.[0] ?? classDecl;
    return unwrapSignal(checker.getTypeOfSymbolAtLocation(prop, declared), checker);
  };

  // `any`, `unknown` and the error type are NOT resolutions — they are the checker saying it does not
  // know. Returning them as answers would reinstate exactly the silent pass this check exists to
  // prevent: an unresolvable alias becomes the error type, which is not `Safe*`, so the binding would
  // pass. Treated as unresolved, so the caller reports.
  const isOpaque = (type) =>
    !type ||
    (type.flags & ts.TypeFlags.Any) !== 0 ||
    (type.flags & ts.TypeFlags.Unknown) !== 0 ||
    checker.typeToString(type) === 'error';

  let [root, ...rest] = path;
  let current;

  if (loopVars.has(root)) {
    // `@for (src of videoSources(); …)` — resolve the iterated member, then its element type.
    const iterated = memberType(classType, loopVars.get(root));
    if (!iterated) return null;
    current = checker.getElementTypeOfArrayType?.(iterated) ?? null;
    if (!current) {
      // A non-array iterable: fall back to its index signature if one exists.
      const numberIndex = iterated.getNumberIndexType?.();
      if (!numberIndex) return null;
      current = numberIndex;
    }
  } else {
    current = memberType(classType, root);
    if (!current) return null;
  }

  for (const prop of rest) {
    current = memberType(current, prop);
    if (!current) return null;
  }
  return isOpaque(current) ? null : current;
}

const fileExists = (relPath) => {
  try {
    return statSync(join(ROOT, relPath)).isFile();
  } catch {
    return false;
  }
};

/**
 * The `budgets` object as of the merge base with `origin/main`, or `null` if it cannot be read.
 *
 * Read through `git show` rather than the working tree, because the working tree's copy is the thing
 * being ratcheted. Returns `null` — reported as a note, not a pass — when there is no git, no
 * `origin/main`, or no allowlist at the base (its first commit). Silence would be worse: an
 * unreadable base must not look like an enforced one.
 */
/** The whole allowlist at the merge base, or `null` if it cannot be read. */
function allowlistAtBase() {
  const base = (() => {
    // An explicit override, so a caller can ask "what would the ratchet say against THIS base" without
    // rewriting `refs/remotes/origin/main` in the user's repository. The selftest uses it: repointing a
    // real remote-tracking ref to exercise a control mutated shared state that a crash could leave
    // wrong, and `git fetch` is not something a gate should make necessary.
    const override = process.env['SANITIZER_AUDIT_BASE_REF'];
    for (const ref of override ? [override] : ['origin/main', 'main']) {
      const r = spawnSync('git', ['merge-base', 'HEAD', ref], { cwd: ROOT, encoding: 'utf8' });
      if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
    }
    return null;
  })();
  if (!base) return null;

  const shown = spawnSync('git', ['show', `${base}:${ALLOWLIST_PATH}`], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (shown.status !== 0) return null;
  try {
    return JSON.parse(shown.stdout);
  } catch {
    return null;
  }
}

/** `file::member` -> declared `calls` at the merge base. */
function declaredCallsAtBase(baseAllowlist) {
  const out = new Map();
  if (!baseAllowlist || !isRecord(baseAllowlist.sites)) return out;
  for (const [file, list] of Object.entries(baseAllowlist.sites)) {
    if (!Array.isArray(list)) continue;
    for (const e of list) {
      if (e && typeof e.member === 'string') out.set(`${file}::${e.member}`, e.calls ?? 1);
    }
  }
  return out;
}

function loadAllowlist() {
  const raw = JSON.parse(readFileSync(join(ROOT, ALLOWLIST_PATH), 'utf8'));
  const entries = new Map();
  const malformed = [];

  for (const [file, list] of Object.entries(raw.sites ?? {})) {
    for (const e of list) {
      const where = `${file}::${e.member ?? '<no member>'}`;
      if (typeof e.member !== 'string' || e.member.trim() === '') {
        malformed.push(`${file}: an entry has no "member", so it can never match a bypass.`);
        continue;
      }
      const j = typeof e.justification === 'string' ? e.justification.trim() : '';
      if (j === '') {
        malformed.push(
          `${where}: no "justification". A bypass is registered with a written rationale or not at all.`,
        );
      } else if (j.length < MIN_JUSTIFICATION) {
        malformed.push(
          `${where}: "justification" is ${j.length} characters, under the ${MIN_JUSTIFICATION} minimum — ` +
            `state what makes the bypass safe, not that it is.`,
        );
      }
      if (!['A', 'B', 'C', 'D'].includes(e.category)) {
        malformed.push(
          `${where}: category ${JSON.stringify(e.category)} is not one of A, B, C, D, so the ratchet cannot count it.`,
        );
      }
      if (e.calls !== undefined && (!Number.isInteger(e.calls) || e.calls < 1)) {
        malformed.push(`${where}: "calls" must be a positive integer, got ${JSON.stringify(e.calls)}.`);
      }
      entries.set(`${file}::${e.member}`, { ...e, file });
    }
  }
  return { raw, entries, malformed };
}

/**
 * The reviewed-sanitiser registry, with entries that do not carry what it claims to require rejected.
 *
 * The `sanitisers` list is the entire basis on which check 5 admits anything: five rounds established
 * that "this function escapes HTML" cannot be proven from syntax, so a human reviews each helper once
 * and records *why*. The written rationale is the control. Bypass entries have enforced a trimmed
 * `MIN_JUSTIFICATION` floor since the gate was written, for exactly that reason.
 *
 * This list did not. It tested `typeof s.justification === 'string'`, so `""` satisfied it — and the
 * comment above the call site asserted the opposite, that "entries without a justification are
 * dropped, so an unexplained addition grants nothing". Verified against the working tree: blanking
 * `kd-citation-dialog::escapeHtml`'s justification, and separately reducing it to `"safe"`, left both
 * check 1 and check 5 green with the helper still admitted. The stricter registry was enforcing
 * bookkeeping on the debt it is winding down and nothing at all on the one it is winding up.
 *
 * A rejected entry is **reported** as well as dropped. Dropping alone is fail-closed — check 5 stops
 * admitting the helper and reports the bypass as unsanitised — but it reports the wrong thing, at the
 * call site rather than at the registry entry that is actually malformed, which is how a five-minute
 * fix becomes an afternoon.
 * @returns {{approvedSanitisers: Map<string,string>, malformed: string[]}}
 */
function loadApprovedSanitisers(raw) {
  const approvedSanitisers = new Map();
  const malformed = [];
  const list = Array.isArray(raw.sanitisers) ? raw.sanitisers : [];

  for (const [index, entry] of list.entries()) {
    const where = isRecord(entry) && typeof entry.site === 'string' ? entry.site : `sanitisers[${index}]`;
    if (!isRecord(entry) || typeof entry.site !== 'string' || entry.site.trim() === '') {
      malformed.push(`sanitisers[${index}]: no "site", so it can never match a declaration.`);
      continue;
    }
    if (typeof entry.sha !== 'string' || entry.sha.trim() === '') {
      malformed.push(
        `${where}: no "sha". Registration is pinned to the declaration as reviewed, so without it an ` +
          `edit to the helper could not lapse the review.`,
      );
      continue;
    }
    const justification = typeof entry.justification === 'string' ? entry.justification.trim() : '';
    if (justification === '') {
      malformed.push(
        `${where}: no "justification". A sanitiser is admitted on a written review or not at all — ` +
          `this registry is the only reason check 5 accepts anything.`,
      );
      continue;
    }
    if (justification.length < MIN_JUSTIFICATION) {
      malformed.push(
        `${where}: "justification" is ${justification.length} characters, under the ` +
          `${MIN_JUSTIFICATION} minimum — state what makes the helper safe, not that it is.`,
      );
      continue;
    }
    approvedSanitisers.set(entry.site, entry.sha);
  }

  return { approvedSanitisers, malformed };
}

function main() {
  const tsFiles = [...findFiles('apps', ['.ts']), ...findFiles('libs', ['.ts'])];
  const findings = [];
  const notes = [];

  // An exemption naming a file that does not exist is an exemption for whatever later appears at
  // that path, granted before anyone reviewed it.
  for (const [file, member] of APPROVED_HELPERS) {
    if (!fileExists(file)) {
      findings.push(
        `[helpers] APPROVED_HELPERS exempts '${member}' in ${file}, which does not exist.\n` +
          `    Add the entry in the change that lands the helper, not before it — otherwise the\n` +
          `    exemption pre-approves an unreviewed file at that path.`,
      );
    }
  }

  // One program for the whole run; checks 4 and 5 share its checker.
  const { program, checker } = createTypeProgram(tsFiles);

  // Parse every file once; checks share the result.
  const parsed = new Map();
  for (const f of tsFiles) {
    try {
      parsed.set(f, parse(f));
    } catch {
      /* unreadable file is not this gate's business */
    }
  }

  // A node handed to the checker must belong to the checker's own program: one from a detached
  // `ts.createSourceFile` throws inside the compiler. So every walk below takes the program's copy of
  // a file, and falls back to the detached parse with no checker — which fails closed rather than
  // skipping, since `accessedMemberName` still reads literal spellings and
  // `resolveCalleeDeclaration` returns null without a checker, so check 5 reports.
  /** @type {Map<string, {sf: ts.SourceFile, checker: ts.TypeChecker|null}>} */
  const audited = new Map();
  const detachedOnly = [];
  for (const [file, { sf }] of parsed) {
    const fromProgram = program.getSourceFile(join(ROOT, file));
    audited.set(file, { sf: fromProgram ?? sf, checker: fromProgram ? checker : null });
    if (!fromProgram) detachedOnly.push(file);
  }
  if (detachedOnly.length > 0) {
    notes.push(
      `${detachedOnly.length} file(s) are not in the type program, so only literal spellings were ` +
        `resolved in them and every unproven case in them is reported: ${detachedOnly.join(', ')}`,
    );
  }

  // ---- collect every bypass, with its true enclosing member -----------------------------------
  /** @type {{file:string,member:string,kind:string,line:number}[]} */
  const bypasses = [];
  /** `DomSanitizer` element accesses whose member could not be named; reported by check 1. */
  const unnameableAccesses = [];
  for (const [file, { sf, checker: fileChecker }] of audited) {
    const collected = collectBypasses(sf, fileChecker);
    for (const b of collected.bypasses) bypasses.push({ file, ...b });
    for (const u of collected.unnameable) unnameableAccesses.push({ file, ...u });
  }

  if (printOnly) {
    console.log(JSON.stringify(bypasses, null, 2));
    return 0;
  }

  let allowlist;
  try {
    allowlist = loadAllowlist();
  } catch (err) {
    console.error(`sanitizer-audit: cannot read ${ALLOWLIST_PATH} — ${err.message}`);
    return 1;
  }
  const { raw, entries, malformed } = allowlist;
  const seen = new Set();

  // Sanitiser declarations reviewed once by a human and enforced here by identity.
  const { approvedSanitisers, malformed: malformedSanitisers } = loadApprovedSanitisers(raw);

  const run = (n) => only === null || only === n;

  // Reported under check 1: an entry that does not carry a justification is not a registration, so
  // treating it as one is the same failure as having no entry at all.
  if (run(1)) {
    for (const m of [...malformed, ...malformedSanitisers]) {
      findings.push(`[1] unusable allowlist entry  ${m}`);
    }
    // Also check 1's business: it owns "every bypass is accounted for", and a member it cannot name
    // cannot be accounted for. Reported unconditionally rather than only when the name looks like a
    // bypass, because the name is precisely what is unavailable.
    for (const u of unnameableAccesses) {
      findings.push(
        `[1] unnameable DomSanitizer member  ${u.file}:${u.line}\n` +
          `    member '${u.member}' reads '${u.text}' — an element access on a DomSanitizer whose\n` +
          `    member name does not resolve to a string literal, so it cannot be told from a bypass.\n` +
          `    A member this cannot name cannot be registered, categorised, budgeted or checked for\n` +
          `    sanitiser pairing, so it reports. Index the sanitizer with a literal, or call the\n` +
          `    member directly.`,
      );
    }
  }

  // ---- check 1: unregistered bypass, and undeclared extra calls in a registered member ---------
  //
  // Keying by `file::member` alone cannot enforce "every bypass call is accounted for": a member
  // may legitimately hold several calls (kd-citation-dialog's `highlightExcerpt` holds three), and
  // a bare `entries.has(key)` would then wave through a fourth. So each entry declares `calls`
  // (default 1) and the actual count is compared against it. More than declared is new debt;
  // fewer is a stale declaration. Both are red, so the count in the allowlist stays true.
  const callsByKey = new Map();
  for (const b of bypasses) {
    const key = `${b.file}::${b.member}`;
    if (!callsByKey.has(key)) callsByKey.set(key, []);
    callsByKey.get(key).push(b);
  }

  for (const [key, calls] of callsByKey) {
    const { file, member } = calls[0];
    // NOTE: an approved helper is deliberately NOT exempt from check 1. Being the one sanctioned
    // place to hold a bypass is a reason to register it with a justification, not a reason to skip
    // registration — and skipping it also skipped declared-call counting and the category budget,
    // so a second bypass inside a helper would have passed silently. The plan's own sample entry in
    // section 5.1 is a helper entry, which is the shape this now requires. Checks 3 and 5 keep their
    // exemptions, because those two ask "is this bypass redundant / unpaired", and the helper is
    // where the non-redundant, paired one is supposed to live.
    const entry = entries.get(key);
    if (!entry) {
      if (run(1)) {
        const isHelper = APPROVED_HELPERS.get(file) === member;
        for (const b of calls) {
          findings.push(
            `[1] unregistered bypass  ${b.file}:${b.line}\n` +
              `    member '${b.member}' calls bypassSecurityTrust${b.kind} with no entry in ${ALLOWLIST_PATH}.\n` +
              (isHelper
                ? `    This is an approved helper, which is exactly why it needs an entry: the audited\n` +
                  `    bypass is the one a reviewer must be able to find. Register it with a justification.`
                : `    Add one with a justification, or route it through trustObjectUrl / renderTrustedHtml.`),
          );
        }
      }
      continue;
    }
    seen.add(key);
    const declared = entry.calls ?? 1;
    if (calls.length !== declared && run(1)) {
      findings.push(
        `[1] bypass count mismatch  ${file}::${member}\n` +
          `    ${calls.length} bypass call(s) at line(s) ${calls.map((c) => c.line).join(', ')}, ` +
          `but the allowlist declares ${declared}.\n` +
          (calls.length > declared
            ? `    A registered member is not a blanket exemption. Justify the extra call(s) and\n` +
              `    raise "calls" — the budget below counts calls, so this is new debt.`
            : `    The declaration is stale. Lower "calls" to ${calls.length} to lock the gain in.`),
      );
    }
  }

  // ---- check 2: stale allowlist entry ---------------------------------------------------------
  if (run(2)) {
    for (const [key, e] of entries) {
      if (seen.has(key)) continue;
      const exists = parsed.has(e.file);
      findings.push(
        `[2] stale allowlist entry  ${e.file}::${e.member}\n` +
          (exists
            ? `    The file no longer has a bypass in that member. Remove the entry.`
            : `    The file no longer exists. Remove the entry.`),
      );
    }
  }

  // ---- check 3: redundant bypass on a locally-minted object URL --------------------------------
  // Known category A and B debt is recorded in the allowlist and suppressed here; the budget
  // ratchet below is what forces it down. An *unrecorded* one is a regression.
  if (run(3)) {
    for (const [file, { sf, checker: fileChecker }] of audited) {
      eachNode(sf, (n) => {
        if (!ts.isCallExpression(n)) return;
        const bypassName = accessedMemberName(n.expression, fileChecker);
        if (!bypassName || !/^bypassSecurityTrust(Url|ResourceUrl)$/.test(bypassName)) return;
        const member = enclosingMemberName(n);
        const key = `${file}::${member}`;
        if (entries.has(key) || APPROVED_HELPERS.get(file) === member) return;
        // Does the same member mint an object URL?
        let mints = false;
        for (let p = n.parent; p; p = p.parent) {
          if (
            ts.isMethodDeclaration(p) ||
            ts.isPropertyDeclaration(p) ||
            ts.isFunctionDeclaration(p) ||
            ts.isConstructorDeclaration(p)
          ) {
            mints = /URL\.createObjectURL/.test(p.getText(sf));
            break;
          }
        }
        if (mints) {
          findings.push(
            `[3] redundant bypass  ${file}:${lineOf(sf, n)}\n` +
              `    member '${member}' bypasses sanitization on a URL it minted with URL.createObjectURL.\n` +
              `    Angular's URL sanitizer already accepts blob:, so a value bound only to img[src] needs no bypass.\n` +
              `    If it also feeds an iframe, use trustObjectUrl.`,
          );
        }
      });
    }
  }

  // ---- check 4: Safe* value in a SecurityContext.NONE binding ---------------------------------
  //
  // Fails CLOSED. A binding whose type this cannot resolve is reported, not skipped.
  //
  // "Cannot tell, so do not flag" is the right default for a broad check, and it is what checks 1-3
  // do. It is the wrong default here, for two reasons. The population is tiny — six NONE-context
  // bindings in the whole repository — so a false positive costs one allowlist line, while a false
  // negative is a shipped defect of exactly the kind this check was written after. And every
  // documented evasion (a type alias, an imported interface, `computed()` with no type argument, an
  // `as` cast) surfaced as *unresolvable*, not as resolving to something benign. Under-reporting was
  // therefore indistinguishable from passing, which is how the check could be green while the thing
  // it guards was broken.
  if (run(4)) {
    for (const [file, { sf, checker: fileChecker }] of audited) {
      // Templates are read from the program's copy of the file, so `tpl.classDecl` is a node the
      // checker can resolve. Without a checker there is nothing to resolve against, and every
      // binding in the file is reported — the fail-closed default, not a gap.
      const { templates, unresolved: unreadableTemplates } = templatesFor(file, sf, fileChecker);
      for (const u of unreadableTemplates) {
        findings.push(
          `[4] unreadable template value  ${u.tsFile}:${u.line}\n` +
            `    @Component's '${u.key}' is '${u.text}', which does not resolve to a string.\n` +
            `    Angular statically evaluates more than a literal, so this component's bindings were\n` +
            `    never enumerated and a Safe* value in a NONE context here would go unseen. Reported\n` +
            `    rather than skipped. Write the ${u.key} as a literal, or as a const the checker can\n` +
            `    resolve.`,
        );
      }
      if (templates.length === 0) continue;

      for (const tpl of templates) {
        const templateName = tpl.htmlFile ?? tpl.tsFile;
        const placeOf = (lineInTpl) =>
          tpl.htmlFile ? `${tpl.htmlFile}:${lineInTpl}` : `${tpl.tsFile}:${tpl.offsetLine + lineInTpl - 1}`;

        const { bindings, parseError } = noneContextBindingsIn(tpl.template, templateName);
        if (parseError) {
          findings.push(
            `[4] unparsable template  ${templateName}\n` +
              `    Angular's own parser rejected it: ${parseError}\n` +
              `    A template that cannot be parsed cannot be scanned for NONE-context bindings, and a\n` +
              `    check that skipped it would be silent exactly where it is least able to see. Fix the\n` +
              `    template, or the component will not compile either.`,
          );
          continue;
        }

        for (const { element, attr, expr, line, loopVars } of bindings) {
          const where = placeOf(line);

          // EVERY alternative, not just the first. `a() ?? b()` hands Angular `b` whenever `a` is
          // null, so a Safe value on any branch reproduces the defect.
          const branches = expressionAlternatives(expr);
          let safeBranch = null;
          let unresolved = branches.length === 0 ? expr : null;

          for (const branch of branches) {
            // Only the class that OWNS this template. Trying every class in the file and taking the
            // first that resolved meant a same-named member on an unrelated class declared earlier
            // could answer for the component — masking a `SafeResourceUrl` behind a `string` and
            // passing on a live defect.
            const resolved = fileChecker
              ? resolveTemplateType(branch, tpl.classDecl, fileChecker, loopVars)
              : null;
            if (!resolved) {
              unresolved = branch;
              break;
            }
            const { safe, indeterminate } = classifySafeType(resolved, fileChecker);
            if (indeterminate) {
              // A hierarchy too deep to walk is a type this could not decide about, which is the same
              // situation as an expression it could not resolve — so it takes the same reporting path
              // rather than being read as "not a Safe* type".
              unresolved = branch;
              break;
            }
            if (safe) {
              safeBranch = { branch, text: fileChecker.typeToString(resolved) };
              break;
            }
          }

          if (unresolved !== null) {
            findings.push(
              `[4] unresolvable type in a NONE context  ${where}\n` +
                `    <${element} [${attr}]="${expr}"> — the type of '${unresolved}' could not be determined.\n` +
                `    ${element}[${attr}] is SecurityContext.NONE: no sanitiser runs, so a Safe* value here is\n` +
                `    never unwrapped and stringifies into the attribute. Because it cannot rule that out, it\n` +
                `    reports. Bind a plainly-typed member the checker can resolve.`,
            );
            continue;
          }
          if (!safeBranch) continue;
          findings.push(
            `[4] Safe* value in a NONE context  ${where}\n` +
              `    <${element} [${attr}]="${expr}"> — branch '${safeBranch.branch}' resolves to '${safeBranch.text}'.\n` +
              `    ${element}[${attr}] is SecurityContext.NONE: no sanitiser runs, the Safe* value is never\n` +
              `    unwrapped, and toString() writes "SafeValue must use [property]=binding: …" into ${attr}.\n` +
              `    Bind the raw string here and keep the Safe* value for iframe[src].`,
          );
        }
      }
    }
  }

  // ---- check 5: unpaired trusted HTML ---------------------------------------------------------
  if (run(5)) {
    // An indirect HTML bypass has no argument at the reference site, so the provenance walk below
    // cannot see what it will be called with. `collectBypasses` records these now, so they are
    // registered and budgeted — but being *counted* is not being *checked*, and
    // `const trust = sanitizer.bypassSecurityTrustHtml.bind(sanitizer); trust(raw)` would otherwise
    // skip the pairing check entirely. Reported rather than traced: indirection through a variable is
    // exactly what this check cannot follow, and it has no legitimate use here.
    for (const b of bypasses) {
      if (b.kind !== 'Html' || !b.indirect) continue;
      findings.push(
        `[5] indirect trusted HTML  ${b.file}:${b.line}\n` +
          `    member '${b.member}' takes a reference to bypassSecurityTrustHtml instead of calling it.\n` +
          `    Once it is in a variable this check cannot see what it is called with, so the sanitiser\n` +
          `    pairing cannot be established. Call it directly, or route the HTML through\n` +
          `    renderTrustedHtml.`,
      );
    }
    // `audited` rather than the program directly: this used to look the file up itself and
    // `continue` when the program did not carry it, which made an unchecked file indistinguishable
    // from a clean one in the output.
    for (const [file, { sf, checker: fileChecker }] of audited) {
      const approvedHelper = APPROVED_HELPERS.get(file);
      eachNode(sf, (n) => {
        if (!ts.isCallExpression(n)) return;
        if (accessedMemberName(n.expression, fileChecker) !== 'bypassSecurityTrustHtml') return;

        // Skip only if this bypass is inside the approved helper function
        if (approvedHelper) {
          const member = enclosingMemberName(n);
          if (member === approvedHelper) return;
        }
        let host = null;
        for (let p = n.parent; p; p = p.parent) {
          if (
            ts.isMethodDeclaration(p) ||
            ts.isPropertyDeclaration(p) ||
            ts.isGetAccessorDeclaration(p) ||
            ts.isFunctionDeclaration(p)
          ) {
            host = p;
            break;
          }
        }
        const arg = n.arguments?.[0];
        if (!arg) return; // no argument is a compile error, not this gate's business
        const sanitized = sanitizerReaches(arg, host ?? sf, sf, fileChecker, approvedSanitisers);
        if (!sanitized) {
          findings.push(
            `[5] unsanitised trusted HTML  ${file}:${lineOf(sf, n)}\n` +
              `    member '${enclosingMemberName(n)}' passes '${arg.getText(sf).slice(0, 60)}' to\n` +
              `    bypassSecurityTrustHtml, and this check could not trace that value back to\n` +
              `    DOMPurify.sanitize / escapeHtml / renderTrustedHtml.\n` +
              `    Safety here is a pairing, not a property of either half. note:note is user-authored, so an\n` +
              `    unpaired render path is stored XSS.`,
          );
        }
      });
    }
  }

  // ---- the ratchet ----------------------------------------------------------------------------
  // Counts declared *calls*, not entries. Counting entries would let a member that already holds
  // one bypass absorb more without moving any number the ratchet watches.
  const counts = { A: 0, B: 0, C: 0, D: 0 };
  for (const [, e] of entries) {
    if (counts[e.category] !== undefined) counts[e.category] += e.calls ?? 1;
  }
  notes.push(
    `registered bypass calls: ${counts.A + counts.B + counts.C + counts.D} in ${entries.size} member(s)` +
      `  (A ${counts.A}, B ${counts.B}, C ${counts.C}, D ${counts.D})`,
  );
  // A budget read only from the working tree is not a ratchet. Both halves of the comparison were
  // in the same editable file, so a contributor could raise a number, reclassify an entry into a
  // roomier category, or delete `budgets` entirely — `?? {}` then iterated nothing and the gate went
  // green. The claim "the counts may shrink and never grow" was unenforced.
  //
  // So the ceiling comes from the merge base, which the contributor cannot edit in their own commit.
  const CATEGORIES = ['A', 'B', 'C', 'D'];
  const baseAllowlist = allowlistAtBase();
  const baseBudgets = isRecord(baseAllowlist?.budgets) ? baseAllowlist.budgets : null;

  // A category total is not a fine enough ceiling on its own. `highlightExcerpt` declares 3 calls
  // under D; if a later change removes a different D entry, freeing one, and grows that member to 4,
  // the total is unchanged and the audit passes — one member quietly absorbing more bypasses is
  // exactly the shape the per-call counting was introduced to stop.
  const baseCalls = declaredCallsAtBase(baseAllowlist);
  for (const [key, e] of entries) {
    const before = baseCalls.get(key);
    const now = e.calls ?? 1;
    if (typeof before === 'number' && now > before) {
      findings.push(
        `[ratchet] ${key} declared ${before} bypass call(s) at the merge base and now declares ${now}.\n` +
          `    An individual member may not absorb more bypasses, even where the category total is\n` +
          `    unchanged because another entry shrank.`,
      );
    }
  }

  if (!isRecord(raw.budgets)) {
    findings.push(
      `[ratchet] ${ALLOWLIST_PATH} has no 'budgets' object.\n` +
        `    Without it the ratchet iterates nothing and this gate passes by omission, which is how a\n` +
        `    ceiling gets removed rather than lowered.`,
    );
  } else {
    for (const cat of CATEGORIES) {
      const budget = raw.budgets[cat];
      if (typeof budget !== 'number') {
        findings.push(
          `[ratchet] category ${cat} has no numeric budget in ${ALLOWLIST_PATH}.\n` +
            `    Every category needs one; a missing key is indistinguishable from an unlimited one.`,
        );
        continue;
      }
      if (counts[cat] > budget) {
        findings.push(
          `[ratchet] category ${cat} has ${counts[cat]} bypass call(s), budget is ${budget}.\n` +
            `    Remove the bypass, or justify a new entry — the budget is a ceiling, not a target.`,
        );
      }
      if (baseBudgets && typeof baseBudgets[cat] === 'number' && budget > baseBudgets[cat]) {
        findings.push(
          `[ratchet] category ${cat}'s budget rose from ${baseBudgets[cat]} to ${budget}.\n` +
            `    A budget may only decrease. Raising it in the same change that needs the headroom is\n` +
            `    exactly what the ratchet exists to prevent.`,
        );
      }
      // Stale headroom is a finding, not a note.
      //
      // As a note it left the ratchet unenforced in the direction that actually matters: one change
      // removes a bypass without lowering the budget, and a later change drops a *different* bypass
      // into the slack. Neither the current nor the merge-base budget rises, so both pass, and the
      // debt is back where it started while the ceiling never moved. Requiring the removal and the
      // lowering to land together is what makes "counts may shrink and never grow" true.
      if (counts[cat] < budget) {
        findings.push(
          `[ratchet] category ${cat} has ${counts[cat]} bypass call(s) but its budget is still ${budget}.\n` +
            `    Lower the budget to ${counts[cat]} in this change. Leaving the headroom lets a later\n` +
            `    change reintroduce a bypass into the slack without raising any budget, which is the\n` +
            `    ratchet slipping rather than holding.`,
        );
      }
    }
  }
  if (!baseBudgets) {
    notes.push(
      'could not read budgets at the merge base, so only the current ceiling was enforced — a raised budget would not be caught in this run',
    );
  }

  // ---- report ---------------------------------------------------------------------------------
  for (const n of notes) console.log(`  ${n}`);
  if (only !== null) console.log(`  running check ${only} only — this run cannot speak for the others`);

  if (findings.length === 0) {
    console.log(`sanitizer-audit: PASS — ${bypasses.length} bypass call(s), all accounted for`);
    return 0;
  }
  console.log(`\nsanitizer-audit: FAIL — ${findings.length} finding(s)\n`);
  for (const f of findings) console.log(`${f}\n`);
  explainPossibleLeftovers(findings);
  return 1;
}

/**
 * Say so when a finding sits in a file `sanitizer-audit.selftest.mjs` perturbs on purpose.
 *
 * The verdict is **not** softened: the file really does contain that defect right now, and a gate
 * that repaired the tree out from under itself would be a gate nobody could trust to have looked.
 * This only explains, because without it the symptom is unreadable — a killed `beta:gate` leaves a
 * perturbation behind, and the next run fails here, in a file the reader has never touched, with
 * nothing on screen connecting it to the harness.
 *
 * This is the half that reaches a human. `sanitizer-audit` is registered **before**
 * `sanitizer-selftest` and the gate stops at the first failure, so the selftest's own recovery
 * never gets to run after an interrupted gate; the one command below is what breaks that loop
 * (NXSAT-751).
 */
function explainPossibleLeftovers(findings) {
  const suspect = [...new Set(findings.flatMap((f) => isLeftover(f) || []))];
  if (suspect.length === 0) return;

  const marker = readMarker(ROOT);
  console.log(
    `NOTE — ${suspect.length === 1 ? 'this file is' : 'these files are'} perturbed on purpose by\n` +
      `  scripts/beta-harness/sanitizer-audit.selftest.mjs, which writes a defect into the real\n` +
      `  file, checks that this audit reports it, and restores it afterwards:\n` +
      suspect.map((p) => `    ${p}\n`).join('') +
      (marker
        ? `\n  A marker from an INTERRUPTED selftest run is present${
            marker.startedAt ? ` (started ${marker.startedAt})` : ''
          },\n  so the finding above is very likely that leftover rather than a defect you wrote.\n`
        : `\n  No interrupted-run marker is present, so this is more likely a real finding — but if a\n  gate run was killed before this fix shipped, it may still be a leftover.\n`) +
      `\n  To undo a leftover:  node scripts/beta-harness/sanitizer-audit.selftest.mjs --recover-only\n` +
      `  It restores only files that still hold that run's bytes, so an edit of your own is never\n` +
      `  discarded. If it declines, 'git diff' those paths and decide by hand.`,
  );
}

process.exit(main());
