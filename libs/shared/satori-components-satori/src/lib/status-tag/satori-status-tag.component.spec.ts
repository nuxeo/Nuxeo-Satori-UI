import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideSatori } from '@hylandsoftware/satori-ui/providers';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { provideTranslateService } from '@ngx-translate/core';

import { NxsSatoriStatusTagComponent } from './satori-status-tag.component';

describe('NxsSatoriStatusTagComponent', () => {
  let fixture: ComponentFixture<NxsSatoriStatusTagComponent>;

  /** The Satori status tag inside the wrapper: its inputs are bindings, not attributes. */
  function satoriTag(): SatStatusTag {
    return fixture.debugElement.query(By.directive(SatStatusTag)).componentInstance as SatStatusTag;
  }

  function render(inputs: Record<string, unknown>): void {
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NxsSatoriStatusTagComponent],
      providers: [provideZonelessChangeDetection(), provideSatori(), provideTranslateService()],
    }).compileComponents();
    fixture = TestBed.createComponent(NxsSatoriStatusTagComponent);
  });

  it('renders its label as the text of sat-status-tag', async () => {
    render({ label: 'Overdue', status: 'important-loud' });
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('sat-status-tag')?.textContent?.trim()).toBe('Overdue');
  });

  it('passes the status through to sat-status-tag', () => {
    render({ label: 'Overdue', status: 'important-loud' });
    expect(satoriTag().status()).toBe('important-loud');
  });

  it('defaults to neutral, with the icon shown', () => {
    render({ label: 'Draft' });
    expect(satoriTag().status()).toBe('neutral');
    expect(satoriTag().hideIcon()).toBe(false);
  });

  it('passes hideIcon through to sat-status-tag', () => {
    render({ label: 'Draft', status: 'info', hideIcon: true });
    expect(satoriTag().hideIcon()).toBe(true);
  });

  it('follows a changed status, not the first one', () => {
    render({ label: 'Draft', status: 'info' });
    render({ status: 'success' });
    expect(satoriTag().status()).toBe('success');
  });
});
