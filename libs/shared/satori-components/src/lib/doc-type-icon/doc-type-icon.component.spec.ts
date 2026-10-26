import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { NxsDocTypeIconComponent } from './doc-type-icon.component';

@Component({
  standalone: true,
  imports: [NxsDocTypeIconComponent],
  template: '<nxs-doc-type-icon [type]="type()" [label]="label()" />',
})
class HostComponent {
  type = signal('Folder');
  label = signal<string | undefined>(undefined);
}

describe('NxsDocTypeIconComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  const icon = () => fixture.nativeElement.querySelector('mat-icon') as HTMLElement;
  const render = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    await render();
  });

  it('shows the icon nuxeo-client maps the type to', () => {
    expect(icon().getAttribute('data-mat-icon-name')).toBe('folder');
  });

  it.each([
    ['File', 'page'],
    ['Picture', 'image'],
    ['Collection', 'bookmark_filled'],
    ['Domain', 'users'],
  ])('maps %s to %s', async (type, expected) => {
    host.type.set(type);
    await render();
    expect(icon().getAttribute('data-mat-icon-name')).toBe(expected);
  });

  it('falls back to the generic file icon for a type nobody mapped', async () => {
    host.type.set('AcmeClaim');
    await render();
    expect(icon().getAttribute('data-mat-icon-name')).toBe('page');
  });

  it('is decorative unless labelled', async () => {
    expect(icon().getAttribute('aria-hidden')).toBe('true');
    host.label.set('Folder');
    await render();
    expect(icon().getAttribute('aria-label')).toBe('Folder');
  });
});
