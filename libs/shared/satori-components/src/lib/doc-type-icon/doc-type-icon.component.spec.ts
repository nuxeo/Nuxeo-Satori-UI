import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { docTypeIcon } from '@nuxeo/satori-platform/nuxeo-client';

import { NxsDocTypeIconComponent } from './doc-type-icon.component';

@Component({
  standalone: true,
  imports: [NxsDocTypeIconComponent],
  template: `<nxs-doc-type-icon [type]="type()" [label]="label()" />`,
})
class HostComponent {
  readonly type = signal('Folder');
  readonly label = signal('');
}

describe('NxsDocTypeIconComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  const icon = (): HTMLElement => fixture.nativeElement.querySelector('mat-icon') as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await render();
  });

  it('shows the icon nuxeo-client maps the type to', () => {
    expect(icon().textContent?.trim()).toBe(docTypeIcon('Folder'));
    expect(icon().textContent?.trim()).toBe('folder');
  });

  it.each([
    ['File', 'description'],
    ['Picture', 'image'],
    ['Collection', 'collections_bookmark'],
    ['Domain', 'public'],
  ])('maps %s to %s', async (type, ligature) => {
    host.type.set(type);
    await render();
    expect(icon().textContent?.trim()).toBe(ligature);
  });

  it('falls back to the generic file icon for a type nobody mapped', async () => {
    host.type.set('AcmeClaim');
    await render();
    expect(icon().textContent?.trim()).toBe('insert_drive_file');
  });

  it('is decorative unless labelled', async () => {
    expect(icon().getAttribute('aria-hidden')).toBe('true');
    host.label.set('Folder');
    await render();
    expect(icon().getAttribute('aria-label')).toBe('Folder');
  });
});
