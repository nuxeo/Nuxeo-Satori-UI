import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatTooltip } from '@angular/material/tooltip';
import { By } from '@angular/platform-browser';

import { NxsDocumentToolbarComponent, type NxsToolbarAction } from './document-toolbar.component';

const ACTIONS: readonly NxsToolbarAction[] = [
  { id: 'app.toolbar.edit', label: 'Edit', icon: 'edit' },
  {
    id: 'app.toolbar.unlock',
    label: 'Unlock',
    icon: 'lock',
    tooltip: 'Locked by Jane on May 3, 2026',
    active: true,
  },
  { id: 'app.toolbar.delete', label: 'Delete', icon: 'delete', disabled: true },
  { id: 'app.toolbar.export', label: 'Export', icon: 'download', overflow: true },
  {
    id: 'app.toolbar.publish',
    label: 'Publish document',
    overflow: true,
    disabled: true,
    tooltip: 'Create a version first',
  },
];

@Component({
  standalone: true,
  imports: [NxsDocumentToolbarComponent],
  template: `
    <nxs-document-toolbar
      [actions]="actions()"
      [label]="label()"
      [moreLabel]="moreLabel()"
      (selected)="chosen.push($event.id)"
    >
      <button type="button" class="projected">Classify</button>
    </nxs-document-toolbar>
  `,
})
class HostComponent {
  readonly actions = signal<readonly NxsToolbarAction[]>(ACTIONS);
  readonly label = signal('');
  readonly moreLabel = signal('');
  readonly chosen: string[] = [];
}

describe('NxsDocumentToolbarComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const inline = (id: string): HTMLButtonElement | null =>
    el().querySelector(`.nxs-document-toolbar__action[data-action-id="${id}"]`);
  const more = (): HTMLButtonElement | null => el().querySelector('.nxs-document-toolbar__more');
  /** The name a button's content gives it, minus what is hidden from assistive technology. */
  const nameOf = (button: Element | null): string => {
    if (!button) throw new Error('no such button');
    const copy = button.cloneNode(true) as Element;
    copy.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
    return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
  };
  const menuItem = (id: string): HTMLButtonElement | null =>
    document.querySelector(`[role="menuitem"][data-action-id="${id}"]`);
  const tooltipOf = (node: Element | null): MatTooltip => {
    const match = fixture.debugElement
      .queryAll(By.directive(MatTooltip))
      .find((debug) => debug.nativeElement === node);
    if (!match) throw new Error('no tooltip on that element');
    return match.injector.get(MatTooltip);
  };

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await render();
  });

  afterEach(() => document.querySelectorAll('.cdk-overlay-container').forEach((n) => n.remove()));

  it('puts inline entries in the row and overflow entries only behind the menu', () => {
    expect(inline('app.toolbar.edit')).not.toBeNull();
    expect(inline('app.toolbar.unlock')).not.toBeNull();
    expect(inline('app.toolbar.export')).toBeNull();
    expect(more()).not.toBeNull();
  });

  it('names each icon button by its label and shows the tooltip it was given, else the label', () => {
    expect(nameOf(inline('app.toolbar.edit'))).toBe('Edit');
    expect(tooltipOf(inline('app.toolbar.edit')).message).toBe('Edit');
    expect(tooltipOf(inline('app.toolbar.unlock')).message).toBe('Locked by Jane on May 3, 2026');
  });

  it('carries what the tooltip adds into the name, so the keyboard hears the lock owner', () => {
    expect(nameOf(inline('app.toolbar.unlock'))).toBe('Unlock. Locked by Jane on May 3, 2026');
  });

  it('names icon buttons with text rather than aria-label, and hides the icon ligature (WCAG 2.5.3)', () => {
    for (const button of Array.from(el().querySelectorAll('.nxs-document-toolbar__action'))) {
      expect(button.hasAttribute('aria-label')).toBe(false);
      expect(button.querySelector('mat-icon')?.getAttribute('aria-hidden')).toBe('true');
    }
    expect(more()?.hasAttribute('aria-label')).toBe(false);
    expect(more()?.querySelector('mat-icon')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('does not repeat a tooltip that only restates the label', async () => {
    host.actions.set([{ id: 'x', label: 'Share', icon: 'share', tooltip: 'Share' }]);
    await render();
    expect(nameOf(inline('x'))).toBe('Share');
  });

  it('treats a blank tooltip as absent rather than rendering an empty bubble', async () => {
    host.actions.set([{ id: 'x', label: 'Share', icon: 'share', tooltip: '   ' }]);
    await render();
    expect(tooltipOf(inline('x')).message).toBe('Share');
  });

  it('highlights an active entry', () => {
    expect(inline('app.toolbar.unlock')?.classList).toContain(
      'nxs-document-toolbar__action--active',
    );
    expect(inline('app.toolbar.edit')?.classList).not.toContain(
      'nxs-document-toolbar__action--active',
    );
  });

  it('emits the entry the user ran', () => {
    inline('app.toolbar.edit')?.click();
    expect(host.chosen).toEqual(['app.toolbar.edit']);
  });

  it('keeps a disabled inline entry focusable for its tooltip but refuses its click', () => {
    const button = inline('app.toolbar.delete');
    expect(button?.disabled).toBe(false);
    expect(button?.getAttribute('aria-disabled')).toBe('true');
    button?.click();
    expect(host.chosen).toEqual([]);
  });

  it('lists overflow entries in the menu, with their tooltip only when they carry one', async () => {
    more()?.click();
    await render();
    expect(menuItem('app.toolbar.export')?.textContent).toContain('Export');
    expect(menuItem('app.toolbar.publish')?.disabled).toBe(true);
    const tips = fixture.debugElement.queryAll(By.directive(MatTooltip));
    expect(tips.length).toBeGreaterThan(0);
    menuItem('app.toolbar.export')?.click();
    expect(host.chosen).toEqual(['app.toolbar.export']);
  });

  it('labels the group and the menu button with its own English when the host passes none', () => {
    const group = el().querySelector('[role="group"]');
    expect(group?.getAttribute('aria-label')).toBe('Document actions');
    expect(nameOf(more())).toBe('More actions');
    expect(tooltipOf(more()).message).toBe('More actions');
  });

  it('uses the labels the host passes, trimmed', async () => {
    host.label.set('  File actions ');
    host.moreLabel.set(' More ');
    await render();
    expect(el().querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('File actions');
    expect(nameOf(more())).toBe('More');
  });

  it('drops the menu button when nothing overflows, rather than opening an empty menu', async () => {
    host.actions.set(ACTIONS.filter((action) => !action.overflow));
    await render();
    expect(more()).toBeNull();
  });

  it('shows the label as text when an inline entry has no icon', async () => {
    host.actions.set([{ id: 'x', label: 'Share' }]);
    await render();
    expect(inline('x')?.textContent?.trim()).toBe('Share');
  });

  it('keeps a text entry named by its visible label, followed by what the tooltip adds', async () => {
    host.actions.set([{ id: 'x', label: 'Share', tooltip: 'Shared with 3 people' }]);
    await render();
    expect(nameOf(inline('x'))).toBe('Share. Shared with 3 people');
    expect(nameOf(inline('x')).startsWith('Share')).toBe(true);
  });

  it('renders projected controls inside the group, before the actions', () => {
    const group = el().querySelector('[role="group"]');
    expect(group?.firstElementChild?.classList).toContain('projected');
  });
});
