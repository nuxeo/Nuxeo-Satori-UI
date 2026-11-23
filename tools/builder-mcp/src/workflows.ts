/**
 * Workflow models, their steps and the variables a task form edits.
 *
 * No single endpoint says it all, so a model takes several reads, each a `GET`:
 *
 * - `/workflowModel/<name>`: the model's id, title and its variables' default values;
 * - `/workflowModel/<name>/graph`: its steps, which start and end, and the transitions between them;
 * - `/id/<model id>`, its `document_route_instance` schema only: the model document, whose
 *   `docri:variablesFacet` names the facet that holds the workflow's variables, and whose path
 *   holds the steps;
 * - `<model path>/<step id>`, its `route_node` schema only: each step's document. Its
 *   `rnode:variablesFacet` names the facet that
 *   holds the step's variables, and the rest says what the task is: buttons, directive, layout,
 *   transitions with their conditions and chains. It is read by path because `@children` leaves
 *   steps out, as it leaves out every document hidden in navigation;
 * - `/config/facets`: the fields of those facets' schemas, with their types.
 *
 * A step whose document cannot be read is reported with the reason, and its variables are left
 * unknown rather than guessed.
 */
import { NuxeoError, segment, type NuxeoReads } from './nuxeo.ts';
import { toSchema, type Field } from './model.ts';
import {
  entries,
  isRecord,
  list,
  notFound,
  record,
  text,
  texts,
  type JsonRecord,
} from './shapes.ts';

/**
 * The one schema read of each document: the workflow's own. A model or a step is read with no
 * other, so no Dublin Core or other properties, such as who made it, are asked for.
 */
const MODEL_SCHEMA = 'document_route_instance';
const STEP_SCHEMA = 'route_node';

export interface Variable {
  readonly name: string;
  readonly type: string;
  readonly fields?: readonly Field[];
  /** The model's default, for a workflow variable. */
  readonly default?: unknown;
}

export async function listWorkflows(nuxeo: NuxeoReads) {
  const models = entries(await nuxeo.get('/workflowModel'), '/workflowModel').filter(isRecord);
  return {
    workflows: models.map((model) => ({
      name: text(model['name']),
      title: text(model['title']),
      id: text(model['id']),
      state: text(model['state']),
      variables: isRecord(model['variables']) ? Object.keys(model['variables']) : [],
    })),
    note: 'A title is often a label key. describe_workflow gives the steps and their variables.',
  };
}

export async function describeWorkflow(nuxeo: NuxeoReads, name: string) {
  let model: JsonRecord;
  try {
    model = record(await nuxeo.get(`/workflowModel/${segment(name)}`), `/workflowModel/${name}`);
  } catch (error) {
    if (!(error instanceof NuxeoError) || error.status !== 404) throw error;
    const known = entries(await nuxeo.get('/workflowModel'), '/workflowModel')
      .filter(isRecord)
      .map((entry) => text(entry['name']) ?? '');
    throw notFound('workflow model', name, known);
  }
  const id = text(model['id']);
  if (!id) throw new NuxeoError(`/workflowModel/${name} has no id`, null);
  const [graph, document, facets] = await Promise.all([
    nuxeo.get(`/workflowModel/${segment(name)}/graph`),
    nuxeo.get(`/id/${segment(id)}`, { properties: MODEL_SCHEMA }),
    nuxeo.get('/config/facets'),
  ]);
  const facetFields = new Map<string, Field[]>();
  for (const facet of list(facets, '/config/facets').filter(isRecord)) {
    const facetName = text(facet['name']);
    if (!facetName) continue;
    const schemas = Array.isArray(facet['schemas']) ? facet['schemas'].filter(isRecord) : [];
    facetFields.set(
      facetName,
      schemas.flatMap((schema) => toSchema(schema).fields),
    );
  }
  const problems: string[] = [];
  const variablesOf = (
    facet: string | null,
    where: string,
    defaults?: JsonRecord,
  ): Variable[] | null => {
    if (!facet) {
      problems.push(`${where} names no variables facet.`);
      return null;
    }
    const fields = facetFields.get(facet);
    if (!fields) {
      problems.push(`${where} names the facet ${facet}, which /config/facets does not describe.`);
      return null;
    }
    return fields.map((field) => {
      const variable = field.xpath?.slice(field.xpath.indexOf(':') + 1) ?? field.name ?? '';
      return {
        name: variable,
        type: field.type,
        ...(field.fields ? { fields: field.fields } : {}),
        ...(defaults && variable in defaults ? { default: defaults[variable] } : {}),
      };
    });
  };

  const modelDocument = record(document, `/id/${id}`);
  const modelProperties = isRecord(modelDocument['properties']) ? modelDocument['properties'] : {};
  const path = text(modelDocument['path']);
  const workflowVariables = variablesOf(
    text(modelProperties['docri:variablesFacet']),
    'The model',
    isRecord(model['variables']) ? model['variables'] : {},
  );

  const graphRecord = record(graph, `/workflowModel/${name}/graph`);
  const transitionsOut = new Map<string, JsonRecord[]>();
  for (const transition of list(graphRecord['transitions'] ?? [], 'the graph transitions').filter(
    isRecord,
  )) {
    const source = text(transition['nodeSourceId']);
    if (source) transitionsOut.set(source, [...(transitionsOut.get(source) ?? []), transition]);
  }
  const nodes = await Promise.all(
    list(graphRecord['nodes'] ?? [], 'the graph nodes')
      .filter(isRecord)
      .map(async (node) => {
        const nodeId = text(node['id']) ?? '';
        const step = {
          id: nodeId,
          title: text(node['title']),
          start: node['isStartNode'] === true,
          end: node['isEndNode'] === true,
          fork: node['isForkNode'] === true,
          merge: node['isMerge'] === true,
          multipleTasks: node['isMultiTask'] === true,
          subWorkflow: node['hasSubWorkflow'] === true,
        };
        const fromGraph = (transitionsOut.get(nodeId) ?? []).map((transition) => ({
          label: text(transition['label']),
          target: text(transition['nodeTargetId']),
        }));
        let properties: JsonRecord;
        try {
          if (!path) throw new NuxeoError('the model document has no path', null);
          const stepPath = [...path.split('/').filter(Boolean), nodeId].map(segment).join('/');
          const stepDocument = record(
            await nuxeo.get(`/path/${stepPath}`, { properties: STEP_SCHEMA }),
            `the step ${nodeId}`,
          );
          properties = isRecord(stepDocument['properties']) ? stepDocument['properties'] : {};
        } catch (error) {
          if (!(error instanceof NuxeoError)) throw error;
          problems.push(`The step ${nodeId}'s document could not be read: ${error.message}`);
          return { ...step, transitions: fromGraph, variables: null };
        }
        const variables = variablesOf(
          text(properties['rnode:variablesFacet']),
          `The step ${nodeId}`,
        );
        const hasTask = properties['rnode:hasTask'] === true;
        return {
          ...step,
          task: hasTask
            ? {
                directive: text(properties['rnode:taskDirective']),
                layout: text(properties['rnode:taskLayout']),
                documentType: text(properties['rnode:taskDocType']),
                buttons: (Array.isArray(properties['rnode:taskButtons'])
                  ? properties['rnode:taskButtons']
                  : []
                )
                  .filter(isRecord)
                  .map((button) => ({
                    name: text(button['name']),
                    label: text(button['label']),
                    validate: button['validate'] === true,
                  })),
                assignees: texts(properties['rnode:taskAssignees']),
                assigneesExpression: text(properties['rnode:taskAssigneesExpr']),
                dueDateExpression: text(properties['rnode:taskDueDateExpr']),
                // docs/business-apps/app-definition-v2.md, section 6: the file a task form for
                // this step is, and what its `var:` fields can name.
                form: {
                  file: `tasks/${name}.${nodeId}.layout.json`,
                  fields: [...(variables ?? []), ...(workflowVariables ?? [])].map(
                    (variable) => `var:${variable.name}`,
                  ),
                },
              }
            : null,
          variables,
          inputChain: text(properties['rnode:inputChain']),
          outputChain: text(properties['rnode:outputChain']),
          transitions: Array.isArray(properties['rnode:transitions'])
            ? properties['rnode:transitions'].filter(isRecord).map((transition) => ({
                name: text(transition['name']),
                label: text(transition['label']),
                target: text(transition['targetId']),
                condition: text(transition['condition']),
                chain: text(transition['chain']),
              }))
            : fromGraph,
        };
      }),
  );
  return {
    name,
    title: text(model['title']),
    id,
    path,
    variables: workflowVariables,
    nodes,
    ...(problems.length ? { problems } : {}),
  };
}
