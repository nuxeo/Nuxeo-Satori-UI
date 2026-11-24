import { DEFAULT_APP_BOOTSTRAP_CONFIG } from './bootstrap-config';
import { RTL_LANGUAGES, textDirectionForLanguage } from './text-direction';

describe('textDirectionForLanguage', () => {
  /**
   * Direction belongs to the script, independently of whether a catalogue is advertised.
   * Enabling Arabic and Hebrew must preserve this mapping rather than forcing them to LTR.
   */
  it('answers rtl for Arabic and Hebrew', () => {
    expect(textDirectionForLanguage('ar')).toBe('rtl');
    expect(textDirectionForLanguage('he')).toBe('rtl');
  });

  it('answers the expected direction for every advertised language', () => {
    // Product expectations, independent of RTL_LANGUAGES: reading the implementation's own
    // set here would pass if the set and the mapping were wrong together.
    const expectedDirections: Readonly<Record<string, 'ltr' | 'rtl'>> = {
      ar: 'rtl',
      de: 'ltr',
      en: 'ltr',
      es: 'ltr',
      fr: 'ltr',
      he: 'rtl',
      it: 'ltr',
      ja: 'ltr',
      nl: 'ltr',
      sv: 'ltr',
    };
    const advertised = DEFAULT_APP_BOOTSTRAP_CONFIG.availableLanguages;
    expect(advertised.length).toBeGreaterThan(0);
    for (const language of advertised) {
      expect(expectedDirections).toHaveProperty(language);
      expect(textDirectionForLanguage(language)).toBe(expectedDirections[language]);
    }
  });

  /**
   * The point of the named set: a customer can configure a right-to-left language this build has
   * never heard of. Direction is a property of the script, not of whether we translated into it.
   */
  it('answers rtl for a right-to-left language the application does not target', () => {
    expect(textDirectionForLanguage('fa')).toBe('rtl');
    expect(textDirectionForLanguage('ur')).toBe('rtl');
    expect(textDirectionForLanguage('yi')).toBe('rtl');
  });

  it('decides on the primary subtag, so a region or a case variant still mirrors', () => {
    expect(textDirectionForLanguage('ar-EG')).toBe('rtl');
    expect(textDirectionForLanguage('he_IL')).toBe('rtl');
    expect(textDirectionForLanguage('AR')).toBe('rtl');
    expect(textDirectionForLanguage('fr-CA')).toBe('ltr');
  });

  it('does not match a language that merely starts with a right-to-left code', () => {
    // `arn` is Mapudungun and `urd` is not a two-letter code at all; a `startsWith` test would
    // have mirrored both.
    expect(textDirectionForLanguage('arn')).toBe('ltr');
    expect(textDirectionForLanguage('urh')).toBe('ltr');
  });

  it('falls back to ltr for an unknown, empty or absent language', () => {
    expect(textDirectionForLanguage('xx')).toBe('ltr');
    expect(textDirectionForLanguage('')).toBe('ltr');
    expect(textDirectionForLanguage(null)).toBe('ltr');
    expect(textDirectionForLanguage(undefined)).toBe('ltr');
  });

  it('keeps Hebrew under both its current and its superseded code', () => {
    expect(RTL_LANGUAGES).toContain('he');
    expect(textDirectionForLanguage('iw')).toBe('rtl');
  });
});
