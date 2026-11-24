import { TestBed } from '@angular/core/testing';

import type { NuxeoDocument } from '../models/document.model';
import { ClipboardTargetService } from './clipboard-target.service';

const folder = (uid: string): NuxeoDocument =>
  ({ uid, title: uid, type: 'Folder', path: `/default-domain/${uid}` }) as NuxeoDocument;

/**
 * Browse records the folder being browsed here, and the clipboard's Copy and Move paste into it
 * from the navigation drawer. The two never see each other, so the hand-over is the behaviour.
 */
describe('ClipboardTargetService', () => {
  it('has no paste target until a folder is browsed', () => {
    expect(TestBed.inject(ClipboardTargetService).target()).toBeNull();
  });

  it('hands the folder browse sets to the clipboard, which injects it separately', () => {
    TestBed.inject(ClipboardTargetService).setTarget(folder('projects'));

    expect(TestBed.inject(ClipboardTargetService).target()?.uid).toBe('projects');
  });

  it('follows browse to the next folder rather than keeping the first', () => {
    const service = TestBed.inject(ClipboardTargetService);

    service.setTarget(folder('projects'));
    service.setTarget(folder('archive'));

    expect(service.target()?.uid).toBe('archive');
  });

  it('forgets the target on clear, as on sign-out, so nothing pastes into the last user’s folder', () => {
    const service = TestBed.inject(ClipboardTargetService);
    service.setTarget(folder('projects'));

    service.clear();

    expect(service.target()).toBeNull();
  });
});
