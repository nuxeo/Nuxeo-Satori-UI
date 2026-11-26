import {
  ChangeDetectionStrategy,
  Component,
  provideZonelessChangeDetection,
  signal,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import type { NxsButtonType } from '../button/button.component';
import { NxsIconButtonComponent } from './icon-button.component';

@Component({
  standalone: true,
  imports: [NxsIconButtonComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `<form (submit)="submitted = submitted + 1; $event.preventDefault()">
    <nxs-icon-button
      [icon]="icon()"
      [label]="label()"
      [type]="type()"
      [disabled]="disabled()"
      (press)="presses = presses + 1"
    />
  </form>`,
})
class HostComponent {
  readonly icon = signal('arrow_up');
  readonly label = signal('Move member:phone up');
  readonly type = signal<NxsButtonType>('button');
  readonly disabled = signal(false);
  presses = 0;
  submitted = 0;
}

describe('NxsIconButtonComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  async function render(): Promise<HTMLButtonElement> {
    fixture.detectChanges();
    await fixture.whenStable();
    const button = (fixture.nativeElement as HTMLElement).querySelector('button');
    if (!button) throw new Error('no button rendered');
    return button;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  it('is one native button, named by its label, of type button, drawn as Material’s icon button', async () => {
    const button = await render();
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('button')).toHaveLength(1);
    expect(button.getAttribute('aria-label')).toBe('Move member:phone up');
    expect(button.type).toBe('button');
    expect(button.tabIndex).toBe(0);
    expect(button.classList).toContain('mat-mdc-icon-button');
  });

  it('draws its icon, decorative, so the label is the only name read', async () => {
    const icon = (await render()).querySelector('nxs-icon mat-icon');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(icon?.getAttribute('aria-label')).toBeNull();
    host.icon.set('trash');
    expect(
      (await render()).querySelector('nxs-icon mat-icon')?.getAttribute('data-mat-icon-name'),
    ).toBe('trash');
  });

  it('is of type button when nothing says otherwise', async () => {
    const bare = TestBed.createComponent(NxsIconButtonComponent);
    bare.componentRef.setInput('icon', 'trash');
    bare.componentRef.setInput('label', 'Remove the sort on dc:title');
    bare.detectChanges();
    await bare.whenStable();
    const button = (bare.nativeElement as HTMLElement).querySelector('button');
    expect(button?.type).toBe('button');
    expect(button?.disabled).toBe(false);
  });

  it('presses on a click, and submits nothing', async () => {
    (await render()).click();
    expect(host.presses).toBe(1);
    expect(host.submitted).toBe(0);
  });

  it('submits the form it is in when it is of type submit', async () => {
    host.type.set('submit');
    (await render()).click();
    expect(host.submitted).toBe(1);
  });

  it('is a disabled native button while disabled, and does not press', async () => {
    host.disabled.set(true);
    const button = await render();
    expect(button.disabled).toBe(true);
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(host.presses).toBe(0);
  });

  it('has no name at all rather than an empty one for a blank label', async () => {
    host.label.set(' ​ ');
    expect((await render()).hasAttribute('aria-label')).toBe(false);
  });
});
