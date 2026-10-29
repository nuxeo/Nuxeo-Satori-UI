import {
  Component,
  provideZonelessChangeDetection,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { NxsDomainHintComponent } from './domain-hint.component';

@Component({
  standalone: true,
  imports: [NxsDomainHintComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `<nxs-domain-hint [documentType]="type()" [path]="path()" />`,
})
class HostComponent {
  readonly type = signal<string | null>('Workspace');
  readonly path = signal<string | null>('/default-domain/workspaces/acme');
}

describe('NxsDomainHintComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  const note = (): HTMLElement | null =>
    fixture.nativeElement.querySelector('[role="note"]') as HTMLElement | null;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await render();
  });

  it('shows nothing inside an ordinary container', () => {
    expect(note()).toBeNull();
  });

  it('shows the guidance as a note inside a Domain', async () => {
    host.type.set('Domain');
    host.path.set('/default-domain');
    await render();
    expect(note()?.textContent?.trim()).toBe(
      'Open Sections, Templates, or Workspaces, then create content inside those folders.',
    );
  });

  it('shows the guidance at the repository root, whatever the type', async () => {
    host.type.set('Root');
    host.path.set('/');
    await render();
    expect(note()).not.toBeNull();
  });

  it('shows nothing while nothing is known yet', async () => {
    host.type.set(null);
    host.path.set(null);
    await render();
    expect(note()).toBeNull();
  });

  /**
   * The host carries the note's vertical spacing, so an empty host must collapse. Browse mounts
   * this component unconditionally; left visible with margins it reserved 24px of space in every
   * ordinary workspace and folder.
   *
   * Asserts the **class**, not the computed `display`: this harness does not apply the component's
   * `styleUrl`, so the host measures as an unstyled `inline` element here and even
   * `:host { display: block }` is absent. The `display: none` that the class triggers lives in
   * `domain-hint.component.scss`.
   */
  it('collapses its host when there is no note to show', async () => {
    const hostEl = (): HTMLElement =>
      fixture.nativeElement.querySelector('nxs-domain-hint') as HTMLElement;

    host.type.set('Workspace');
    host.path.set('/default-domain/workspaces/one');
    await render();
    expect(note()).toBeNull();
    expect(hostEl().classList).toContain('nxs-domain-hint--empty');

    host.type.set('Domain');
    await render();
    expect(note()).not.toBeNull();
    expect(hostEl().classList).not.toContain('nxs-domain-hint--empty');
  });

  it('withdraws the note on leaving the domain', async () => {
    host.type.set('Domain');
    await render();
    expect(note()).not.toBeNull();
    host.type.set('Workspace');
    await render();
    expect(note()).toBeNull();
  });
});
