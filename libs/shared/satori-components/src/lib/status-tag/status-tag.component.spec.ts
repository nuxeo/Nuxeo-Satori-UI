import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { NxsStatusTagComponent } from './status-tag.component';

describe('NxsStatusTagComponent', () => {
  let fixture: ComponentFixture<NxsStatusTagComponent>;

  async function render(inputs: Record<string, unknown>): Promise<HTMLElement> {
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NxsStatusTagComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    fixture = TestBed.createComponent(NxsStatusTagComponent);
  });

  it('renders its label', async () => {
    const host = await render({ label: 'Draft' });
    expect(host.querySelector('.nxs-status-tag__label')?.textContent?.trim()).toBe('Draft');
  });

  it('defaults to neutral', async () => {
    const host = await render({ label: 'Draft' });
    expect(host.classList).toContain('nxs-status-tag--neutral');
  });

  it('follows a changed status, dropping the previous one', async () => {
    await render({ label: 'Draft', status: 'info' });
    const host = await render({ status: 'important-loud' });
    expect(host.classList).toContain('nxs-status-tag--important-loud');
    expect(host.classList).not.toContain('nxs-status-tag--info');
  });

  it('shows the status icon by default', async () => {
    const host = await render({ label: 'Overdue', status: 'important-loud' });
    expect(host.querySelector('.nxs-status-tag__icon')?.textContent?.trim()).toBe('error');
  });

  it('hides the icon when hideIcon is set', async () => {
    const host = await render({ label: 'Overdue', status: 'important-loud', hideIcon: true });
    expect(host.querySelector('.nxs-status-tag__icon')).toBeNull();
  });

  it('shows no icon for a status that has none', async () => {
    const host = await render({ label: 'Draft', status: 'neutral' });
    expect(host.querySelector('.nxs-status-tag__icon')).toBeNull();
  });

  it('refuses to render without a label', () => {
    expect(() => fixture.detectChanges()).toThrow(/NG0950/);
  });
});
