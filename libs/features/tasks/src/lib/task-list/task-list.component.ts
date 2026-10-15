import { Component, inject, signal, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { NuxeoTask, TaskService, CURRENT_USERNAME } from '@nuxeo/satori-platform/nuxeo-client';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'lib-task-list',
  standalone: true,
  imports: [TranslatePipe, MatIconModule, MatButtonModule, MatProgressSpinnerModule],
  templateUrl: './task-list.component.html',
  styleUrl: './task-list.component.scss',
})
export class TaskListComponent implements OnInit {
  private readonly taskService = inject(TaskService);
  private readonly translate = inject(TranslateService);
  private readonly currentUsername = inject(CURRENT_USERNAME);
  private readonly router = inject(Router);

  readonly tasks = signal<NuxeoTask[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.loadTasks();
  }

  loadTasks(): void {
    this.loading.set(true);
    this.error.set(null);
    const userId = this.currentUsername() ?? 'Administrator';

    this.taskService.getUserTasks(userId, 50).subscribe({
      next: (entries) => {
        this.tasks.set(entries);
        this.loading.set(false);
      },
      error: () => {
        this.error.set(this.translate.instant('tasks.message.failed-to-load-tasks'));
        this.loading.set(false);
      },
    });
  }

  processTask(task: NuxeoTask): void {
    this.router.navigate(['/tasks', task.id]);
  }

  taskLabel(task: NuxeoTask): string {
    const key = task.name.replace(/^wf\.\w+\./, '').replace(/\.(title|directive)$/i, '');
    return key
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\./g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  taskWorkflow(task: NuxeoTask): string {
    const raw = task.workflowTitle || task.workflowModelName;
    const key = raw.replace(/^wf\.\w+\./, '');
    return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  isOverdue(task: NuxeoTask): boolean {
    return !!task.dueDate && new Date(task.dueDate) < new Date();
  }

  dueLabel(task: NuxeoTask): string {
    if (!task.dueDate) return '';
    const diff = new Date(task.dueDate).getTime() - Date.now();
    const absDiff = Math.abs(diff);
    const days = Math.floor(absDiff / 86_400_000);
    const hours = Math.floor(absDiff / 3_600_000);

    let label: string;
    if (days >= 1) label = days === 1 ? '1 day' : `${days} days`;
    else label = hours <= 1 ? 'less than an hour' : `${hours} hours`;

    return diff > 0 ? `in ${label}` : `${label} overdue`;
  }
}
