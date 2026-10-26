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

  // A translation that resolves to whitespace must not leave an image with no usable name.
  it.each(['   ', '\t\n', '\u00a0', '\u3000', '\u200b', '\u200b \u2060', '\ufeff\u200d'])(
    'is decorative, and hidden, when the label is only whitespace or zero-width characters (%j)',
    async (label) => {
      const host = await render({ initials: 'NK', label });
      expect(host.hasAttribute('role')).toBe(false);
      expect(host.hasAttribute('aria-label')).toBe(false);
      expect(host.getAttribute('aria-hidden')).toBe('true');
    },
  );

  it.each(['Zoë Ångström', '李雷', 'نرسيمها كوبولا'])(
    'is an image named %j, without the whitespace around it',
    async (name) => {
      const host = await render({ initials: 'NK', label: ` ${name}\u00a0` });
      expect(host.getAttribute('role')).toBe('img');
      expect(host.getAttribute('aria-label')).toBe(name);
      expect(host.hasAttribute('aria-hidden')).toBe(false);
    },
  );

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

  // Satori's avatar shows one initial at 18 and 24 px, where two do not fit.
  it.each(['18', '24'] as const)('shows one initial at size %s, as Satori does', async (size) => {
    const host = await render({ initials: 'nk', size });
    expect(host.querySelector('.nxs-avatar__initials')?.textContent?.trim()).toBe('N');
  });

  it.each(['28', '36'] as const)('shows two initials at size %s', async (size) => {
    const host = await render({ initials: 'nk', size });
    expect(host.querySelector('.nxs-avatar__initials')?.textContent?.trim()).toBe('NK');
  });

  it('skips zero-width characters before the initials', async () => {
    const host = await render({ initials: '\u200bnk' });
    expect(host.querySelector('.nxs-avatar__initials')?.textContent?.trim()).toBe('NK');
  });

  it('renders nothing visible for blank initials rather than throwing', async () => {
    const host = await render({ initials: '   ' });
    expect(host.querySelector('.nxs-avatar__initials')?.textContent).toBe('');
  });

  it('refuses to render without initials', () => {
    expect(() => fixture.detectChanges()).toThrow(/NG0950/);
  });
});
