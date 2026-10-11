import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { NxsAvatarComponent } from './avatar.component';

describe('NxsAvatarComponent', () => {
  let fixture: ComponentFixture<NxsAvatarComponent>;

  async function render(inputs: Record<string, unknown>): Promise<HTMLElement> {
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NxsAvatarComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    fixture = TestBed.createComponent(NxsAvatarComponent);
  });

  it('shows at most two initials, upper-cased and trimmed', async () => {
    const host = await render({ initials: '  nkx ' });
    expect(host.querySelector('.nxs-avatar__initials')?.textContent?.trim()).toBe('NK');
  });

  it('hides the initials themselves from assistive technology', async () => {
    const host = await render({ initials: 'NK', label: 'Narasimha Koppula' });
    expect(host.querySelector('.nxs-avatar__initials')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('is an image named by its label when one is given', async () => {
    const host = await render({ initials: 'NK', label: 'Narasimha Koppula' });
    expect(host.getAttribute('role')).toBe('img');
    expect(host.getAttribute('aria-label')).toBe('Narasimha Koppula');
    expect(host.hasAttribute('aria-hidden')).toBe(false);
  });

  it('is decorative, and hidden, when the label is blank', async () => {
    const host = await render({ initials: 'NK' });
    expect(host.hasAttribute('role')).toBe(false);
    expect(host.hasAttribute('aria-label')).toBe(false);
    expect(host.getAttribute('aria-hidden')).toBe('true');
  });

  it('defaults to blue at 36px', async () => {
    const host = await render({ initials: 'NK' });
    expect(host.classList).toContain('nxs-avatar--blue');
    expect(host.classList).toContain('nxs-avatar--size-36');
  });

  it('follows a changed colour and size', async () => {
    const host = await render({ initials: 'NK', color: 'purple', size: '64' });
    expect(host.classList).toContain('nxs-avatar--purple');
    expect(host.classList).toContain('nxs-avatar--size-64');
    expect(host.classList).not.toContain('nxs-avatar--blue');
  });

  it('renders nothing visible for blank initials rather than throwing', async () => {
    const host = await render({ initials: '   ' });
    expect(host.querySelector('.nxs-avatar__initials')?.textContent).toBe('');
  });

  it('refuses to render without initials', () => {
    expect(() => fixture.detectChanges()).toThrow(/NG0950/);
  });
});
