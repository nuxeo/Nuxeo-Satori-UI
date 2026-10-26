import {
  Component,
  provideZonelessChangeDetection,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { NxsIconComponent } from './icon.component';

@Component({
  standalone: true,
  imports: [NxsIconComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `<nxs-icon [name]="name()" [label]="label()" />`,
})
class HostComponent {
  readonly name = signal('folder');
  readonly label = signal('');
}

describe('NxsIconComponent', () => {
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

  it('renders the ligature as a Material icon', () => {
    expect(icon().textContent?.trim()).toBe('folder');
  });

  it('is decorative by default — hidden, with no role or name', () => {
    expect(icon().getAttribute('aria-hidden')).toBe('true');
    expect(icon().hasAttribute('role')).toBe(false);
    expect(icon().hasAttribute('aria-label')).toBe(false);
  });

  it('is an image named by its label when given one', async () => {
    host.label.set('Shared folder');
    await render();
    expect(icon().getAttribute('role')).toBe('img');
    expect(icon().getAttribute('aria-label')).toBe('Shared folder');
    expect(icon().hasAttribute('aria-hidden')).toBe(false);
  });

  it.each(['   ', '\u200b\u2060'])(
    'stays decorative for a label of only whitespace or zero-width characters (%j)',
    async (label) => {
      host.label.set(label);
      await render();
      expect(icon().getAttribute('aria-hidden')).toBe('true');
      expect(icon().hasAttribute('role')).toBe(false);
      expect(icon().hasAttribute('aria-label')).toBe(false);
    },
  );

  it('names the image by the label without its surrounding whitespace', async () => {
    host.label.set('  Shared folder ');
    await render();
    expect(icon().getAttribute('aria-label')).toBe('Shared folder');
  });

  it('becomes decorative again when the label is cleared', async () => {
    host.label.set('Shared folder');
    await render();
    host.label.set('');
    await render();
    expect(icon().getAttribute('aria-hidden')).toBe('true');
    expect(icon().hasAttribute('aria-label')).toBe(false);
  });

  it('follows a changed name', async () => {
    host.name.set('description');
    await render();
    expect(icon().textContent?.trim()).toBe('description');
  });
});
