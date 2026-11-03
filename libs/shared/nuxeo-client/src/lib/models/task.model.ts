import { NuxeoPaginatedList } from './paginated.model';

export interface NuxeoTask {
  id: string;
  name: string;
  directive: string;
  workflowInstanceId: string;
  workflowModelName: string;
  workflowTitle: string;
  created: string;
  dueDate: string;
  state: string;
  nodeName: string;
  targetDocumentIds: { id?: string; uid?: string; title?: string; type?: string; path?: string }[];
  actors: { id: string }[];
  delegatedActors: { id: string }[];
  comments: { author: string; text: string; date: string }[];
  variables: Record<string, unknown>;
  taskInfo: {
    /** `validate` is false for an action that skips the task's form, such as Cancel. */
    taskActions: { name: string; label: string; url?: string; validate?: boolean }[];
  };
  /** Enriched client-side after fetching the target document */
  targetDocTitle?: string;
}

export type NuxeoTaskList = NuxeoPaginatedList<NuxeoTask>;
