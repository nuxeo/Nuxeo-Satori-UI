import {
  Component,
  provideZonelessChangeDetection,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatTooltip } from '@angular/material/tooltip';
import { By } from '@angular/platform-browser';

import { NxsActionMenuComponent, type NxsMenuAction } from './action-menu.component';

const ACTIONS: readonly NxsMenuAction[] = [
  { id: 'app.contextMenu.share', label: 'Share', icon: 'share' },
  { id: 'app.contextMenu.subscribe', label: 'Subscribe', disabled: true },
  { id: 'app.contextMenu.export', label: 'Export', icon: 'download' },
];

@Component({
  standalone: true,
  imports: [NxsActionMenuComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <nxs-action-menu
      [actions]="actions()"
      [label]="label()"
      [icon]="icon()"
      (selected)="chosen.push($event.id)"
    />
  `,
})
class HostComponent {
  readonly actions = signal<readonly NxsMenuAction[]>(ACTIONS);
  readonly label = signal('Folder actions');
  readonly icon = signal('more_vert');
  readonly chosen: string[] = [];
}

describe('NxsActionMenuComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const trigger = (): HTMLButtonElement | null => el().querySelector('.nxs-action-menu__trigger');
  const items = (): HTMLButtonElement[] => [
    ...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
  ];
  const item = (id: string): HTMLButtonElement => {
    const match = items().find((node) => node.dataset['actionId'] === id);
    if (!match) throw new Error(`no menu item for ${id}`);
    return match;
  };

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  async function open(): Promise<void> {
    trigger()?.click();
    await render();
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

  const tooltip = (): string =>
    fixture.debugElement.query(By.directive(MatTooltip)).injector.get(MatTooltip).message;

  it('names its trigger, which is the only way to tell what an icon button does', () => {
    expect(trigger()?.getAttribute('aria-label')).toBe('Folder actions');
    expect(tooltip()).toBe('Folder actions');
    expect(trigger()?.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger()?.textContent?.trim()).toBe('more_vert');
  });

  it.each([' \n\t ', '\u200b', '\u2060\ufeff'])(
    'names a trigger whose label is only whitespace or zero-width characters (%j) "More actions"',
    async (label) => {
      host.label.set(label);
      await render();

      expect(trigger()).not.toBeNull();
      expect(trigger()?.getAttribute('aria-label')).toBe('More actions');
      expect(tooltip()).toBe('More actions');
    },
  );

  it('uses the icon it is given', async () => {
    host.icon.set('settings');
    await render();

    expect(trigger()?.textContent?.trim()).toBe('settings');
  });

  it('lists every entry in order, by label and action ID', async () => {
    await open();

    expect(items().map((node) => node.dataset['actionId'])).toEqual([
      'app.contextMenu.share',
      'app.contextMenu.subscribe',
      'app.contextMenu.export',
    ]);
    expect(items().map((node) => node.textContent?.trim())).toEqual([
      'shareShare',
      'Subscribe',
      'downloadExport',
    ]);
    expect(
      item('app.contextMenu.share').querySelector('mat-icon')?.getAttribute('aria-hidden'),
    ).toBe('true');
    expect(item('app.contextMenu.subscribe').querySelector('mat-icon')).toBeNull();
  });

  it('emits the entry chosen', async () => {
    await open();
    item('app.contextMenu.export').click();

    expect(host.chosen).toEqual(['app.contextMenu.export']);
  });

  it('shows a disabled entry but never emits it', async () => {
    await open();
    const subscribe = item('app.contextMenu.subscribe');

    expect(subscribe.disabled).toBe(true);
    subscribe.click();
    expect(host.chosen).toEqual([]);
  });

  it('renders nothing when there is no action to offer', async () => {
    host.actions.set([]);
    await render();

    expect(trigger()).toBeNull();
    expect(el().querySelector('nxs-action-menu')?.children).toHaveLength(0);
  });
});
