#!/usr/bin/env node
/**
 * Controls for the kit's route models, run without a server: the claims review's,
 * `PayersClaimReview`, and since 0.7.0 the appeal review's, `PayersAppealReview`. Their sources,
 * their zips, and what they name in the kit's other files.
 *
 *   node business-apps/packages/payers-claims-demo/workflow/route-model.selftest.mjs
 *
 * First the kit as it is must have no problem; then each control below breaks a copy of the kit in
 * one way, and the check that guards it must name the problem, on every run. Each model has the
 * same kinds of control. Not every check has a control of its own: a document's id, path and
 * lifecycle policy, a stop node with transitions, a node that leads nowhere, a task with no buttons
 * or buttons with no task, a transition with no condition, the number of start and template-resource
 * contributions, the DocumentRoute and Orderable facets, a zip entry with no folder entry or that
 * `unzip -t` refuses, a chain's `RunOperation` naming no chain, are checked and not seen failing
 * here. What it checks, of each model:
 *
 * - **the zip** is the source's, byte for byte (`build-route-model.mjs --check`), and `unzip`, a
 *   reader that had no part in writing it, finds the marker `ExportedZipImporter` requires and
 *   one `document.xml` in each folder entry, and nothing else;
 * - **each document** is well-formed XML, a `DocumentRoute` at the root and a `RouteNode` in each
 *   folder below, named and placed by its folder, validated, in the route element lifecycle; its
 *   route node fields are ones the platform's `route_node` schema declares (recorded from
 *   nuxeo-routing-core 2025.10.18's `schemas/route_node.xsd`), its booleans `true` or `false`;
 * - **the graph:** one start node; a stop node; every transition's target a node; every node
 *   reached from the start, and reaching a stop; a task, with its buttons, on the steps that have
 *   one and only those; and each step with a task names its own variables facet,
 *   `facet-var_<workflow>_<step>`, holding its own schema, `var_<workflow>_<step>`, since Nuxeo
 *   completes a task through it and throws without one;
 * - **across the kit:** every chain a node names is contributed, and so is every chain a
 *   `RunOperation` runs, by name or by an expression's quoted names; every lifecycle transition a
 *   chain follows is the claim lifecycle's; every workflow a chain starts is one of the kit's route
 *   models; every property a chain writes, by its name or by an expression's path, is the stand-in
 *   model's, every literal value it writes to an enumerated one is one of its values, and every
 *   checklist entry it writes names an item the Case page's checklist card lists, with its
 *   subfields; every facet and variable schema a model names is contributed, from a file the bundle
 *   holds, with the namespace the documents use; its availability filter and its
 *   `template-resource` are contributed, the latter naming its zip and the component listed in the
 *   manifest; each step with a task has its task form at `tasks/<workflow>.<step>.layout.json`,
 *   named in the app's contribution, every `var:` field of it a variable of the step or the
 *   workflow and every other field a property of the stand-in model; and a vocabulary a form picks
 *   from is contributed, its ids the variable's values;
 * - **the XML reader** (`xml.mjs`), and the claim lifecycle read with it (`demo/lifecycle.mjs`):
 *   the stand-in model's lifecycle read, a well-formed comment skipped, and a malformed one
 *   refused whole rather than read past, `<!<!---->-->` among them.
 *
 * What it does not show: that a server imports the models and runs them. `platform-check.mjs`
 * holds the same files to the server's own classes, and the beta harness's
 * `payers-claims-workflow` and `payers-appeal-workflow` steps files run the workflows, once the kit
 * is installed. Node 24, and the system's `unzip`, and `zip` for the control that removes the
 * marker.
 *
 * Exit 0 when the kit passes and every control is refused for its own reason, 1 otherwise.
 */
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { KIT, MARKER, MODEL, MODELS, ZIP_PATH, zipPathOf } from './route-model.mjs';
import { readAppealChecklist } from '../demo/appeals.mjs';
import { readLifecycle } from '../demo/lifecycle.mjs';
import { child, childrenNamed, parseXml, textOf } from './xml.mjs';

/**
 * The fields of the platform's `route_node` schema (nuxeo-routing-core 2025.10.18,
 * `schemas/route_node.xsd`), and of its complex types a document export writes as elements.
 */
const ROUTE_NODE_FIELDS = new Set([
  'nodeId',
  'variablesFacet',
  'inputChain',
  'outputChain',
  'transitions',
  'fork',
  'start',
  'stop',
  'merge',
  'executeOnlyFirstTransition',
  'subRouteModelExpr',
  'subRouteVariables',
  'hasTask',
  'hasMultipleTasks',
  'taskDirective',
  'taskDescription',
  'taskDueDate',
  'taskDueDateExpr',
  'taskAssignees',
  'taskAssigneesExpr',
  'taskAssigneesPermission',
  'taskLayout',
  'taskDocType',
  'taskNotificationTemplate',
  'taskButtons',
  'lastActor',
  'count',
  'startDate',
  'endDate',
  'canceled',
  'subRouteInstanceId',
  'button',
  'taskX',
  'taskY',
  'escalationRules',
  'tasksInfo',
  'allowTaskReassignment',
]);
const BOOLEAN_FIELDS = new Set([
  'fork',
  'start',
  'stop',
  'executeOnlyFirstTransition',
  'hasTask',
  'hasMultipleTasks',
  'allowTaskReassignment',
]);
const TRANSITION_FIELDS = new Set([
  'name',
  'label',
  'description',
  'targetId',
  'condition',
  'result',
  'chain',
  'path',
]);
const BUTTON_FIELDS = new Set(['name', 'label', 'filter', 'validate']);
/** The Case page's layout, whose checklist card lists the items a chain may write an entry for. */
const CASE_LAYOUT = 'bundle/agentic-ui-config/layouts/Case/view.layout.json';

const local = (name) => name.slice(name.indexOf(':') + 1);

/**
 * The stand-in model's properties, by `prefix:name`, from the schemas its component contributes:
 * each with the values it is restricted to, if it is enumerated, and, for a list of complex values,
 * the subfields of an entry. Read from the bundle's XSD files with the kit's strict XML reader.
 */
function modelProperties(bundle, contributions) {
  const properties = new Map();
  for (const schema of contributions) {
    const { prefix, src } = schema.attributes;
    if (!prefix || !src || !existsSync(join(bundle, src))) continue;
    const xsd = parseXml(readFileSync(join(bundle, src), 'utf8'));
    const types = new Map(
      childrenNamed(xsd, 'xs:complexType').map((type) => [type.attributes.name, type]),
    );
    const elementsOf = (type) =>
      childrenNamed(child(type, 'xs:sequence'), 'xs:element').map((element) => ({
        name: element.attributes.name,
        type: element.attributes.type ?? null,
      }));
    for (const element of childrenNamed(xsd, 'xs:element')) {
      const restriction = child(child(element, 'xs:simpleType'), 'xs:restriction');
      const values = childrenNamed(restriction, 'xs:enumeration').map((e) => e.attributes.value);
      let subfields = null;
      const list = types.get(local(element.attributes.type ?? ''));
      const [entry] = list ? elementsOf(list) : [];
      if (entry?.type && types.has(local(entry.type)))
        subfields = elementsOf(types.get(local(entry.type))).map((field) => field.name);
      properties.set(`${prefix}:${element.attributes.name}`, {
        values: values.length > 0 ? values : null,
        subfields,
      });
    }
  }
  return properties;
}

/**
 * The property path an operation's `xpath` names, with each `" + <variable> + "` of an expression
 * read as `*`, a list's index: `expr:"case:checklist/" + at + "/done"` is `case:checklist/*\/done`.
 * `null` for an expression that is not a string concatenation of that shape.
 */
function pathOf(xpath) {
  if (!xpath.startsWith('expr:')) return xpath;
  const expression = xpath.slice('expr:'.length).trim();
  if (!/^"[^"]*"(\s*\+\s*[A-Za-z_]\w*\s*\+\s*"[^"]*")*$/.test(expression)) return null;
  return expression.replace(/"\s*\+\s*[A-Za-z_]\w*\s*\+\s*"/g, '*').replace(/"/g, '');
}

// ------------------------------------------------------------------ the checks

/** Every problem of the route models in the kit at `kit`, or none. */
export function problemsOf(kit) {
  const problems = [];
  const problem = (message) => problems.push(message);
  const bundle = join(kit, 'bundle');
  const read = (path) => readFileSync(join(kit, path), 'utf8');

  // The zips, as their builder and as unzip read them.
  const built = spawnSync(
    process.execPath,
    [join(kit, 'workflow', 'build-route-model.mjs'), '--check'],
    {
      encoding: 'utf8',
    },
  );
  if (built.status !== 0) problem(`the zip is not the source's: ${built.stderr.trim()}`);
  for (const model of MODELS) {
    const zipPath = zipPathOf(model);
    const zip = join(bundle, ...zipPath.split('/'));
    const listed = spawnSync('unzip', ['-Z1', zip], { encoding: 'utf8' });
    const tested = spawnSync('unzip', ['-tq', zip], { encoding: 'utf8' });
    if (listed.error) problem(`unzip is not available: ${listed.error.message}`);
    else if (listed.status !== 0 || tested.status !== 0) problem(`unzip cannot read ${zipPath}`);
    else {
      const entries = listed.stdout.split('\n').filter(Boolean);
      if (!entries.includes(MARKER))
        problem(`${zipPath} has no ${MARKER}, which the importer requires`);
      const folders = entries.filter((entry) => entry.endsWith('/'));
      if (!folders.includes(`${model}/`)) problem(`${zipPath} has no ${model}/ folder entry`);
      for (const folder of folders)
        if (!entries.includes(`${folder}document.xml`))
          problem(`${zipPath}'s ${folder} has no document.xml`);
      for (const entry of entries)
        if (entry !== MARKER && !entry.endsWith('/') && !entry.endsWith('/document.xml'))
          problem(`${zipPath} holds ${entry}, which no importer reads`);
        else if (
          entry.endsWith('/document.xml') &&
          !folders.includes(entry.slice(0, -'document.xml'.length))
        )
          problem(
            `${zipPath} holds ${entry} with no folder entry, which the importer would not read`,
          );
    }
  }

  // The kit's components, as text: what they contribute, by id.
  const components = ['payers-claims-demo-model.xml', 'payers-claims-demo-workflow.xml'].map(
    (name) => parseXml(read(`bundle/OSGI-INF/${name}`)),
  );
  const extensions = components.flatMap((component) => childrenNamed(component, 'extension'));
  const contributed = (point, element) =>
    extensions
      .filter((extension) => extension.attributes.point === point)
      .flatMap((extension) => childrenNamed(extension, element));
  const chains = new Map(
    contributed('chains', 'chain').map((chain) => [chain.attributes.id, chain]),
  );
  const facets = new Map(
    contributed('doctype', 'facet').map((facet) => [
      facet.attributes.name,
      childrenNamed(facet, 'schema').map((schema) => schema.attributes.name),
    ]),
  );
  const schemas = new Map(
    contributed('schema', 'schema').map((schema) => [schema.attributes.name, schema]),
  );
  const filters = new Set(contributed('filters', 'filter').map((filter) => filter.attributes.id));
  const directories = new Map(
    contributed('directories', 'directory').map((directory) => [
      directory.attributes.name,
      directory,
    ]),
  );
  const resources = contributed('routeModelImporter', 'template-resource');
  const lifecycle = contributed('lifecycle', 'lifecycle').find(
    (l) => l.attributes.name === 'payersClaim',
  );
  const lifecycleTransitions = new Set(
    childrenNamed(child(lifecycle, 'transitions'), 'transition').map((t) => t.attributes.name),
  );
  // The stand-in model's own schemas, not the workflows' variables.
  const properties = modelProperties(
    bundle,
    contributed('schema', 'schema').filter((schema) => !schema.attributes.name.startsWith('var_')),
  );
  /** A variable schema's fields and its namespace, from the file its contribution names. */
  const variables = (schema) => {
    const contribution = schemas.get(schema);
    const src = contribution?.attributes.src;
    if (!src || !existsSync(join(bundle, src))) return null;
    const xsd = parseXml(readFileSync(join(bundle, src), 'utf8'));
    const fields = new Map(
      childrenNamed(xsd, 'xs:element').map((element) => [element.attributes.name, element]),
    );
    return { namespace: xsd.attributes.targetNamespace, fields };
  };

  for (const model of MODELS) {
    const named = resources.filter((resource) => resource.attributes.id === model);
    if (named.length !== 1)
      problem(`${named.length} template-resource contributions for ${model}, not 1`);
    for (const resource of named)
      if (resource.attributes.path !== zipPathOf(model))
        problem(
          `the template-resource ${model} names ${resource.attributes.path}, not ${zipPathOf(model)}`,
        );
  }
  for (const resource of resources)
    if (!MODELS.includes(resource.attributes.id))
      problem(`the template-resource ${resource.attributes.id} is not a route model of the kit`);
  if (!/OSGI-INF\/payers-claims-demo-workflow\.xml/.test(read('bundle/META-INF/MANIFEST.MF')))
    problem('the manifest does not list the workflow component');

  const config = read('bundle/OSGI-INF/payers-claims-demo-config.xml');
  for (const model of MODELS) {
    const source = join(kit, 'workflow', model);
    // The documents, folder by folder.
    if (!existsSync(source)) {
      problem(`workflow/${model}/ is missing`);
      continue;
    }
    const documents = new Map();
    const parse = (folder, relative) => {
      const file = join(folder, 'document.xml');
      try {
        documents.set(relative, parseXml(readFileSync(file, 'utf8')));
      } catch (error) {
        problem(`${relative}/document.xml is not well-formed: ${error.message}`);
      }
      for (const entry of readdirSync(folder, { withFileTypes: true }))
        if (entry.isDirectory()) parse(join(folder, entry.name), `${relative}/${entry.name}`);
    };
    parse(source, model);

    const nodes = new Map();
    for (const [relative, document] of documents) {
      const where = `${relative}/document.xml`;
      const id = basename(relative);
      const system = child(document, 'system');
      const isRoot = relative === model;
      if (document.name !== 'document')
        problem(`${where} is a <${document.name}>, not a <document>`);
      if (document.attributes.id !== id)
        problem(`${where} has the id ${document.attributes.id}, not ${id}`);
      if (textOf(system, 'type') !== (isRoot ? 'DocumentRoute' : 'RouteNode'))
        problem(
          `${where} is a ${textOf(system, 'type')}, not a ${isRoot ? 'DocumentRoute' : 'RouteNode'}`,
        );
      if (textOf(system, 'path') !== relative)
        problem(`${where} has the path ${textOf(system, 'path')}, not ${relative}`);
      if (textOf(system, 'lifecycle-state') !== 'validated') problem(`${where} is not validated`);
      if (textOf(system, 'lifecycle-policy') !== 'documentRouteElement')
        problem(`${where} is not in the documentRouteElement lifecycle`);
      if (!isRoot && relative.split('/').length !== 2)
        problem(`${where} is not a node of the model`);

      const systemFacets = childrenNamed(system, 'facet').map((facet) => facet.text.trim());
      for (const facet of systemFacets.filter((f) => f.startsWith('facet-var_')))
        if (!facets.has(facet))
          problem(`${where} names the facet ${facet}, which no component contributes`);
      for (const schema of childrenNamed(document, 'schema')) {
        const name = schema.attributes.name;
        if (!name.startsWith('var_')) continue;
        const declared = variables(name);
        if (!declared) {
          problem(
            `${where} names the schema ${name}, which no component contributes from a bundle file`,
          );
          continue;
        }
        if (schema.attributes[`xmlns:${name}`] !== declared.namespace)
          problem(
            `${where} gives ${name} the namespace ${schema.attributes[`xmlns:${name}`]}, not its schema's`,
          );
      }
      const schemaOf = (name) =>
        childrenNamed(document, 'schema').find((s) => s.attributes.name === name);

      if (isRoot) {
        const docri = schemaOf('document_route_instance');
        const facet = textOf(docri, 'docri:variablesFacet');
        if (!facet || !systemFacets.includes(facet) || !facets.has(facet))
          problem(`${where}'s variablesFacet ${facet} is not a contributed facet it carries`);
        const filter = textOf(docri, 'docri:availabilityFilter');
        if (!filters.has(filter))
          problem(`${where}'s availabilityFilter ${filter} is not contributed`);
        for (const required of ['DocumentRoute', 'Orderable'])
          if (!systemFacets.includes(required)) problem(`${where} lacks the ${required} facet`);
        continue;
      }

      const rnode = schemaOf('route_node');
      if (!rnode) {
        problem(`${where} has no route_node schema`);
        continue;
      }
      const fields = new Map();
      for (const field of rnode.children) {
        const name = local(field.name);
        if (!field.name.startsWith('rnode:') || !ROUTE_NODE_FIELDS.has(name))
          problem(
            `${where} sets ${field.name}, which the platform's route_node schema does not declare`,
          );
        if (BOOLEAN_FIELDS.has(name) && !['true', 'false'].includes(field.text.trim()))
          problem(`${where}'s ${field.name} is "${field.text.trim()}", not true or false`);
        fields.set(name, field);
      }
      const text = (name) => fields.get(name)?.text.trim() ?? '';
      if (text('nodeId') !== id) problem(`${where}'s nodeId is ${text('nodeId')}, not ${id}`);
      const variablesFacet = text('variablesFacet');
      if (variablesFacet && (!systemFacets.includes(variablesFacet) || !facets.has(variablesFacet)))
        problem(
          `${where}'s variablesFacet ${variablesFacet} is not a contributed facet it carries`,
        );
      // Nuxeo reads a task's completion through the node's variables facet
      // (TaskCompletionRequestJsonReader) and throws without one, so the task is never completed:
      // the supervisor's Approve, on the local server, 26 November 2026. Each step's is its own, so
      // that no two steps' variables, or two workflows', are read as one.
      if (text('hasTask') === 'true' && !variablesFacet)
        problem(
          `${where} has a task and names no variablesFacet: Nuxeo completes a task through its node's variables facet, and throws without one`,
        );
      else if (text('hasTask') === 'true') {
        const own = `facet-var_${model}_${id}`;
        if (variablesFacet !== own)
          problem(`${where} names the variables facet ${variablesFacet}, not its own, ${own}`);
        else if (facets.has(own) && !facets.get(own).includes(`var_${model}_${id}`))
          problem(
            `${where}'s variables facet ${own} does not hold its own schema, var_${model}_${id}`,
          );
      }
      const transitions = childrenNamed(fields.get('transitions'), 'transition').map(
        (transition) => {
          for (const part of transition.children)
            if (!TRANSITION_FIELDS.has(part.name))
              problem(
                `${where}'s transition sets ${part.name}, which a route node transition does not have`,
              );
          return {
            name: textOf(transition, 'name'),
            target: textOf(transition, 'targetId'),
            chain: textOf(transition, 'chain'),
            condition: textOf(transition, 'condition'),
          };
        },
      );
      const buttons = childrenNamed(fields.get('taskButtons'), 'button').map((button) => {
        for (const part of button.children)
          if (!BUTTON_FIELDS.has(part.name))
            problem(`${where}'s button sets ${part.name}, which a button does not have`);
        return textOf(button, 'name');
      });
      nodes.set(id, {
        where,
        start: text('start') === 'true',
        stop: text('stop') === 'true',
        task: text('hasTask') === 'true',
        assignees: text('taskAssigneesExpr'),
        transitions,
        buttons,
        chains: [
          text('inputChain'),
          text('outputChain'),
          ...transitions.map((t) => t.chain),
        ].filter(Boolean),
        schemas: facets.get(variablesFacet) ?? [],
      });
    }

    // The graph.
    const starts = [...nodes].filter(([, node]) => node.start);
    if (starts.length !== 1) problem(`${model}: ${starts.length} start nodes, not 1`);
    if (![...nodes.values()].some((node) => node.stop)) problem(`${model}: no stop node`);
    for (const node of nodes.values()) {
      const names = node.transitions.map((t) => t.name);
      if (new Set(names).size !== names.length) problem(`${node.where} repeats a transition name`);
      for (const transition of node.transitions) {
        if (!nodes.has(transition.target))
          problem(
            `${node.where}'s transition ${transition.name} leads to ${transition.target}, which is not a node`,
          );
        if (!transition.condition)
          problem(`${node.where}'s transition ${transition.name} has no condition`);
      }
      if (node.stop && node.transitions.length > 0)
        problem(`${node.where} is a stop node with transitions`);
      if (!node.stop && node.transitions.length === 0) problem(`${node.where} leads nowhere`);
      if (node.task && (node.buttons.length === 0 || !node.assignees))
        problem(`${node.where} has a task with no buttons or no assignees`);
      if (!node.task && node.buttons.length > 0) problem(`${node.where} has buttons and no task`);
      for (const chain of node.chains)
        if (!chains.has(chain))
          problem(`${node.where} runs the chain ${chain}, which no component contributes`);
    }
    const reached = new Set();
    const visit = (id) => {
      if (reached.has(id) || !nodes.has(id)) return;
      reached.add(id);
      for (const transition of nodes.get(id).transitions) visit(transition.target);
    };
    if (starts.length === 1) visit(starts[0][0]);
    for (const [id, node] of nodes) {
      if (!reached.has(id)) problem(`${node.where} is not reached from the start`);
      const ends = new Set();
      const walk = (at) => {
        if (ends.has(at) || !nodes.has(at)) return;
        ends.add(at);
        for (const transition of nodes.get(at).transitions) walk(transition.target);
      };
      walk(id);
      if (![...ends].some((at) => nodes.get(at)?.stop))
        problem(`${node.where} reaches no stop node`);
    }

    // The task forms, and what they name.
    const workflowVariables = variables(`var_${model}`);
    if (!workflowVariables) problem(`no var_${model} schema for the workflow's own variables`);
    for (const [id, node] of nodes) {
      const file = `tasks/${model}.${id}.layout.json`;
      const path = join(bundle, 'agentic-ui-config', ...file.split('/'));
      if (!node.task) {
        if (existsSync(path)) problem(`${file} is a task form for ${id}, which has no task`);
        continue;
      }
      if (!existsSync(path)) {
        problem(`${id} has a task and no task form, ${file}`);
        continue;
      }
      if (!config.includes(`<file path="${file}" />`))
        problem(`the app's contribution does not name ${file}`);
      const form = JSON.parse(readFileSync(path, 'utf8'));
      const stepVariables = node.schemas.map(variables).filter(Boolean);
      const fieldsOf = (cards) => cards.flatMap((card) => card.fields ?? []);
      for (const field of fieldsOf(
        form.tabs ? form.tabs.flatMap((tab) => tab.cards) : form.cards,
      )) {
        const xpath = typeof field === 'string' ? field : field.field;
        if (!xpath) continue;
        if (!xpath.startsWith('var:')) {
          // The record's own property, shown read-only: the stand-in model's.
          if (!properties.has(xpath))
            problem(`${file}'s ${xpath} is not a property of the stand-in model`);
          continue;
        }
        const name = xpath.slice('var:'.length);
        const schema = [...stepVariables, workflowVariables].find((s) => s?.fields.has(name));
        if (!schema) {
          problem(`${file}'s ${xpath} is a variable of neither ${id} nor the workflow`);
          continue;
        }
        if (field.widget === 'vocabulary') {
          const directory = directories.get(field.parameters?.directory);
          const csv = directory ? textOf(directory, 'dataFile') : null;
          if (!csv || !existsSync(join(bundle, csv))) {
            problem(
              `${file}'s ${xpath} picks from ${field.parameters?.directory}, which no component contributes from a bundle file`,
            );
            continue;
          }
          const ids = readFileSync(join(bundle, csv), 'utf8')
            .trim()
            .split('\n')
            .slice(1)
            .map((line) => JSON.parse(`[${line}]`)[0])
            .sort();
          const values = childrenNamed(
            child(child(schema.fields.get(name), 'xs:simpleType'), 'xs:restriction'),
            'xs:enumeration',
          )
            .map((e) => e.attributes.value)
            .sort();
          if (JSON.stringify(ids) !== JSON.stringify(values))
            problem(
              `${file}'s ${xpath} picks ${JSON.stringify(ids)}, and the variable takes ${JSON.stringify(values)}`,
            );
        }
      }
    }
  }

  // What the chains do: the lifecycle transitions they follow, the chains they run, the workflows
  // they start, and the properties they write.
  let checklistItems = null;
  try {
    checklistItems = readAppealChecklist(read(CASE_LAYOUT)).items.map((item) => item.id);
  } catch (error) {
    problem(`the Case page's checklist is not read: ${error.message}`);
  }
  const modelNames = new Set(resources.map((resource) => resource.attributes.id));
  for (const [id, chain] of chains)
    for (const operation of childrenNamed(chain, 'operation')) {
      const param = (name) =>
        childrenNamed(operation, 'param')
          .find((p) => p.attributes.name === name)
          ?.text.trim();
      // XMap gives a chain's parameter its content as markup (@XContent), so a `<`, `>` or `&` the
      // XML escapes reaches MVEL escaped, `&lt;`, which it cannot read: seen with the server's
      // classes, platform-check.mjs, 26 November 2026.
      for (const p of childrenNamed(operation, 'param'))
        if (/[<>&]/.test(p.text))
          problem(
            `the chain ${id} gives ${operation.attributes.id}'s ${p.attributes.name} a <, > or &, which the server reads escaped`,
          );
      switch (operation.attributes.id) {
        case 'Document.FollowLifecycleTransition':
          if (!lifecycleTransitions.has(param('value')))
            problem(
              `the chain ${id} follows ${param('value')}, which the claim lifecycle does not define`,
            );
          break;
        case 'RunOperation': {
          const target = param('id') ?? '';
          const run = target.startsWith('expr:')
            ? [...target.matchAll(/"([^"]+)"/g)].map((match) => match[1])
            : [target].filter(Boolean);
          if (run.length === 0) problem(`the chain ${id} runs RunOperation and names no chain`);
          for (const name of run)
            if (!chains.has(name))
              problem(`the chain ${id} runs the chain ${name}, which no component contributes`);
          break;
        }
        case 'Context.StartWorkflow':
          if (!MODELS.includes(param('id')) || !modelNames.has(param('id')))
            problem(
              `the chain ${id} starts the workflow ${param('id')}, which is not a route model the kit contributes`,
            );
          break;
        case 'Document.SetProperty': {
          const path = pathOf(param('xpath') ?? '');
          if (path === null) {
            problem(`the chain ${id} writes a property its xpath's expression does not name`);
            break;
          }
          const [name, index, subfield] = path.split('/');
          const property = properties.get(name);
          if (!property) {
            problem(`the chain ${id} writes ${path}, which the stand-in model does not have`);
            break;
          }
          if (index !== undefined && !(property.subfields ?? []).includes(subfield))
            problem(`the chain ${id} writes ${path}, whose entries have no ${subfield}`);
          const value = param('value');
          if (
            index === undefined &&
            property.values &&
            value !== undefined &&
            !value.startsWith('expr:') &&
            !property.values.includes(value)
          )
            problem(
              `the chain ${id} writes ${value} to ${name}, which takes ${JSON.stringify(property.values)}`,
            );
          break;
        }
        case 'Document.AddItemToListProperty': {
          const name = param('xpath');
          const property = properties.get(name);
          if (!property?.subfields) {
            problem(`the chain ${id} adds to ${name}, which is no list of the stand-in model`);
            break;
          }
          const json = param('complexJsonProperties') ?? '';
          for (const [, key] of json.matchAll(/"([A-Za-z_]\w*)"\s*:/g))
            if (!property.subfields.includes(key))
              problem(`the chain ${id} adds to ${name} an entry with ${key}, which it has not`);
          if (name === 'case:checklist' && checklistItems)
            for (const [, item] of json.matchAll(/"item"\s*:\s*"([^"]*)"/g))
              if (!checklistItems.includes(item))
                problem(
                  `the chain ${id} writes the checklist item ${item}, which the Case page's checklist does not list`,
                );
          break;
        }
        case 'Context.SetVar': {
          // The index of an item in the checklist, read by its id: an item the Case page lists.
          const value = param('value') ?? '';
          if (checklistItems && /case:checklist/.test(value))
            for (const [, item] of value.matchAll(/indexOf\("([^"]*)"\)/g))
              if (!checklistItems.includes(item))
                problem(
                  `the chain ${id} looks for the checklist item ${item}, which the Case page's checklist does not list`,
                );
          break;
        }
        default:
      }
    }
  return problems;
}

// ------------------------------------------------------------------ the controls

const failures = [];
const kitProblems = problemsOf(KIT);
if (kitProblems.length > 0) failures.push(`the kit itself:\n    ${kitProblems.join('\n    ')}`);

/** A copy of the kit, `change`d, whose problems must include one matching `expected`. */
function control(what, change, expected) {
  const scratch = mkdtempSync(join(tmpdir(), 'payers-route-model-'));
  const kit = join(scratch, 'payers-claims-demo');
  try {
    cpSync(KIT, kit, { recursive: true, filter: (path) => basename(path) !== 'dist' });
    const edit = (file, from, to) => {
      const path = join(kit, file);
      const text = readFileSync(path, 'utf8');
      if (!text.includes(from))
        throw new Error(`the control's edit does not apply to ${file}: ${from}`);
      writeFileSync(path, text.replace(from, to));
    };
    const rebuild = () =>
      spawnSync(process.execPath, [join(kit, 'workflow', 'build-route-model.mjs')], {
        encoding: 'utf8',
      });
    change({ kit, edit, rebuild });
    const found = problemsOf(kit);
    if (!found.some((message) => expected.test(message)))
      failures.push(`${what}: not refused for ${expected}; found ${JSON.stringify(found)}`);
  } catch (error) {
    failures.push(`${what}: the control threw: ${error.message}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const DETERMINE = `workflow/${MODEL}/determine/document.xml`;
const SUPERVISOR = `workflow/${MODEL}/supervisorApproval/document.xml`;
const WORKFLOW = 'bundle/OSGI-INF/payers-claims-demo-workflow.xml';
let controls = 0;
const refuse = (what, change, expected) => {
  controls++;
  control(what, change, expected);
};

refuse(
  'a source changed and the zip not built again',
  ({ edit }) =>
    edit(
      DETERMINE,
      'Document["claim:billedAmount"] > 5000]]',
      'Document["claim:billedAmount"] >= 5000]]',
    ),
  /the zip is not the source's/,
);
refuse(
  'a zip with no .nuxeo-archive marker',
  ({ kit }) => {
    const zip = join(kit, 'bundle', ...ZIP_PATH.split('/'));
    spawnSync('zip', ['-dq', zip, MARKER]);
  },
  /has no \.nuxeo-archive/,
);
refuse(
  'a document that is not well-formed',
  ({ edit, rebuild }) => {
    edit(DETERMINE, '<rnode:hasTask>', '<rnode:hasTask attr=>');
    rebuild();
  },
  /determine\/document\.xml is not well-formed/,
);
refuse(
  "a route node field the platform's schema does not declare",
  ({ edit, rebuild }) => {
    edit(
      DETERMINE,
      '<rnode:hasTask>',
      '<rnode:hasTaskk><![CDATA[true]]></rnode:hasTaskk><rnode:hasTask>',
    );
    rebuild();
  },
  /sets rnode:hasTaskk, which the platform's route_node schema does not declare/,
);
refuse(
  'a boolean that is not true or false',
  ({ edit, rebuild }) => {
    edit(SUPERVISOR, '<rnode:stop><![CDATA[false]]>', '<rnode:stop><![CDATA[no]]>');
    rebuild();
  },
  /supervisorApproval\/document\.xml's rnode:stop is "no", not true or false/,
);
refuse(
  'a transition to a node that does not exist',
  ({ edit, rebuild }) => {
    edit(
      SUPERVISOR,
      '<targetId><![CDATA[end]]></targetId>',
      '<targetId><![CDATA[ending]]></targetId>',
    );
    rebuild();
  },
  /transition approve leads to ending, which is not a node/,
);
refuse(
  'a chain no component contributes',
  ({ edit, rebuild }) => {
    edit(
      SUPERVISOR,
      '<chain><![CDATA[PayersClaimReview.Approve]]></chain>',
      '<chain><![CDATA[PayersClaimReview.Aprove]]></chain>',
    );
    rebuild();
  },
  /runs the chain PayersClaimReview\.Aprove, which no component contributes/,
);
refuse(
  'a chain following a transition the claim lifecycle does not define',
  ({ edit }) =>
    edit(
      WORKFLOW,
      '<chain id="PayersClaimReview.Approve">\n      <operation id="Context.FetchDocument" />\n      <operation id="Document.FollowLifecycleTransition">\n        <param type="string" name="value">approve</param>',
      '<chain id="PayersClaimReview.Approve">\n      <operation id="Context.FetchDocument" />\n      <operation id="Document.FollowLifecycleTransition">\n        <param type="string" name="value">validate</param>',
    ),
  /PayersClaimReview\.Approve follows validate, which the claim lifecycle does not define/,
);
refuse(
  'a node no transition reaches',
  ({ edit, rebuild }) => {
    edit(
      `workflow/${MODEL}/start/document.xml`,
      '<chain><![CDATA[PayersClaimReview.Review]]></chain>\n        <targetId><![CDATA[determine]]></targetId>',
      '<chain><![CDATA[PayersClaimReview.Review]]></chain>\n        <targetId><![CDATA[end]]></targetId>',
    );
    // Since 0.7.0 a denied claim's reopening leads there too.
    edit(
      `workflow/${MODEL}/start/document.xml`,
      '<chain><![CDATA[PayersClaimReview.Reopen]]></chain>\n        <targetId><![CDATA[determine]]></targetId>',
      '<chain><![CDATA[PayersClaimReview.Reopen]]></chain>\n        <targetId><![CDATA[end]]></targetId>',
    );
    rebuild();
  },
  /PayersClaimReview\/determine\/document\.xml is not reached from the start/,
);
refuse(
  'a node from which no stop node is reached',
  ({ edit, rebuild }) => {
    edit(
      SUPERVISOR,
      '<chain><![CDATA[PayersClaimReview.Approve]]></chain>\n        <targetId><![CDATA[end]]></targetId>',
      '<chain><![CDATA[PayersClaimReview.Approve]]></chain>\n        <targetId><![CDATA[supervisorApproval]]></targetId>',
    );
    edit(
      SUPERVISOR,
      '<chain><![CDATA[PayersClaimReview.SendBack]]></chain>\n        <targetId><![CDATA[determine]]></targetId>',
      '<chain><![CDATA[PayersClaimReview.SendBack]]></chain>\n        <targetId><![CDATA[supervisorApproval]]></targetId>',
    );
    rebuild();
  },
  /supervisorApproval\/document\.xml reaches no stop node/,
);
refuse(
  'a transition name given twice in a node',
  ({ edit, rebuild }) => {
    edit(DETERMINE, '<name><![CDATA[deny]]></name>', '<name><![CDATA[approve]]></name>');
    rebuild();
  },
  /determine\/document\.xml repeats a transition name/,
);
refuse(
  'a model that is not validated, which the routing service does not find',
  ({ edit, rebuild }) => {
    edit(
      `workflow/${MODEL}/document.xml`,
      '<lifecycle-state>validated</lifecycle-state>',
      '<lifecycle-state>draft</lifecycle-state>',
    );
    rebuild();
  },
  /PayersClaimReview\/document\.xml is not validated/,
);
refuse(
  'an availability filter no component contributes',
  ({ edit }) => edit(WORKFLOW, 'filter id="filter@PayersClaimReview"', 'filter id="filter@Other"'),
  /availabilityFilter filter@PayersClaimReview is not contributed/,
);
refuse(
  'a manifest that does not list the workflow component',
  ({ edit }) =>
    edit('bundle/META-INF/MANIFEST.MF', ',OSGI-INF/payers-claims-demo-workflow.xml', ''),
  /the manifest does not list the workflow component/,
);
refuse(
  'a task form for a step that has no task',
  ({ kit }) =>
    writeFileSync(
      join(kit, 'bundle', 'agentic-ui-config', 'tasks', `${MODEL}.start.layout.json`),
      '{ "version": 2, "cards": [] }\n',
    ),
  /tasks\/PayersClaimReview\.start\.layout\.json is a task form for start, which has no task/,
);
refuse(
  'a vocabulary no component contributes',
  ({ edit }) =>
    edit(WORKFLOW, '<directory name="PayersClaimDecision"', '<directory name="PayersDecision"'),
  /picks from PayersClaimDecision, which no component contributes/,
);
refuse(
  'a facet no component contributes',
  ({ edit, rebuild }) => {
    edit(
      DETERMINE,
      '<facet>facet-var_PayersClaimReview_determine</facet>',
      '<facet>facet-var_PayersClaimReview_decide</facet>',
    );
    rebuild();
  },
  /names the facet facet-var_PayersClaimReview_decide, which no component contributes/,
);
refuse(
  'a node with a task and no variables facet',
  ({ edit, rebuild }) => {
    edit(
      SUPERVISOR,
      '    <rnode:variablesFacet><![CDATA[facet-var_PayersClaimReview_supervisorApproval]]></rnode:variablesFacet>\n',
      '',
    );
    rebuild();
  },
  /supervisorApproval.* has a task and names no variablesFacet/,
);
refuse(
  "a variable schema's namespace apart from its file's",
  ({ edit, rebuild }) => {
    edit(
      DETERMINE,
      'payers-claims-demo/var_PayersClaimReview_determine" name=',
      'payers-claims-demo/var_determine" name=',
    );
    rebuild();
  },
  /gives var_PayersClaimReview_determine the namespace .*, not its schema's/,
);
refuse(
  'a task form the app does not name',
  ({ edit }) =>
    edit(
      'bundle/OSGI-INF/payers-claims-demo-config.xml',
      `<file path="tasks/${MODEL}.supervisorApproval.layout.json" />`,
      '',
    ),
  /the app's contribution does not name tasks\/PayersClaimReview\.supervisorApproval\.layout\.json/,
);
refuse(
  'a step with a task and no task form',
  ({ kit }) =>
    rmSync(join(kit, 'bundle', 'agentic-ui-config', 'tasks', `${MODEL}.determine.layout.json`)),
  /determine has a task and no task form/,
);
refuse(
  "a task form's var: field that is no variable",
  ({ edit }) =>
    edit(
      `bundle/agentic-ui-config/tasks/${MODEL}.determine.layout.json`,
      '"field": "var:denialReason"',
      '"field": "var:reason"',
    ),
  /var:reason is a variable of neither determine nor the workflow/,
);
refuse(
  "a vocabulary whose ids are not the variable's values",
  ({ edit }) =>
    edit('bundle/data/vocabularies/PayersClaimDecision.csv', '"deny","Deny"', '"reject","Deny"'),
  /picks \["approve","reject"\], and the variable takes \["approve","deny"\]/,
);
refuse(
  'a template-resource naming another file',
  ({ edit }) => edit(WORKFLOW, `path="${ZIP_PATH}"`, 'path="data/Other.zip"'),
  /the template-resource PayersClaimReview names data\/Other\.zip/,
);
refuse(
  "a step whose variables facet is another step's",
  ({ edit, rebuild }) => {
    for (const [from, to] of [
      [
        '<facet>facet-var_PayersClaimReview_supervisorApproval<',
        '<facet>facet-var_PayersClaimReview_determine<',
      ],
      [
        '[facet-var_PayersClaimReview_supervisorApproval]',
        '[facet-var_PayersClaimReview_determine]',
      ],
    ])
      edit(SUPERVISOR, from, to);
    rebuild();
  },
  /supervisorApproval\/document\.xml names the variables facet facet-var_PayersClaimReview_determine, not its own, facet-var_PayersClaimReview_supervisorApproval/,
);
refuse(
  "a chain following a transition the claim lifecycle does not define, the reopening's",
  ({ edit }) =>
    edit(
      WORKFLOW,
      '<chain id="PayersClaimReview.Reopen">\n      <operation id="Context.FetchDocument" />\n      <operation id="Document.FollowLifecycleTransition">\n        <param type="string" name="value">reopen</param>',
      '<chain id="PayersClaimReview.Reopen">\n      <operation id="Context.FetchDocument" />\n      <operation id="Document.FollowLifecycleTransition">\n        <param type="string" name="value">reopened</param>',
    ),
  /PayersClaimReview\.Reopen follows reopened, which the claim lifecycle does not define/,
);

// ------------------------------------------------------------------ the appeal review's controls
// Since 0.7.0: the same kinds of control, on PayersAppealReview, and those of the checks it brought.
const APPEAL = MODELS[1];
const APPEAL_ROOT = `workflow/${APPEAL}/document.xml`;
const APPEAL_START = `workflow/${APPEAL}/start/document.xml`;
const DECIDE = `workflow/${APPEAL}/decide/document.xml`;
const DECIDE_FORM = `bundle/agentic-ui-config/tasks/${APPEAL}.decide.layout.json`;
const APPEAL_ZIP = zipPathOf(APPEAL);

refuse(
  "the appeal review's source changed and its zip not built again",
  ({ edit }) =>
    edit(
      DECIDE,
      'NodeVariables["decision"] == "uphold"]]',
      'NodeVariables["decision"] == "upheld"]]',
    ),
  /the zip is not the source's: .*PayersAppealReview\.zip is not what its source gives/,
);
refuse(
  "the appeal review's zip with no .nuxeo-archive marker",
  ({ kit }) => spawnSync('zip', ['-dq', join(kit, 'bundle', ...APPEAL_ZIP.split('/')), MARKER]),
  /PayersAppealReview\.zip has no \.nuxeo-archive/,
);
refuse(
  'an appeal review document that is not well-formed',
  ({ edit, rebuild }) => {
    edit(DECIDE, '<rnode:hasTask>', '<rnode:hasTask attr=>');
    rebuild();
  },
  /PayersAppealReview\/decide\/document\.xml is not well-formed/,
);
refuse(
  "an appeal review node field the platform's schema does not declare",
  ({ edit, rebuild }) => {
    edit(
      DECIDE,
      '<rnode:hasTask>',
      '<rnode:hasTaskk><![CDATA[true]]></rnode:hasTaskk><rnode:hasTask>',
    );
    rebuild();
  },
  /PayersAppealReview\/decide\/document\.xml sets rnode:hasTaskk, which the platform's route_node schema does not declare/,
);
refuse(
  'an appeal review boolean that is not true or false',
  ({ edit, rebuild }) => {
    edit(APPEAL_START, '<rnode:stop><![CDATA[false]]>', '<rnode:stop><![CDATA[no]]>');
    rebuild();
  },
  /PayersAppealReview\/start\/document\.xml's rnode:stop is "no", not true or false/,
);
refuse(
  'an appeal review transition to a node that does not exist',
  ({ edit, rebuild }) => {
    edit(DECIDE, '<targetId><![CDATA[end]]></targetId>', '<targetId><![CDATA[ending]]></targetId>');
    rebuild();
  },
  /PayersAppealReview\/decide\/document\.xml's transition alreadyDecided leads to ending, which is not a node/,
);
refuse(
  'an appeal review chain no component contributes',
  ({ edit, rebuild }) => {
    edit(
      DECIDE,
      '<chain><![CDATA[PayersAppealReview.Uphold]]></chain>',
      '<chain><![CDATA[PayersAppealReview.Uphld]]></chain>',
    );
    rebuild();
  },
  /runs the chain PayersAppealReview\.Uphld, which no component contributes/,
);
refuse(
  'an appeal review node no transition reaches',
  ({ edit, rebuild }) => {
    for (let i = 0; i < 2; i++)
      edit(
        APPEAL_START,
        '<targetId><![CDATA[decide]]></targetId>',
        '<targetId><![CDATA[end]]></targetId>',
      );
    rebuild();
  },
  /PayersAppealReview\/decide\/document\.xml is not reached from the start/,
);
refuse(
  'an appeal review node from which no stop node is reached',
  ({ edit, rebuild }) => {
    for (let i = 0; i < 3; i++)
      edit(
        DECIDE,
        '<targetId><![CDATA[end]]></targetId>',
        '<targetId><![CDATA[decide]]></targetId>',
      );
    rebuild();
  },
  /PayersAppealReview\/decide\/document\.xml reaches no stop node/,
);
refuse(
  'an appeal review transition name given twice in a node',
  ({ edit, rebuild }) => {
    edit(DECIDE, '<name><![CDATA[overturn]]></name>', '<name><![CDATA[uphold]]></name>');
    rebuild();
  },
  /PayersAppealReview\/decide\/document\.xml repeats a transition name/,
);
refuse(
  'an appeal review model that is not validated',
  ({ edit, rebuild }) => {
    edit(
      APPEAL_ROOT,
      '<lifecycle-state>validated</lifecycle-state>',
      '<lifecycle-state>draft</lifecycle-state>',
    );
    rebuild();
  },
  /PayersAppealReview\/document\.xml is not validated/,
);
refuse(
  "the appeal review's availability filter not contributed",
  ({ edit }) =>
    edit(WORKFLOW, 'filter id="filter@PayersAppealReview"', 'filter id="filter@OtherAppeal"'),
  /availabilityFilter filter@PayersAppealReview is not contributed/,
);
refuse(
  'an appeal review task form for a step that has no task',
  ({ kit }) =>
    writeFileSync(
      join(kit, 'bundle', 'agentic-ui-config', 'tasks', `${APPEAL}.start.layout.json`),
      '{ "version": 2, "cards": [] }\n',
    ),
  /tasks\/PayersAppealReview\.start\.layout\.json is a task form for start, which has no task/,
);
refuse(
  "the appeal decision's vocabulary not contributed",
  ({ edit }) =>
    edit(
      WORKFLOW,
      '<directory name="PayersAppealDecision"',
      '<directory name="PayersDecisionOfAppeal"',
    ),
  /picks from PayersAppealDecision, which no component contributes/,
);
refuse(
  'an appeal review facet no component contributes',
  ({ edit, rebuild }) => {
    edit(
      DECIDE,
      '<facet>facet-var_PayersAppealReview_decide</facet>',
      '<facet>facet-var_PayersAppealReview_decision</facet>',
    );
    rebuild();
  },
  /names the facet facet-var_PayersAppealReview_decision, which no component contributes/,
);
refuse(
  "the appeal decision's step with a task and no variables facet",
  ({ edit, rebuild }) => {
    edit(
      DECIDE,
      '    <rnode:variablesFacet><![CDATA[facet-var_PayersAppealReview_decide]]></rnode:variablesFacet>\n',
      '',
    );
    rebuild();
  },
  /PayersAppealReview\/decide.* has a task and names no variablesFacet/,
);
refuse(
  "the appeal decision's step naming another workflow's step's variables facet",
  ({ edit, rebuild }) => {
    for (const [from, to] of [
      [
        '<facet>facet-var_PayersAppealReview_decide<',
        '<facet>facet-var_PayersClaimReview_determine<',
      ],
      ['[facet-var_PayersAppealReview_decide]', '[facet-var_PayersClaimReview_determine]'],
    ])
      edit(DECIDE, from, to);
    rebuild();
  },
  /PayersAppealReview\/decide\/document\.xml names the variables facet facet-var_PayersClaimReview_determine, not its own, facet-var_PayersAppealReview_decide/,
);
refuse(
  "the appeal decision's own variables facet not holding its own schema",
  ({ edit }) =>
    edit(
      WORKFLOW,
      '<facet name="facet-var_PayersAppealReview_decide">\n      <schema name="var_PayersAppealReview_decide" />',
      '<facet name="facet-var_PayersAppealReview_decide">\n      <schema name="var_PayersAppealReview" />',
    ),
  /facet-var_PayersAppealReview_decide does not hold its own schema, var_PayersAppealReview_decide/,
);
refuse(
  "an appeal review variable schema's namespace apart from its file's",
  ({ edit, rebuild }) => {
    edit(
      DECIDE,
      'payers-claims-demo/var_PayersAppealReview_decide" name=',
      'payers-claims-demo/var_decide" name=',
    );
    rebuild();
  },
  /gives var_PayersAppealReview_decide the namespace .*, not its schema's/,
);
refuse(
  "the appeal decision's task form the app does not name",
  ({ edit }) =>
    edit(
      'bundle/OSGI-INF/payers-claims-demo-config.xml',
      `<file path="tasks/${APPEAL}.decide.layout.json" />`,
      '',
    ),
  /the app's contribution does not name tasks\/PayersAppealReview\.decide\.layout\.json/,
);
refuse(
  "the appeal decision's step with no task form",
  ({ kit }) => rmSync(join(kit, ...DECIDE_FORM.split('/'))),
  /decide has a task and no task form, tasks\/PayersAppealReview\.decide\.layout\.json/,
);
refuse(
  "an appeal decision task form's var: field that is no variable",
  ({ edit }) => edit(DECIDE_FORM, '"field": "var:rationale"', '"field": "var:reason"'),
  /var:reason is a variable of neither decide nor the workflow/,
);
refuse(
  "an appeal decision task form's record field that is no property of the stand-in model",
  ({ edit }) => edit(DECIDE_FORM, '"case:number",', '"case:numbr",'),
  /PayersAppealReview\.decide\.layout\.json's case:numbr is not a property of the stand-in model/,
);
refuse(
  "the appeal decision's vocabulary whose ids are not the variable's values",
  ({ edit }) =>
    edit(
      'bundle/data/vocabularies/PayersAppealDecision.csv',
      '"overturn","Overturn the denial"',
      '"reverse","Overturn the denial"',
    ),
  /picks \["reverse","uphold"\], and the variable takes \["overturn","uphold"\]/,
);
refuse(
  "the appeal review's template-resource naming another file",
  ({ edit }) => edit(WORKFLOW, `path="${APPEAL_ZIP}"`, 'path="data/Other.zip"'),
  /the template-resource PayersAppealReview names data\/Other\.zip/,
);
refuse(
  'a template-resource for a model the kit does not have',
  ({ edit }) =>
    edit(
      WORKFLOW,
      `<template-resource id="${APPEAL}" path="${APPEAL_ZIP}" />`,
      `<template-resource id="${APPEAL}" path="${APPEAL_ZIP}" />\n    <template-resource id="PayersOther" path="data/PayersOther.zip" />`,
    ),
  /the template-resource PayersOther is not a route model of the kit/,
);
refuse(
  'a chain running a chain no component contributes, through RunOperation',
  ({ edit }) =>
    edit(
      WORKFLOW,
      '"PayersAppealReview.AddDecisionLetter" : "PayersAppealReview.TickDecisionLetter"',
      '"PayersAppealReview.AddDecisionLetter" : "PayersAppealReview.TickLetter"',
    ),
  /the chain PayersAppealReview\.Uphold runs the chain PayersAppealReview\.TickLetter, which no component contributes/,
);
refuse(
  'a chain parameter holding a <, which the server reads escaped',
  ({ edit }) => edit(WORKFLOW, 'expr:decisionLetterAt == -1 ? ', 'expr:decisionLetterAt &lt; 0 ? '),
  /the chain PayersAppealReview\.Uphold gives RunOperation's id a <, > or &, which the server reads escaped/,
);
refuse(
  'a chain starting a workflow that is not one of the kit',
  ({ edit }) =>
    edit(
      WORKFLOW,
      '<param type="string" name="id">PayersClaimReview</param>',
      '<param type="string" name="id">PayersClaimsReview</param>',
    ),
  /the chain PayersAppealReview\.Overturn starts the workflow PayersClaimsReview, which is not a route model the kit contributes/,
);
refuse(
  'a chain writing a value an enumerated property does not take',
  ({ edit }) =>
    edit(
      WORKFLOW,
      '<param type="serializable" name="value">upheld</param>',
      '<param type="serializable" name="value">upholded</param>',
    ),
  /the chain PayersAppealReview\.Uphold writes upholded to case:decision, which takes \["upheld","overturned"\]/,
);
refuse(
  'a chain writing a property the stand-in model does not have',
  ({ edit }) =>
    edit(
      WORKFLOW,
      '<param type="string" name="xpath">case:decision</param>',
      '<param type="string" name="xpath">case:verdict</param>',
    ),
  /the chain PayersAppealReview\.Uphold writes case:verdict, which the stand-in model does not have/,
);
refuse(
  "a chain writing a checklist entry's subfield it does not have",
  ({ edit }) => edit(WORKFLOW, '+ "/doneOn"</param>', '+ "/doneAt"</param>'),
  /the chain PayersAppealReview\.TickDecisionLetter writes case:checklist\/\*\/doneAt, whose entries have no doneAt/,
);
refuse(
  'a chain adding a checklist entry with a subfield the entry does not have',
  ({ edit }) => edit(WORKFLOW, '"doneBy": "@{nodeLastActor}"', '"by": "@{nodeLastActor}"'),
  /the chain PayersAppealReview\.AddDecisionLetter adds to case:checklist an entry with by, which it has not/,
);
refuse(
  "a chain adding a checklist item the Case page's checklist does not list",
  ({ edit }) => edit(WORKFLOW, '"item": "decisionLetter"', '"item": "decisionLeter"'),
  /writes the checklist item decisionLeter, which the Case page's checklist does not list/,
);
refuse(
  "a chain looking for a checklist item the Case page's checklist does not list",
  ({ edit }) => edit(WORKFLOW, 'indexOf("decisionLetter")', 'indexOf("decision")'),
  /the chain PayersAppealReview\.Uphold looks for the checklist item decision, which the Case page's checklist does not list/,
);
refuse(
  "the decision letter item gone from the Case page's checklist, which the chains still write",
  ({ edit }) =>
    edit(
      CASE_LAYOUT,
      '{ "id": "decisionLetter", "labelKey": "payers.appeal.decisionLetter" }',
      '{ "id": "letterSent", "labelKey": "payers.appeal.decisionLetter" }',
    ),
  /writes the checklist item decisionLetter, which the Case page's checklist does not list/,
);

// The XML reader, and the claim lifecycle read with it (`demo/lifecycle.mjs`), on malformed
// comments: each is refused whole, never read past, so no markup left around one is taken for a
// contribution. `<!<!---->-->` is the shape a pattern that removes `<!--…-->` leaves as `<!-->`.
const LIFECYCLE_XML = (inside) =>
  '<component name="c">' +
  inside +
  '<extension target="org.nuxeo.ecm.core.lifecycle.LifeCycleService" point="lifecycle">' +
  '<lifecycle name="payersClaim" defaultInitial="submitted"><transitions/>' +
  '<states><state name="submitted" initial="true"/></states></lifecycle></extension></component>';
const readerRefuses = (what, read, expected) => {
  controls++;
  try {
    read();
    failures.push(`${what}: read, and not refused`);
  } catch (error) {
    if (!expected.test(error.message))
      failures.push(`${what}: refused for another reason: ${error.message}`);
  }
};
{
  const lifecycle = readLifecycle();
  controls++;
  if (lifecycle.initial !== 'submitted' || lifecycle.states.size !== 7)
    failures.push(`the claim lifecycle is not read from the stand-in model: ${lifecycle.initial}`);
  controls++;
  if (readLifecycle(LIFECYCLE_XML('<!-- an example -->')).initial !== 'submitted')
    failures.push('a well-formed comment before the lifecycle stops it being read');
}
readerRefuses(
  'a "<!<!---->-->" before the lifecycle',
  () => readLifecycle(LIFECYCLE_XML('<!<!---->-->')),
  /not well-formed XML: line 1: a "<!" that opens neither a comment nor CDATA/,
);
readerRefuses(
  'a lifecycle after "<!<!---->--", as the document element itself',
  () => parseXml(`<!<!---->--${LIFECYCLE_XML('')}`),
  /a "<!" that opens neither a comment nor CDATA/,
);
readerRefuses(
  'a lifecycle inside a comment that holds "--"',
  () => readLifecycle(LIFECYCLE_XML('<!-- <!-- -->')),
  /"--" inside a comment/,
);
readerRefuses(
  'a lifecycle only in a comment',
  () =>
    readLifecycle(
      `<component name="c"><!-- ${LIFECYCLE_XML('').replace('<component name="c">', '').replace('</component>', '')} --></component>`,
    ),
  /no lifecycle payersClaim in the stand-in model/,
);
readerRefuses(
  'an unclosed comment',
  () => readLifecycle(LIFECYCLE_XML('<!-- open')),
  /"--" inside a comment|an unclosed comment/,
);

if (failures.length > 0) {
  console.error(`route model selftest: ${failures.length} problem(s)\n`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(
  `route model selftest: the kit passes, and all ${controls} controls were refused, each for its own reason.`,
);
