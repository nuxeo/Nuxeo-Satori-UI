import {
  ChangeDetectionStrategy,
  Component,
  provideZonelessChangeDetection,
  signal,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  NxsButtonComponent,
  type NxsButtonAppearance,
  type NxsButtonType,
} from './button.component';

/** Hosted, so the content projected into the button and its `press` are both observable. */
@Component({
  standalone: true,
  imports: [NxsButtonComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `<form (submit)="submitted = submitted + 1; $event.preventDefault()">
    <nxs-button
      [appearance]="appearance()"
      [icon]="icon()"
      [label]="label()"
      [type]="type()"
      [disabled]="disabled()"
      [disabledInteractive]="disabledInteractive()"
      [ariaPressed]="ariaPressed()"
      [describedBy]="describedBy()"
      [controlId]="controlId()"
      (press)="presses = presses + 1"
      >{{ text() }}</nxs-button
    >
    <p id="question">Run it on 3 records?</p>
  </form>`,
})
class HostComponent {
  readonly appearance = signal<NxsButtonAppearance>('text');
  readonly icon = signal('');
  readonly label = signal('');
  readonly type = signal<NxsButtonType>('button');
  readonly disabled = signal(false);
  readonly disabledInteractive = signal(false);
  readonly ariaPressed = signal<boolean | null>(null);
  readonly describedBy = signal<string | null>(null);
  readonly controlId = signal('');
  readonly text = signal('Open');
  presses = 0;
  submitted = 0;
}

describe('NxsButtonComponent', () => {
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

  it('is one native button, named by its text, of type button', async () => {
    const button = await render();
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('button')).toHaveLength(1);
    expect(button.textContent?.trim()).toBe('Open');
    expect(button.getAttribute('aria-label')).toBeNull();
    expect(button.type).toBe('button');
    expect(button.tabIndex).toBe(0);
  });

  it('is of type button, and text, when nothing says otherwise', async () => {
    const bare = TestBed.createComponent(NxsButtonComponent);
    bare.detectChanges();
    await bare.whenStable();
    const button = (bare.nativeElement as HTMLElement).querySelector('button');
    expect(button?.type).toBe('button');
    expect(button?.classList).toContain('mat-mdc-button');
    expect(button?.disabled).toBe(false);
  });

  it('presses on a click, and a button of type button submits nothing', async () => {
    const button = await render();
    button.click();
    expect(host.presses).toBe(1);
    expect(host.submitted).toBe(0);
  });

  it('submits the form it is in when it is of type submit', async () => {
    host.type.set('submit');
    const button = await render();
    button.click();
    expect(button.type).toBe('submit');
    expect(host.presses).toBe(1);
    expect(host.submitted).toBe(1);
  });

  it('is a disabled native button while disabled, and does not press', async () => {
    host.disabled.set(true);
    const button = await render();
    expect(button.disabled).toBe(true);
    button.click();
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(host.presses).toBe(0);
  });

  it('draws Material’s button in each appearance', async () => {
    const classes: Record<NxsButtonAppearance, string> = {
      text: 'mat-mdc-button',
      outlined: 'mat-mdc-outlined-button',
      filled: 'mat-mdc-unelevated-button',
    };
    for (const [appearance, expected] of Object.entries(classes)) {
      host.appearance.set(appearance as NxsButtonAppearance);
      const button = await render();
      expect(button.classList, appearance).toContain(expected);
    }
  });

  it('takes its accessible name from label, where the text alone does not say enough', async () => {
    host.text.set('Show');
    host.label.set('Show member:phone again');
    const button = await render();
    expect(button.getAttribute('aria-label')).toBe('Show member:phone again');
    expect(button.textContent?.trim()).toBe('Show');
  });

  it('keeps the text as the name for a label of only whitespace or zero-width characters', async () => {
    host.label.set(' ​ ');
    expect((await render()).getAttribute('aria-label')).toBeNull();
  });

  it('draws a decorative icon before the text, and none when the icon is blank', async () => {
    let button = await render();
    expect(button.querySelector('nxs-icon')).toBeNull();
    host.icon.set('download');
    button = await render();
    const icon = button.querySelector('nxs-icon mat-icon');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(button.textContent?.trim()).toBe('Open');
  });

  describe('disabled but interactive', () => {
    it('stays in the tab order, says it is unavailable, and does not press', async () => {
      host.disabled.set(true);
      host.disabledInteractive.set(true);
      const button = await render();
      expect(button.disabled).toBe(false);
      expect(button.tabIndex).toBe(0);
      expect(button.getAttribute('aria-disabled')).toBe('true');
      button.focus();
      expect(document.activeElement).toBe(button);
      button.click();
      expect(host.presses).toBe(0);
    });

    it('is an ordinary button while it is not disabled', async () => {
      host.disabledInteractive.set(true);
      const button = await render();
      expect(button.getAttribute('aria-disabled')).toBeNull();
      button.click();
      expect(host.presses).toBe(1);
    });

    it('as a submit button, still submits its form, whose handler decides', async () => {
      host.type.set('submit');
      host.disabled.set(true);
      host.disabledInteractive.set(true);
      const button = await render();
      button.click();
      expect(host.presses).toBe(0);
      expect(host.submitted).toBe(1);
    });
  });

  it('says whether a toggle is pressed, and nothing for a button that is not one', async () => {
    let button = await render();
    expect(button.hasAttribute('aria-pressed')).toBe(false);
    host.ariaPressed.set(true);
    button = await render();
    expect(button.getAttribute('aria-pressed')).toBe('true');
    host.ariaPressed.set(false);
    button = await render();
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });

  it('is described by the element describedBy names, and by nothing otherwise', async () => {
    let button = await render();
    expect(button.hasAttribute('aria-describedby')).toBe(false);
    host.describedBy.set('question');
    button = await render();
    expect(button.getAttribute('aria-describedby')).toBe('question');
  });

  it('gives the native button the id controlId names, so a page can focus it by id', async () => {
    let button = await render();
    expect(button.hasAttribute('id')).toBe(false);
    host.controlId.set('review-add');
    button = await render();
    expect(document.getElementById('review-add')).toBe(button);
    expect((fixture.nativeElement as HTMLElement).querySelector('nxs-button')?.id).toBe('');
  });
});
