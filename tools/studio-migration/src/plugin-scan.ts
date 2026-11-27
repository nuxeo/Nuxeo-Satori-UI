/**
 * Check 9's scan (docs/business-apps/studio-migration.md, section 6): what a plugin's code must
 * never do, read from its source and never run, and the code that must never be in configuration.
 *
 * - **Unsafe patterns**, in the code it ships (every `.ts` but its specs, every template): data
 *   written as HTML (`innerHTML`, `outerHTML`, `[innerHTML]`, `srcdoc`…), Angular's sanitiser
 *   bypassed (`DomSanitizer`, `bypassSecurityTrust*`), text run as code (`eval`, `new Function`, a
 *   string given to a timer, an inline `on…` handler), a URL bound to `[src]` that is not a blob
 *   URL it makes and revokes, a Nuxeo URL in a `src`, the network reached past the app's services
 *   (`HttpClient`, `fetch`, `XMLHttpRequest`, an interceptor…), the browser's storage or cookies,
 *   and an import of anything but Angular, RxJS, the platform's published entry points and its own
 *   files.
 * - **This repository's conventions:** standalone components with a `templateUrl`, `inject()`
 *   rather than constructor parameters, `takeUntilDestroyed()` on every `.subscribe()`, signals
 *   rather than a `BehaviorSubject`, and no component injecting `NuxeoApiBase`.
 * - **Its public API**, `src/index.ts`: named exports of its own files only, no class, each
 *   function's return type written, and no type in any of them from a package other than Angular
 *   and the platform.
 * - **Code in configuration:** no string of the conversion's app definition, or of the plugin's
 *   `studio-plugin.json`, holds a script, markup, a Polymer binding or a function.
 *
 * It is a tripwire, not a proof: code that hides what it does, building a property's name from
 * pieces, say, can pass it. That is why a person reviews every plugin before accepting it.
 */
import * as ts from 'typescript';
import { isRecord } from '@agentic-ui/shared/app-definition';
import { parseHtml } from './markup';
import type { PluginSource } from './plugins';

/** The platform's entry points a plugin may import, as `check-extension-library.mjs` lists them. */
const PUBLISHED = new Set([
  '@nuxeo/satori-platform',
  '@nuxeo/satori-platform/extensions',
  '@nuxeo/satori-platform/app-config',
  '@nuxeo/satori-platform/components',
  '@nuxeo/satori-platform/components-satori',
  '@nuxeo/satori-platform/nuxeo-client',
  '@nuxeo/satori-platform/ui',
]);
/** What a plugin may take from `@angular/common/http`: types that send nothing. */
const HTTP_TYPES = new Set([
  'HttpErrorResponse',
  'HttpParams',
  'HttpHeaders',
  'HttpContext',
  'HttpContextToken',
]);

/** Names that write HTML, wherever they appear: as a member, a string or a binding. */
const HTML_SINKS = new Set([
  'innerHTML',
  'outerHTML',
  'insertAdjacentHTML',
  'srcdoc',
  'createContextualFragment',
]);
/** Names that reach the network, or step into every request the app sends. */
const NETWORK = new Set([
  'HttpClient',
  'HttpBackend',
  'HttpXhrBackend',
  'HttpHandler',
  'HttpFeatureKind',
  'HTTP_INTERCEPTORS',
  'withInterceptors',
  'withInterceptorsFromDi',
  'HttpInterceptorFn',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'sendBeacon',
]);
const STORAGE = new Set(['localStorage', 'sessionStorage', 'indexedDB', 'cookie', 'cookieStore']);
/** Names that run code of the plugin when the app starts, before anything places it. */
const STARTUP = new Set([
  'provideEnvironmentInitializer',
  'provideAppInitializer',
  'provideBrowserGlobalErrorListeners',
  'APP_INITIALIZER',
  'ENVIRONMENT_INITIALIZER',
  'PLATFORM_INITIALIZER',
  'APP_BOOTSTRAP_LISTENER',
]);
/** Node's and the page's own globals, which a component has no use for. */
const GLOBALS = new Set(['process', 'globalThis', 'require', '__dirname', '__filename', 'module']);
/** The calls that change a built-in object, or any object behind the code's back. */
const REDEFINING =
  /^(?:Object\.(?:defineProperty|defineProperties|setPrototypeOf)|Reflect\.(?:defineProperty|set|setPrototypeOf))$/;

/** A source file of the plugin that it ships: not a spec, not its test setup. */
export function shipped(path: string): boolean {
  return (
    path.startsWith('src/') &&
    !/\.(spec|test)\.ts$/.test(path) &&
    path !== 'src/test-setup.ts' &&
    (path.endsWith('.ts') || path.endsWith('.html'))
  );
}

/** The files a plugin library holds outside `src/`: the template's, and its own two. */
const LIBRARY_FILES = new Set([
  'README.md',
  'project.json',
  'studio-plugin.json',
  'tsconfig.json',
  'tsconfig.lib.json',
  'tsconfig.spec.json',
  'vite.config.mts',
]);

/** Every unsafe pattern and every break of the conventions in a plugin's files. */
export function scanPlugin(source: PluginSource): string[] {
  const findings: string[] = [];
  const at = (path: string, line: number): string => `${source.library}/${path}:${line}`;
  for (const path of Object.keys(source.files).sort()) {
    const known = path.startsWith('src/')
      ? /\.(?:ts|html|scss)$/.test(path) && !path.split('/').some((part) => part.startsWith('.'))
      : LIBRARY_FILES.has(path);
    if (!known)
      findings.push(
        `${source.library}/${path} is a file check 9 does not read: a plugin holds TypeScript, its templates and its styles, under src/, and the template's files beside them`,
      );
  }
  for (const [path, text] of Object.entries(source.files).sort(([a], [b]) => a.localeCompare(b))) {
    if (!path.startsWith('src/')) continue;
    if (path.endsWith('.scss')) {
      findings.push(...scanStyle(text, (line) => at(path, line)));
      continue;
    }
    if (/\.spec\.ts$/.test(path)) {
      findings.push(...scanSpec(text, path, (line) => at(path, line)));
      continue;
    }
    if (!shipped(path)) continue;
    if (path.endsWith('.html')) {
      const component = source.files[path.replace(/\.html$/, '.ts')] ?? '';
      findings.push(...scanTemplate(text, (line) => at(path, line), component));
      continue;
    }
    findings.push(...scanCode(text, path, (line) => at(path, line)));
  }
  return findings;
}

/** What a template must not do. `component` is its component's source, for its blob URLs. */
function scanTemplate(html: string, at: (line: number) => string, component: string): string[] {
  const findings: string[] = [];
  const document = parseHtml(`<body>${html}</body>`);
  const lineOf = (needle: string): number => {
    const index = html.toLowerCase().indexOf(needle.toLowerCase());
    return index === -1 ? 1 : html.slice(0, index).split('\n').length;
  };
  // Read from the component's syntax tree, so that a comment naming them counts for nothing.
  const blobs = callsBoth(component, 'createObjectURL', 'revokeObjectURL');
  for (const element of Array.from(document.body.querySelectorAll('*'))) {
    const tag = element.localName;
    if (['script', 'iframe', 'object', 'embed', 'base', 'link', 'meta', 'frame'].includes(tag))
      findings.push(
        `${at(lineOf(`<${tag}`))}: it draws a <${tag}>, which loads, runs or frames what it names`,
      );
    for (const attribute of Array.from(element.attributes)) {
      // The HTML parser keeps attribute names in lower case: `[innerHTML]` is `[innerhtml]`.
      const name = attribute.name;
      const bare = name.replace(/^\[(?:attr\.)?|\]$|^bind-(?:attr\.)?|^attr\./g, '');
      const bound = name !== bare || /\{\{/.test(attribute.value);
      if (['innerhtml', 'outerhtml', 'srcdoc'].includes(bare))
        findings.push(
          `${at(lineOf(name))}: it writes data as HTML, with ${name}="${attribute.value}"`,
        );
      else if (/^on[a-z]+$/.test(name))
        findings.push(
          `${at(lineOf(name))}: it runs text as code, in the handler ${name}="${attribute.value}"`,
        );
      else if (
        (/^(?:\[|bind-)(?:style|ngstyle)/.test(name) &&
          (/url\s*\(/i.test(attribute.value) ||
            /image|background|mask|content|cursor|src/.test(name) ||
            /^(?:\[|bind-)(?:style|ngstyle)\]?$/.test(name))) ||
        (name === 'style' && /url\s*\(/i.test(attribute.value))
      )
        findings.push(
          `${at(lineOf(name))}: it binds a URL into a style, ${name}="${attribute.value}", which the browser fetches past the app's services`,
        );
      else if (bare === 'action' || bare === 'formaction')
        findings.push(
          `${at(lineOf(name))}: it sends a form to ${attribute.value}, past the app's services`,
        );
      else if (['src', 'srcset', 'poster', 'data', 'ngsrc', 'ngsrcset'].includes(bare)) {
        if (/^\s*(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(attribute.value))
          findings.push(
            `${at(lineOf(name))}: it loads ${attribute.value} from another origin, in ${name}`,
          );
        else if (/\/nuxeo\//.test(attribute.value))
          findings.push(
            `${at(lineOf(name))}: it names a Nuxeo URL in ${name}, which the browser fetches past the app's services`,
          );
        else if (bound && !blobs)
          findings.push(
            `${at(lineOf(name))}: it binds ${name}="${attribute.value}", which the browser fetches past the app's services: fetch it through a service, and show a blob URL it revokes`,
          );
      }
    }
  }
  return findings;
}

/** What a `.ts` file must not do, from its syntax tree. */
function scanCode(text: string, path: string, at: (line: number) => string): string[] {
  const findings: string[] = [];
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const line = (node: ts.Node): number =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const here = (node: ts.Node): string => at(line(node));
  /** The classes of the file decorated `@Component`. */
  const components = new Set<ts.ClassDeclaration>();

  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text.startsWith('.') &&
      !insideLibrary(path, node.moduleSpecifier.text)
    )
      findings.push(
        `${here(node)}: it imports ${node.moduleSpecifier.text}, outside the plugin's own files`,
      );
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const from = node.moduleSpecifier.text;
      const named = node.importClause?.namedBindings;
      if (from === '@angular/common/http') {
        const names =
          named && ts.isNamedImports(named)
            ? named.elements.map((element) => (element.propertyName ?? element.name).text)
            : ['*'];
        for (const name of names.filter((candidate) => !HTTP_TYPES.has(candidate)))
          findings.push(
            `${here(node)}: it takes ${name} from @angular/common/http: a plugin reaches Nuxeo through the app's services, never with an HTTP client of its own`,
          );
      } else if (
        !from.startsWith('.') &&
        !from.startsWith('@angular/') &&
        from !== 'rxjs' &&
        from !== 'rxjs/operators' &&
        !PUBLISHED.has(from)
      )
        findings.push(
          `${here(node)}: it imports ${from}, which is neither Angular, RxJS, a published entry point of the platform nor a file of its own`,
        );
    }
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
      const name = node.text;
      const parent = node.parent;
      // `import { HttpClient }` is reported above, by what it imports.
      const inImport = ts.isImportSpecifier(parent) || ts.isImportClause(parent);
      // The name a class or an object gives its own member, such as a method `fetch()`.
      const declared =
        (ts.isMethodDeclaration(parent) ||
          ts.isPropertyDeclaration(parent) ||
          ts.isPropertyAssignment(parent) ||
          ts.isGetAccessorDeclaration(parent) ||
          ts.isPropertySignature(parent) ||
          ts.isMethodSignature(parent)) &&
        parent.name === node;
      // Of another object than the page's, as `this.records.fetch()`.
      const member =
        ts.isPropertyAccessExpression(parent) &&
        parent.name === node &&
        !/^(?:window|globalThis|self|document|navigator)$/.test(parent.expression.getText(source));
      if (HTML_SINKS.has(name))
        findings.push(`${here(node)}: it writes data as HTML, through ${name}`);
      else if (name.startsWith('bypassSecurityTrust') || name === 'DomSanitizer')
        findings.push(`${here(node)}: it trusts a value past Angular's sanitiser, with ${name}`);
      else if (NETWORK.has(name) && !inImport)
        findings.push(
          `${here(node)}: it reaches the network past the app's services, with ${name}`,
        );
      else if (STORAGE.has(name) && !declared)
        findings.push(`${here(node)}: it reads the browser's storage or cookies, through ${name}`);
      else if (name === 'eval' && !declared)
        findings.push(`${here(node)}: it runs text as code, with eval`);
      else if (name === 'fetch' && !declared && !member)
        findings.push(`${here(node)}: it reaches the network past the app's services, with fetch`);
      else if (name === 'BehaviorSubject' && !inImport)
        findings.push(`${here(node)}: it keeps state in a BehaviorSubject: use signal()`);
      else if (STARTUP.has(name) && !inImport && !declared)
        findings.push(
          `${here(node)}: it runs code when the app starts, with ${name}: a plugin of an element runs only where it is placed`,
        );
      else if ((name === 'isDevMode' || name === 'ngDevMode') && !inImport && !declared)
        findings.push(
          `${here(node)}: it depends on ${name}, which tests and a production build answer differently`,
        );
      else if (name === 'navigator' && !declared && !member)
        findings.push(`${here(node)}: it reads navigator, which differs where it runs`);
      else if (
        /^(?:ExtensionRuleRegistry|ExtensionActionRegistry|ExtensionSlotRegistry|ExtensionComponentRegistry|AppExtensionsService)$/.test(
          name,
        ) &&
        !inImport &&
        !declared
      )
        findings.push(
          `${here(node)}: it reaches ${name}: a plugin registers its component through its provider, and changes no other registration`,
        );
      else if (GLOBALS.has(name) && !declared && !member)
        findings.push(`${here(node)}: it reaches ${name}, one of Node's or the page's own globals`);
      else if (
        name === 'constructor' &&
        ts.isPropertyAccessExpression(parent) &&
        ts.isPropertyAccessExpression(parent.expression) &&
        parent.expression.name.text === 'constructor'
      )
        findings.push(`${here(node)}: it runs text as code, through a constructor's constructor`);
      else if (name === 'prototype' && ts.isPropertyAccessExpression(parent) && assigned(parent))
        findings.push(`${here(node)}: it changes a built-in, through its prototype`);
    }
    if (
      ts.isElementAccessExpression(node) &&
      /^(?:window|globalThis|self|document|navigator)$/.test(node.expression.getText(source)) &&
      !ts.isStringLiteralLike(node.argumentExpression)
    )
      findings.push(
        `${here(node)}: it reaches ${node.expression.getText(source)} by a name it works out as it runs`,
      );
    if (
      ts.isStringLiteralLike(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      const sink = [...HTML_SINKS].find((sinkName) => node.text.includes(sinkName));
      const imported = ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent);
      if (sink !== undefined && !imported)
        findings.push(`${here(node)}: it writes data as HTML, naming ${sink}`);
      // Another origin: the app's services reach Nuxeo by a path, and nothing else.
      else if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(node.text.trim()) && !imported)
        findings.push(
          `${here(node)}: it names another origin, ${node.text.trim().slice(0, 60)}: a plugin reaches Nuxeo through the app's services, by a path`,
        );
    }
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'Function'
    )
      findings.push(`${here(node)}: it runs text as code, with new Function`);
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'Image'
    )
      findings.push(`${here(node)}: it loads an image past the app's services, with new Image()`);
    if (
      ts.isPropertyAccessExpression(node) &&
      (((node.name.text === 'src' || node.name.text === 'srcset' || node.name.text === 'href') &&
        assigned(node)) ||
        node.name.text === 'defaultView' ||
        node.name.text === 'location')
    )
      findings.push(`${here(node)}: it reaches the page past Angular, through ${node.name.text}`);
    if (ts.isMetaProperty(node))
      findings.push(`${here(node)}: it reads import.meta, which differs where it runs`);
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : '';
      if (ts.isIdentifier(callee) && callee.text === 'Function')
        findings.push(`${here(node)}: it runs text as code, with Function()`);
      if (
        (name === 'setTimeout' || name === 'setInterval') &&
        node.arguments[0] &&
        ts.isStringLiteralLike(node.arguments[0])
      )
        findings.push(`${here(node)}: it runs text as code, giving ${name} a string`);
      if (callee.kind === ts.SyntaxKind.ImportKeyword) {
        const [specifier] = node.arguments;
        if (!specifier || !ts.isStringLiteralLike(specifier))
          findings.push(`${here(node)}: it imports a module whose name it works out as it runs`);
        else if (!specifier.text.startsWith('.') || !insideLibrary(path, specifier.text))
          findings.push(
            `${here(node)}: it imports ${specifier.text} as it runs, which is not a file of its own`,
          );
      }
      if (
        ts.isPropertyAccessExpression(callee) &&
        /^(?:setAttribute|setProperty|setAttributeNS)$/.test(callee.name.text) &&
        node.arguments.some(
          (argument) =>
            ts.isStringLiteralLike(argument) &&
            /^(?:src|srcset|href|innerHTML|outerHTML|srcdoc|style|action|formaction|on\w+)$/i.test(
              argument.text,
            ),
        )
      )
        findings.push(
          `${here(node)}: it sets an element's ${node.arguments
            .filter(ts.isStringLiteralLike)
            .map((argument) => argument.text)
            .filter((text) =>
              /^(?:src|srcset|href|innerHTML|outerHTML|srcdoc|style|action|formaction|on\w+)$/i.test(
                text,
              ),
            )
            .join(', ')} past Angular's templates, with ${callee.name.text}`,
        );
      // Its registration is its components alone, written out, so that nothing it registers, or
      // replaces of the platform's own, is out of the scan's sight.
      if (ts.isIdentifier(callee) && callee.text === 'provideSatoriExtensions') {
        const [contributions] = node.arguments;
        if (!contributions || !ts.isObjectLiteralExpression(contributions))
          findings.push(
            `${here(node)}: it registers through provideSatoriExtensions with what it works out as it runs: give it { components } written out`,
          );
        else
          for (const property of contributions.properties)
            if (!property.name || property.name.getText(source) !== 'components')
              findings.push(
                `${here(property)}: it registers ${property.name?.getText(source) ?? 'something'} through provideSatoriExtensions: a plugin of one element registers its components alone`,
              );
      }
      if (REDEFINING.test(callee.getText(source)))
        findings.push(
          `${here(node)}: it changes an object behind the code's back, with ${callee.getText(source)}`,
        );
      if (
        name === 'subscribe' &&
        ts.isPropertyAccessExpression(callee) &&
        !untilDestroyed(callee.expression)
      )
        findings.push(`${here(node)}: it subscribes without takeUntilDestroyed()`);
    }
    if (ts.isClassDeclaration(node) && decorator(node, 'Component')) components.add(node);
    ts.forEachChild(node, visit);
  };
  visit(source);

  for (const component of components) {
    const options = decorator(component, 'Component');
    const property = (key: string): ts.Expression | undefined => {
      const found = options?.properties.find(
        (candidate) =>
          candidate.name && ts.isIdentifier(candidate.name) && candidate.name.text === key,
      );
      return found && ts.isPropertyAssignment(found) ? found.initializer : undefined;
    };
    const name = component.name?.text ?? 'a component';
    if (property('standalone')?.kind !== ts.SyntaxKind.TrueKeyword)
      findings.push(`${here(component)}: ${name} is not standalone: true`);
    if (property('template') !== undefined)
      findings.push(`${here(component)}: ${name} has an inline template: use templateUrl`);
    else if (property('templateUrl') === undefined)
      findings.push(`${here(component)}: ${name} names no templateUrl`);
    const styles = property('styles');
    if (styles !== undefined)
      for (const style of [styles, ...(ts.isArrayLiteralExpression(styles) ? styles.elements : [])])
        if (ts.isStringLiteralLike(style))
          findings.push(...scanStyle(style.text, () => here(style)));
    const host = property('host');
    if (host && ts.isObjectLiteralExpression(host))
      for (const binding of host.properties)
        if (
          binding.name &&
          /^\[(?:attr\.)?(?:src|srcset|style|href)|^\(|^on/i.test(
            binding.name.getText(source).replace(/^['"]|['"]$/g, ''),
          )
        )
          findings.push(
            `${here(binding)}: ${name} binds ${binding.name.getText(source)} on its host, past what the scan of its template reads`,
          );
        else if (binding.name && /innerhtml|outerhtml/i.test(binding.name.getText(source)))
          findings.push(
            `${here(binding)}: ${name} writes data as HTML, through its host binding ${binding.name.getText(source)}`,
          );
    for (const member of component.members) {
      for (const bound of ts.canHaveDecorators(member) ? (ts.getDecorators(member) ?? []) : []) {
        const call = bound.expression;
        if (
          ts.isCallExpression(call) &&
          ts.isIdentifier(call.expression) &&
          (call.expression.text === 'HostBinding' || call.expression.text === 'HostListener')
        )
          findings.push(
            `${here(member)}: ${name} uses @${call.expression.text}${call.arguments[0] ? `(${call.arguments[0].getText(source)})` : ''}, past what the scan of its template reads: bind it in the template`,
          );
      }
      if (ts.isConstructorDeclaration(member) && member.parameters.length > 0)
        findings.push(
          `${here(member)}: ${name} takes what it needs as constructor parameters: use inject()`,
        );
      if (
        ts.isPropertyDeclaration(member) &&
        member.initializer &&
        /^inject\(\s*NuxeoApiBase\b/.test(member.initializer.getText(source))
      )
        findings.push(
          `${here(member)}: ${name} injects NuxeoApiBase: a request belongs in a service of the plugin`,
        );
    }
  }
  return findings;
}

/** What a spec must not do: take its own tests away, run only some, or replace what it tests. */
function scanSpec(text: string, path: string, at: (line: number) => string): string[] {
  const findings: string[] = [];
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const here = (node: ts.Node): string =>
    at(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1);
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(source);
      if (
        /^(?:x|f)(?:it|test|describe)$/.test(callee) ||
        /^(?:it|test|describe|suite)\.(?:skip|only|todo|skipIf|runIf|fails|concurrent|sequential|shuffle)\b/.test(
          callee,
        )
      )
        findings.push(
          `${here(node)}: it takes its own tests away, or runs only some, with ${callee}`,
        );
      if (/^vi\.(?:mock|doMock|stubGlobal|hoisted)$/.test(callee))
        findings.push(
          `${here(node)}: it replaces a module or a global for its tests, with ${callee}: test the plugin as the app runs it, with Angular's testing providers`,
        );
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

/** What a style must not do: load anything from a URL, which the browser fetches itself. */
function scanStyle(css: string, at: (line: number) => string): string[] {
  const findings: string[] = [];
  css.split('\n').forEach((line, index) => {
    if (/url\s*\(|@import|expression\s*\(|image-set\s*\(/i.test(line))
      findings.push(
        `${at(index + 1)}: its style loads ${line.trim().slice(0, 80)}, which the browser fetches past the app's services`,
      );
  });
  return findings;
}

/** True when the code, read from its syntax tree and not its comments, calls both members. */
function callsBoth(code: string, first: string, second: string): boolean {
  const source = ts.createSourceFile('component.ts', code, ts.ScriptTarget.Latest, true);
  const called = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression))
      called.add(node.expression.name.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return called.has(first) && called.has(second);
}

/** True when a relative import from the file at `path` stays among the library's own files. */
function insideLibrary(path: string, specifier: string): boolean {
  const parts = path.split('/').slice(0, -1);
  for (const part of specifier.split('/')) {
    if (part === '..') {
      if (parts.length === 0) return false;
      parts.pop();
    } else if (part !== '.' && part !== '') parts.push(part);
  }
  return parts[0] === 'src';
}

/** True when the property access is what an assignment writes to, or sits under what it writes to. */
function assigned(node: ts.Node): boolean {
  let current: ts.Node = node;
  while (
    ts.isPropertyAccessExpression(current.parent) ||
    ts.isElementAccessExpression(current.parent)
  )
    current = current.parent;
  const parent = current.parent;
  return (
    ts.isBinaryExpression(parent) &&
    parent.left === current &&
    parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  );
}

/** The decorator `name(...)`'s object argument on a class, or `undefined`. */
function decorator(
  node: ts.ClassDeclaration,
  name: string,
): ts.ObjectLiteralExpression | undefined {
  for (const modifier of ts.getDecorators(node) ?? []) {
    const call = modifier.expression;
    if (
      ts.isCallExpression(call) &&
      ts.isIdentifier(call.expression) &&
      call.expression.text === name
    ) {
      const [options] = call.arguments;
      return options && ts.isObjectLiteralExpression(options)
        ? options
        : ts.factory.createObjectLiteralExpression();
    }
  }
  return undefined;
}

/** True when what is subscribed to is piped through `takeUntilDestroyed(…)`. */
function untilDestroyed(expression: ts.Expression): boolean {
  let current: ts.Expression = expression;
  while (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)) {
    if (
      current.expression.name.text === 'pipe' &&
      current.arguments.some(
        (argument) =>
          ts.isCallExpression(argument) &&
          ts.isIdentifier(argument.expression) &&
          argument.expression.text === 'takeUntilDestroyed',
      )
    )
      return true;
    current = current.expression.expression;
  }
  return false;
}

/** What the plugin's public API, `src/index.ts`, exposes that it must not. */
export function scanPublicApi(source: PluginSource): string[] {
  const findings: string[] = [];
  const index = source.files['src/index.ts'];
  if (index === undefined) {
    findings.push(
      `${source.library}/src/index.ts is missing, so the plugin has no public API to build in`,
    );
    return findings;
  }
  const parse = (path: string): ts.SourceFile | null => {
    const text = source.files[path];
    return text === undefined
      ? null
      : ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  };
  const resolve = (from: string, specifier: string): string | null => {
    const base = from.slice(0, from.lastIndexOf('/') + 1);
    const parts: string[] = [];
    for (const part of `${base}${specifier}`.split('/')) {
      if (part === '..') parts.pop();
      else if (part !== '.' && part !== '') parts.push(part);
    }
    const joined = parts.join('/');
    return (
      [`${joined}.ts`, `${joined}/index.ts`].find((path) => source.files[path] !== undefined) ??
      null
    );
  };
  const checked = new Set<string>();
  /** The types a declaration's signature names, each held to where it is imported from. */
  const holdTypes = (file: ts.SourceFile, node: ts.Node, exported: string): void => {
    const visit = (child: ts.Node): void => {
      if (ts.isTypeReferenceNode(child) || ts.isExpressionWithTypeArguments(child)) {
        const reference = ts.isTypeReferenceNode(child) ? child.typeName : child.expression;
        const name = reference.getText(file).split('.')[0];
        const from = importOf(file, name);
        if (
          from !== null &&
          !from.startsWith('.') &&
          !from.startsWith('@angular/') &&
          !PUBLISHED.has(from)
        )
          findings.push(
            `${source.library}/src/index.ts exports ${exported}, whose type names ${name}, from ${from}: a public API names Angular's and the platform's types only`,
          );
        else if (from !== null && from.startsWith('.')) {
          const target = resolve(file.fileName, from);
          const key = `${target ?? from}#${name}`;
          if (target && !checked.has(key)) {
            checked.add(key);
            const declared = parse(target);
            const declaration = declared && topLevel(declared, name);
            if (declared && declaration) holdTypes(declared, declaration, exported);
          }
        } else if (from === null) {
          const declaration = topLevel(file, name);
          const key = `${file.fileName}#${name}`;
          if (declaration && !checked.has(key)) {
            checked.add(key);
            holdTypes(file, declaration, exported);
          }
        }
      }
      ts.forEachChild(child, visit);
    };
    visit(node);
  };
  const holdExport = (file: ts.SourceFile, name: string): void => {
    const declaration = topLevel(file, name);
    if (
      declaration &&
      ts.isVariableDeclaration(declaration) &&
      declaration.type === undefined &&
      !(declaration.initializer && frozenLiteral(declaration.initializer))
    ) {
      findings.push(
        `${source.library}/src/index.ts exports ${name}, whose type is not written: write it, so that the API is what it says`,
      );
      return;
    }
    if (!declaration) {
      findings.push(
        `${source.library}/src/index.ts exports ${name}, which ${file.fileName} does not declare`,
      );
      return;
    }
    if (ts.isClassDeclaration(declaration)) {
      findings.push(
        `${source.library}/src/index.ts exports the class ${name}: a host reaches a component by its ID, and nothing else of the plugin is a class to share`,
      );
      return;
    }
    if (ts.isFunctionDeclaration(declaration) && declaration.type === undefined)
      findings.push(
        `${source.library}/src/index.ts exports ${name}, whose return type is not written: write it, so that the API is what it says`,
      );
    holdTypes(file, declaration, name);
  };

  const file = parse('src/index.ts') as ts.SourceFile;
  for (const statement of file.statements) {
    if (
      ts.isExportAssignment(statement) ||
      (ts.canHaveModifiers(statement) &&
        ts
          .getModifiers(statement)
          ?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword))
    ) {
      findings.push(`${source.library}/src/index.ts has a default export: name each export`);
      continue;
    }
    if (ts.isExportDeclaration(statement)) {
      const from =
        statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
          ? statement.moduleSpecifier.text
          : null;
      if (from !== null && !from.startsWith('.')) {
        findings.push(
          `${source.library}/src/index.ts re-exports ${from}, another package: a plugin's public API is its own`,
        );
        continue;
      }
      if (!statement.exportClause) {
        findings.push(
          `${source.library}/src/index.ts exports everything of ${from ?? 'a file'}: name each export`,
        );
        continue;
      }
      const target = from === null ? file : parse(resolve('src/index.ts', from) ?? '');
      if (!target) {
        findings.push(
          `${source.library}/src/index.ts exports from ${from}, which is no file of the plugin`,
        );
        continue;
      }
      if (ts.isNamedExports(statement.exportClause))
        for (const element of statement.exportClause.elements)
          holdExport(target, (element.propertyName ?? element.name).text);
    } else if (
      ts.canHaveModifiers(statement) &&
      ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      const names = ts.isVariableStatement(statement)
        ? statement.declarationList.declarations.map((declaration) =>
            declaration.name.getText(file),
          )
        : 'name' in statement && statement.name
          ? [(statement.name as ts.Identifier).text]
          : [];
      for (const name of names) holdExport(file, name);
    }
  }
  return findings;
}

/** `Object.freeze({ … } as const)`, or a literal: a value whose type is what it is written as. */
function frozenLiteral(node: ts.Expression): boolean {
  let value: ts.Expression = node;
  while (
    ts.isAsExpression(value) ||
    ts.isParenthesizedExpression(value) ||
    ts.isSatisfiesExpression(value)
  )
    value = value.expression;
  if (
    ts.isCallExpression(value) &&
    value.expression.getText() === 'Object.freeze' &&
    value.arguments.length === 1
  )
    return frozenLiteral(value.arguments[0]);
  if (ts.isObjectLiteralExpression(value))
    return value.properties.every(
      (property) => ts.isPropertyAssignment(property) && frozenLiteral(property.initializer),
    );
  if (ts.isArrayLiteralExpression(value)) return value.elements.every(frozenLiteral);
  return (
    ts.isStringLiteralLike(value) ||
    ts.isNumericLiteral(value) ||
    value.kind === ts.SyntaxKind.TrueKeyword ||
    value.kind === ts.SyntaxKind.FalseKeyword ||
    value.kind === ts.SyntaxKind.NullKeyword
  );
}

/** Where a file imports a name from, or `null` when it does not import it. */
function importOf(file: ts.SourceFile, name: string): string | null {
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const clause = statement.importClause;
    if (!clause) continue;
    if (clause.name?.text === name) return statement.moduleSpecifier.text;
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings) && bindings.name.text === name)
      return statement.moduleSpecifier.text;
    if (
      bindings &&
      ts.isNamedImports(bindings) &&
      bindings.elements.some((element) => element.name.text === name)
    )
      return statement.moduleSpecifier.text;
  }
  return null;
}

/** A file's top-level declaration of `name`. */
function topLevel(file: ts.SourceFile, name: string): ts.Node | undefined {
  for (const statement of file.statements) {
    if (ts.isVariableStatement(statement)) {
      const found = statement.declarationList.declarations.find(
        (declaration) => declaration.name.getText(file) === name,
      );
      if (found) return found;
    } else if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name?.text === name
    )
      return statement;
  }
  return undefined;
}

/** Code, in a string of configuration: what no configuration may hold. */
const CODE: readonly (readonly [RegExp, string])[] = [
  [/<\s*(?:script|template|dom-module|style|iframe|object|embed)\b/i, 'markup'],
  [/\bPolymer\s*\(/, "Polymer's definition of an element"],
  [/\bfunction\s*\*?\s*[\w$]*\s*\(/, 'a function'],
  [/\)\s*=>|=>\s*[{(]/, 'an arrow function'],
  [/\bthis\.[A-Za-z_$][\w$]*\s*[(.=[]/, 'code reading this'],
  [/<[a-z][\w-]*(?:\s[^>]*)?\son[a-z]+\s*=/i, 'markup with a handler'],
  [/\b(?:Function|import|require)\s*\(/, 'code that loads or builds code'],
  [/\[\[[^\]]*\]\]/, 'a Polymer binding'],
  [/\bon-[a-z][\w-]*\s*=/, 'a Polymer listener'],
  [/\bjavascript\s*:/i, 'a javascript: URL'],
  [/\b(?:eval|setTimeout|setInterval)\s*\(/, 'code run from text'],
  [/\bnew\s+Function\b/, 'code run from text'],
];
/**
 * Not in labels, where a translation's placeholder and its formatting look the same: a two-way
 * binding, and markup of any element.
 */
const OUTSIDE_LABELS: readonly (readonly [RegExp, string])[] = [
  [/\{\{[^}]*\}\}/, 'a binding'],
  [/<\/?[a-z][\w-]*(?:[\s/>]|$)/i, 'markup'],
];

/**
 * Every string of configuration that holds code: the conversion's app definition, by its path
 * under `app/`, and each plugin's `studio-plugin.json`. Each finding says where, and what.
 */
export function scanConfiguration(
  app: Readonly<Record<string, unknown>>,
  plugins: readonly PluginSource[],
): string[] {
  const findings: string[] = [];
  const walk = (file: string, value: unknown, at: string, labels: boolean): void => {
    if (typeof value === 'string') {
      const found = [...CODE, ...(labels ? [] : OUTSIDE_LABELS)].find(([pattern]) =>
        pattern.test(value),
      );
      if (found)
        findings.push(
          `${file}${at ? ` at ${at}` : ''} holds ${found[1]}: configuration names a plugin's ID, never its code`,
        );
      return;
    }
    if (Array.isArray(value))
      value.forEach((item, index) => walk(file, item, `${at}[${index}]`, labels));
    else if (isRecord(value))
      for (const [key, item] of Object.entries(value)) {
        // A key is configuration too.
        walk(file, key, at ? `${at} (a key)` : '(a key)', labels);
        walk(file, item, at ? `${at}.${key}` : key, labels);
      }
  };
  for (const [path, content] of Object.entries(app).sort(([a], [b]) => a.localeCompare(b)))
    walk(`app/${path}`, content, '', /^labels\//.test(path));
  for (const plugin of plugins) {
    const text = plugin.files['studio-plugin.json'];
    if (text === undefined) continue;
    try {
      walk(`${plugin.library}/studio-plugin.json`, JSON.parse(text) as unknown, '', false);
    } catch {
      // Not JSON: check 9 says so with the plugin's metadata.
    }
  }
  return findings;
}
