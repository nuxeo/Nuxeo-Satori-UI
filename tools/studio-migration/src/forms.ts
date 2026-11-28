/**
 * The places of a converted app definition that show a Web UI layout's fields, as the harness
 * reads them: each document layout's file, or each tab of a view file that has tabs, and each
 * task form. Worked out from the package alone, never from the conversion's report.
 */
import { isRecord } from '@agentic-ui/shared/app-definition';
import { layoutFields, type ShownField } from './app-walk';
import type { LayoutSource } from './blocks';
import {
  TAB_OPTIONS,
  layoutOptions,
  layoutSource,
  tabSource,
  writtenLayouts,
  type PlanOptions,
} from './convert-layouts';
import { tabPlans, type TabPlan } from './convert-tabs';
import { TASK_OPTIONS, taskFormPlaces, taskSource } from './convert-tasks';
import type { Inventory } from './inventory';
import type { StudioPackage } from './studio-package';

export interface FormPlace {
  /** The file under `app/`. */
  readonly path: string;
  /** The tab it is, by its id, in a view file with tabs; `null` for the whole file. */
  readonly tab: string | null;
  readonly source: LayoutSource;
  readonly options: PlanOptions;
  /** What Web UI shows there, for a finding. */
  readonly what: string;
  /** For a tab of the package, the tab. */
  readonly tabPlan?: TabPlan;
}

export function formPlaces(pkg: StudioPackage, inventory: Inventory): FormPlace[] {
  const places: FormPlace[] = [];
  const tabs = tabPlans({ inventory, pkg });
  for (const [path, layout] of writtenLayouts(inventory)) {
    const type = layout.docType as string;
    const typeTabs = layout.mode === 'view' ? tabs.filter((tab) => tab.types.includes(type)) : [];
    places.push({
      path,
      tab: typeTabs.length > 0 ? 'view' : null,
      source: layoutSource(layout),
      options: layoutOptions(layout.mode),
      what: `Web UI's ${layout.mode} layout of ${type}`,
    });
    for (const tab of typeTabs)
      places.push({
        path,
        tab: tab.id,
        source: tabSource(tab),
        options: TAB_OPTIONS,
        what: `Web UI's tab ${tab.name} of ${type}`,
        tabPlan: tab,
      });
  }
  for (const [task, place] of taskFormPlaces(pkg, inventory)) {
    if ('problem' in place) continue;
    places.push({
      path: place.path,
      tab: null,
      source: taskSource(task),
      options: TASK_OPTIONS,
      what: `Web UI's task layout of ${place.workflow}.${place.step}`,
    });
  }
  return places;
}

/**
 * The fields a place shows: a file's, or one tab's. In a view file that has no tabs, the `view`
 * tab is the whole file, and any other tab shows nothing.
 */
export function shownIn(file: unknown, tab: string | null): ShownField[] {
  const tabs = isRecord(file) && Array.isArray(file['tabs']) ? file['tabs'] : null;
  if (tab === null || tabs === null)
    return tab === null || tab === 'view' ? layoutFields(file) : [];
  const index = tabs.findIndex((candidate) => isRecord(candidate) && candidate['id'] === tab);
  if (index === -1) return [];
  return layoutFields({ tabs: [tabs[index]] }).map((field) => ({
    ...field,
    at: field.at.replace(/^tabs\.0\./, `tabs.${index}.`),
  }));
}

/** The tab of a view file with the given id, and its place, or `null`. */
export function tabOf(
  file: unknown,
  id: string,
): { readonly tab: Record<string, unknown>; readonly index: number } | null {
  const tabs = isRecord(file) && Array.isArray(file['tabs']) ? file['tabs'] : [];
  const index = tabs.findIndex((candidate) => isRecord(candidate) && candidate['id'] === id);
  return index === -1 ? null : { tab: tabs[index] as Record<string, unknown>, index };
}
