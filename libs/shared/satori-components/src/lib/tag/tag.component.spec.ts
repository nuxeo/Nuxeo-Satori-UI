import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { NxsTagComponent } from './tag.component';

describe('NxsTagComponent', () => {
  let fixture: ComponentFixture<NxsTagComponent>;

  async function render(inputs: Record<string, unknown>): Promise<HTMLElement> {
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NxsTagComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    fixture = TestBed.createComponent(NxsTagComponent);
  });

  it('renders its label', async () => {
    const host = await render({ label: 'File' });
    expect(host.querySelector('.nxs-tag__label')?.textContent?.trim()).toBe('File');
  });

  it('defaults to gray', async () => {
    const host = await render({ label: 'File' });
    expect(host.classList).toContain('nxs-tag--gray');
  });

  it('follows a changed colour, dropping the previous one', async () => {
    await render({ label: 'File', color: 'teal' });
    const host = await render({ color: 'red' });
    expect(host.classList).toContain('nxs-tag--red');
    expect(host.classList).not.toContain('nxs-tag--teal');
  });

  it('refuses to render without a label', () => {
    expect(() => fixture.detectChanges()).toThrow(/NG0950/);
  });
});
