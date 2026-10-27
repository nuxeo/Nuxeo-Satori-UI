import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import type { NxsToolbarAction } from '@nuxeo/satori-platform/components';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';

import { NxsSatoriActionBarComponent } from './satori-action-bar.component';

const ACTIONS: readonly NxsToolbarAction[] = [
  { id: 'app.toolbar.edit', label: 'Edit', icon: 'edit' },
  {
    id: 'app.toolbar.unlock',
    label: 'Unlock',
    icon: 'lock',
    tooltip: 'Locked by Jane on 3 May',
    disabled: true,
    active: true,
  },
  { id: 'app.toolbar.lock', label: 'Lock', icon: 'lock_open', active: true },
  { id: 'acme.toolbar.archive', label: 'Archive', tooltip: 'Send to the archive' },
  { id: 'app.toolbar.share', label: 'Share', icon: 'share', overflow: true },
  { id: 'app.toolbar.export', label: 'Export', overflow: true, disabled: true },
];

describe('NxsSatoriActionBarComponent', () => {
  let fixture: ComponentFixture<NxsSatoriActionBarComponent>;
  let ran: string[];

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const button = (id: string): HTMLButtonElement | null =>
    el().querySelector<HTMLButtonElement>(`button[data-action-id="${id}"]`);
  const more = (): HTMLButtonElement | null =>
    el().querySelector<HTMLButtonElement>('.nxs-satori-action-bar__more');
  const menuItem = (id: string): HTMLButtonElement | null =>
    document.querySelector<HTMLButtonElement>(`.mat-mdc-menu-panel [data-action-id="${id}"]`);

  async function render(actions: readonly NxsToolbarAction[] = ACTIONS): Promise<void> {
    fixture.componentRef.setInput('actions', actions);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NxsSatoriActionBarComponent, MatIconTestingModule],
      providers: [provideZonelessChangeDetection(), provideTranslateService()],
    }).compileComponents();
    TestBed.inject(TranslateService).setTranslation('en', {
      'satori-components': {
        'document-toolbar': { label: 'Document actions', 'more-actions': 'More actions' },
      },
    });
    TestBed.inject(TranslateService).use('en');
    fixture = TestBed.createComponent(NxsSatoriActionBarComponent);
    ran = [];
    fixture.componentRef.setInput('actionHandler', (action: NxsToolbarAction) =>
      ran.push(action.id),
    );
    fixture.componentInstance.selected.subscribe((action) => ran.push(`selected:${action.id}`));
    await render();
  });

  it("renders every inline entry as Satori's action-bar button, addressable by ID", () => {
    const inline = [
      ...el().querySelectorAll('.nxs-satori-action-bar__group > button[data-action-id]'),
    ];
    expect(inline.map((b) => b.getAttribute('data-action-id'))).toEqual([
      'app.toolbar.edit',
      'app.toolbar.unlock',
      'app.toolbar.lock',
      'acme.toolbar.archive',
    ]);
    expect(inline.every((b) => b.classList.contains('sat-action-bar-button'))).toBe(true);
  });

  it('names the group, falling back to the library name when the label is blank', async () => {
    const group = () => el().querySelector('[role="group"]');
    expect(group()?.getAttribute('aria-label')).toBe('Document actions');
    fixture.componentRef.setInput('label', 'Contract actions');
    await render();
    expect(group()?.getAttribute('aria-label')).toBe('Contract actions');
  });

  it('runs an entry on click, through both the handler and `selected`', () => {
    button('app.toolbar.edit')?.click();
    expect(ran).toEqual(['selected:app.toolbar.edit', 'app.toolbar.edit']);
  });

  // `sat-action-group` disables natively, which takes the entry out of the tab order.
  it('keeps a disabled entry focusable, so its tooltip can be read, and refuses to run it', () => {
    const unlock = button('app.toolbar.unlock');
    expect(unlock?.disabled).toBe(false);
    expect(unlock?.hasAttribute('disabled')).toBe(false);
    expect(unlock?.getAttribute('aria-disabled')).toBe('true');
    unlock?.focus();
    expect(document.activeElement).toBe(unlock);
    unlock?.click();
    expect(ran).toEqual([]);
  });

  it('names an icon button by its label and what its tooltip adds — who holds the lock', () => {
    expect(button('app.toolbar.unlock')?.getAttribute('aria-label')).toBe(
      'Unlock. Locked by Jane on 3 May',
    );
    expect(button('app.toolbar.edit')?.getAttribute('aria-label')).toBe('Edit');
    expect(button('app.toolbar.edit')?.querySelector('mat-icon')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
  });

  it('shows the label of an entry with no icon, with what its tooltip adds for screen readers', () => {
    const archive = button('acme.toolbar.archive');
    expect(archive?.hasAttribute('aria-label')).toBe(false);
    expect(archive?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Archive . Send to the archive');
    expect(archive?.querySelector('.cdk-visually-hidden')?.textContent?.trim()).toBe(
      '. Send to the archive',
    );
  });

  it('draws an active entry in its "on" colour, but never a disabled one', () => {
    expect(button('app.toolbar.lock')?.classList).toContain(
      'nxs-satori-action-bar__action--active',
    );
    expect(button('app.toolbar.unlock')?.classList).not.toContain(
      'nxs-satori-action-bar__action--active',
    );
  });

  it('keeps an overflow entry in the "More actions" menu whatever the width', () => {
    expect(button('app.toolbar.share')).toBeNull();
    expect(more()?.getAttribute('aria-label')).toBe('More actions');
  });

  it('names the menu button from moreLabel when one is given', async () => {
    fixture.componentRef.setInput('moreLabel', 'More document actions');
    await render();
    expect(more()?.getAttribute('aria-label')).toBe('More document actions');
  });

  it('runs an overflow entry from the menu and leaves a disabled one disabled there', async () => {
    more()?.click();
    await render();
    expect(menuItem('app.toolbar.export')?.disabled).toBe(true);
    menuItem('app.toolbar.share')?.click();
    expect(ran).toEqual(['selected:app.toolbar.share', 'app.toolbar.share']);
  });

  it('renders no menu button when nothing overflows', async () => {
    await render(ACTIONS.filter((action) => !action.overflow));
    expect(more()).toBeNull();
  });
});
