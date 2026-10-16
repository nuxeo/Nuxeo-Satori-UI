import { TestBed } from '@angular/core/testing';
import { WritableSignal, provideZonelessChangeDetection } from '@angular/core';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { AiFeatureFlagService, readStoredAiPreference } from './ai-feature-flag.service';

const STORAGE_KEY = 'ai-features-enabled';
const MIGRATION_KEY = 'ai-features-default-enabled-v1';

/**
 * AI features are switched off for every user, and these tests exist to prove that no input a
 * user controls can turn them back on. The cases that matter are the negative ones: storage
 * saying `true`, and the setters being called directly.
 *
 * The flag is decided during construction, so every case arranges `localStorage` first and then
 * constructs — injecting the service and rewriting storage afterwards would assert nothing.
 *
 * `localStorage` is real here rather than stubbed, and cleared between tests. On Node 22+ a
 * built-in `localStorage` shadows jsdom's, which is why the gate passes
 * `--no-experimental-webstorage`; a bare `nx test` does not (see CLAUDE.md).
 */
describe('AiFeatureFlagService', () => {
  /** Builds the service after storage has been arranged, since the flag is read on construction. */
  function createService(): AiFeatureFlagService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), AiFeatureFlagService],
    });
    return TestBed.inject(AiFeatureFlagService);
  }

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('reports AI as disabled for a browser that has never seen the flag', () => {
    expect(createService().aiEnabled()).toBe(false);
  });

  describe('cannot be re-enabled by anything a user controls', () => {
    it('ignores a stored opt-in', () => {
      // The hole this closes: while the flag was read from storage, setting this key in devtools
      // turned the entire AI surface back on at the next reload.
      localStorage.setItem(MIGRATION_KEY, 'true');
      localStorage.setItem(STORAGE_KEY, 'true');

      expect(createService().aiEnabled()).toBe(false);
    });

    it('ignores setEnabled(true)', () => {
      const service = createService();

      service.setEnabled(true);

      expect(service.aiEnabled()).toBe(false);
    });

    it('ignores toggle()', () => {
      const service = createService();

      service.toggle();
      service.toggle();

      expect(service.aiEnabled()).toBe(false);
    });

    it('does not expose a writable signal', () => {
      // `aiEnabled` used to be a `WritableSignal`, so anything holding the service — including a
      // console session reaching it through Angular's debug API — was one `.set()` from enabling AI.
      const flag = createService().aiEnabled as { set?: unknown };

      expect(flag.set).toBeUndefined();
    });

    it('ignores a write to the private backing signal', () => {
      // `private` is a compile-time fiction, so `service.state.set(true)` runs fine at a console.
      // While AI is off, `aiEnabled` is not a view onto that field, so writing it changes nothing.
      // The cast is the point of the test: it reproduces exactly what a console session can reach.
      const service = createService();
      const reachable = service as unknown as { state: WritableSignal<boolean> };

      reachable.state.set(true);

      expect(service.aiEnabled()).toBe(false);
    });
  });

  describe('clears an opt-in a browser is already carrying', () => {
    it('removes both stored keys on construction', () => {
      localStorage.setItem(STORAGE_KEY, 'true');
      localStorage.setItem(MIGRATION_KEY, 'true');

      createService();

      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
      // The migration marker goes too, so the one-time "make AI visible again" migration is not
      // considered already spent for these browsers if AI is ever restored.
      expect(localStorage.getItem(MIGRATION_KEY)).toBeNull();
    });

    it('does not write a preference back', () => {
      const service = createService();

      service.setEnabled(true);
      service.toggle();

      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });
  });

  /**
   * The persisted opt-out is read only while AI is enabled, so none of it runs today. It is
   * covered here because it is the half of the re-enable path nothing exercises, and an opt-out
   * that silently stopped being honoured would not be noticed until the feature came back.
   */
  describe('the stored preference, honoured again when AI is re-enabled', () => {
    it('defaults to on for a browser that has never seen the flag, and marks the migration', () => {
      expect(readStoredAiPreference()).toBe(true);
      expect(localStorage.getItem(MIGRATION_KEY)).toBe('true');
      expect(localStorage.getItem(STORAGE_KEY)).toBe('true');
    });

    it('overrides a pre-migration opt-out, which is the point of the migration', () => {
      localStorage.setItem(STORAGE_KEY, 'false');

      expect(readStoredAiPreference()).toBe(true);
    });

    it('honours an opt-out made after the migration', () => {
      // The discriminating half: once the marker is set, the user's choice is authoritative.
      localStorage.setItem(MIGRATION_KEY, 'true');
      localStorage.setItem(STORAGE_KEY, 'false');

      expect(readStoredAiPreference()).toBe(false);
    });

    it('treats any value other than "true" as off', () => {
      localStorage.setItem(MIGRATION_KEY, 'true');
      localStorage.setItem(STORAGE_KEY, 'yes');

      expect(readStoredAiPreference()).toBe(false);
    });
  });

  describe('when localStorage is unavailable', () => {
    it('constructs and still reports disabled rather than throwing', () => {
      // Safari in private mode, and any embedding that blocks storage: storage access throws. The
      // service must still construct, because it is injected at app start.
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new DOMException('denied', 'SecurityError');
      });

      expect(createService().aiEnabled()).toBe(false);
    });
  });
});
