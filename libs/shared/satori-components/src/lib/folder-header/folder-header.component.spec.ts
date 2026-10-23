import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import type { NxsHeadingLevel } from '../heading-level';
import { NxsFolderHeaderComponent } from './folder-header.component';

@Component({
  standalone: true,
  imports: [NxsFolderHeaderComponent],
  template: `
    <nxs-folder-header
      [heading]="heading()"
      [headingLevel]="headingLevel()"
      [subheading]="subheading()"
      [documentType]="documentType()"
    >
      @if (withDetail()) {
        <nav nxsFolderHeaderDetail class="probe-detail">Root › Claims</nav>
      }
      <button type="button" class="probe-action">Edit</button>
    </nxs-folder-header>
  `,
})
class HostComponent {
  readonly heading = signal('Claims');
  readonly headingLevel = signal<NxsHeadingLevel>(1);
  readonly subheading = signal('Folder');
  readonly documentType = signal('Folder');
  readonly withDetail = signal(false);
}

describe('NxsFolderHeaderComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  const query = (selector: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(selector) as HTMLElement | null;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await render();
  });

  it('makes the title the page’s level-one heading, as a native <h1>', () => {
    const heading = query('.nxs-folder-header__heading');
    expect(heading?.tagName).toBe('H1');
    expect(heading?.textContent?.trim()).toBe('Claims');
  });

  it.each([2, 3, 4, 5, 6] as const)(
    'renders the title as <h%i> when given that heading level',
    async (level) => {
      host.headingLevel.set(level);
      await render();
      expect(query('.nxs-folder-header__heading')?.tagName).toBe(`H${level}`);
      expect(query('h1, h2, h3, h4, h5, h6')?.textContent?.trim()).toBe('Claims');
    },
  );

  it('renders no heading while the title is blank, rather than an empty one', async () => {
    host.heading.set('');
    await render();
    expect(query('h1, h2, h3, h4, h5, h6')).toBeNull();
  });

  it('shows the second line when given one', () => {
    expect(query('.nxs-folder-header__subheading')?.textContent?.trim()).toBe('Folder');
  });

  it('renders no second line when it is blank', async () => {
    host.subheading.set('');
    await render();
    expect(query('.nxs-folder-header__subheading')).toBeNull();
  });

  it('shows the type’s icon, decorative beside the title', () => {
    const icon = query('nxs-doc-type-icon mat-icon');
    expect(icon?.textContent?.trim()).toBe('folder');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders no icon without a type', async () => {
    host.documentType.set('');
    await render();
    expect(query('nxs-doc-type-icon')).toBeNull();
  });

  it('projects the host’s actions into the actions area', () => {
    expect(query('.nxs-folder-header__actions .probe-action')?.textContent?.trim()).toBe('Edit');
  });

  it('projects a detail line under the title, not among the actions', async () => {
    host.withDetail.set(true);
    await render();
    expect(query('.nxs-folder-header__text .probe-detail')).not.toBeNull();
    expect(query('.nxs-folder-header__actions .probe-detail')).toBeNull();
  });
});
