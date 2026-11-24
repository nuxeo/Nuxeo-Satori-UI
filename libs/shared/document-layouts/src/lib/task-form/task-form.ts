import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  untracked,
  viewChild,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import type { NxsHeadingLevel, NxsTaskForm } from '@nuxeo/satori-platform/components';
import type { NuxeoTask } from '@nuxeo/satori-platform/nuxeo-client';
import { of, startWith, switchMap } from 'rxjs';

import { DocumentLayoutService } from '../document-layout.service';
import { DocumentLayoutFormComponent } from '../document-layout-form/document-layout-form';
import { readValidationFailure } from '../validation-failure';

/** `var_<schema>:<name>`, a variable as Nuxeo names it in a validation message. */
const VARIABLE_PROPERTY = /^var_[^:]+:(.+)$/;

/**
 * Nuxeo's validation messages, by the field each names on the form: a variable's property,
 * `var_<step>:<name>` or `var_<workflow>:<name>`, is the form's `var:<name>`.
 */
export function taskFormMessages(
  messages: Readonly<Record<string, string>>,
): Record<string, string> {
  const placed: Record<string, string> = {};
  for (const [xpath, message] of Object.entries(messages)) {
    const variable = VARIABLE_PROPERTY.exec(xpath);
    placed[variable ? `var:${variable[1]}` : xpath] ??= message;
  }
  return placed;
}

/**
 * A workflow task's own form, in the task panel: the fields its step's task form,
 * `tasks/<workflow>.<step>.layout.json`, draws (docs/business-apps/app-definition-v2.md,
 * section 6). It is registered as `nxs.components.taskForm`, and the panel, `nxs-task-detail`,
 * renders it with the task, whether a request is running, and `onForm`, to which it hands the
 * form once its step has one. A step with no task form hands none, and the panel shows its own.
 *
 * The record the task is on, its first target document, is read with all its properties: its own
 * properties show read-only, and the form's rules and checks read them. The step's variables are
 * the `var:` fields, the only ones it edits.
 *
 * Not a security control: the server decides who may complete the task, and with what.
 */
@Component({
  selector: 'lib-task-form',
  standalone: true,
  imports: [DocumentLayoutFormComponent],
  templateUrl: './task-form.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaskFormComponent {
  /** The task, as the task panel is given it. */
  readonly task = input<NuxeoTask | null>(null);
  /** While the task is being completed: the form is read-only. */
  readonly disabled = input(false);
  /** Given the form once the task's step has one, and `null` when it has none or no longer. */
  readonly onForm = input<((form: NxsTaskForm | null) => void) | null>(null);
  /** The level of the form's section headings, as the task panel gives it. */
  readonly headingLevel = input<NxsHeadingLevel>(4);

  private readonly layouts = inject(DocumentLayoutService);
  private readonly form = viewChild(DocumentLayoutFormComponent);

  /**
   * The record the task is on, by id, with the task: read again for each task, even on the same
   * record, which an earlier step may have changed. A task on no record has no form.
   */
  private readonly target = computed(
    () => {
      const task = this.task();
      const target = task?.targetDocumentIds?.[0];
      const id = target?.uid || target?.id || null;
      return task && id ? { task: task.id, id } : null;
    },
    { equal: (a, b) => a === b || (!!a && !!b && a.task === b.task && a.id === b.id) },
  );

  /** The record, read for the form; `null` while it is read, or when it cannot be. */
  protected readonly document = toSignal(
    toObservable(this.target).pipe(
      // Nothing until the new record is read, so a form is never drawn over the last task's.
      switchMap((target) =>
        target ? this.layouts.taskDocument(target.id).pipe(startWith(null)) : of(null),
      ),
    ),
    { initialValue: null },
  );

  /** The form handed, for the panel to validate, complete the task with, and give a refusal to. */
  private readonly handle: NxsTaskForm = {
    validate: () => this.form()?.validate() ?? false,
    variables: () => this.form()?.taskVariables() ?? {},
    showFailure: (failure) => {
      const messages = readValidationFailure(failure, '');
      if (!messages) return null;
      const form = this.form();
      const placed = taskFormMessages(messages);
      return form ? form.showServerErrors(placed) : Object.values(placed);
    },
  };

  constructor() {
    // Handed while the form draws a task form, withdrawn otherwise, so the panel never validates
    // a form that is not on screen.
    effect(() => {
      const drawn = this.form()?.taskFormDrawn() ?? false;
      const onForm = this.onForm();
      untracked(() => onForm?.(drawn ? this.handle : null));
    });
    inject(DestroyRef).onDestroy(() => untracked(this.onForm)?.(null));
  }
}
