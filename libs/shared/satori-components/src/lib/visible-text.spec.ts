import { nxsInitials, nxsVisibleText } from './visible-text';

describe('nxsVisibleText', () => {
  it.each([
    ['empty', '', ''],
    ['null', null, ''],
    ['undefined', undefined, ''],
    ['spaces', '   ', ''],
    ['tabs and newlines', '\t\n ', ''],
    ['a no-break space', '\u00a0', ''],
    ['an ideographic space', '\u3000', ''],
    ['a zero-width space', '\u200b', ''],
    ['a zero-width joiner and non-joiner', '\u200d\u200c', ''],
    ['a word joiner', '\u2060', ''],
    ['a byte-order mark', '\ufeff', ''],
    ['directional marks', '\u200e\u200f\u202a\u202c', ''],
    ['a soft hyphen', '\u00ad', ''],
    ['a Hangul filler', '\u3164', ''],
    ['a variation selector alone', '\ufe0f', ''],
    ['zero-width characters mixed with spaces', ' \u200b \u2060 ', ''],
  ])('is empty for %s', (_case, input, expected) => {
    expect(nxsVisibleText(input)).toBe(expected);
  });

  it.each([
    ['plain text', 'Narasimha Koppula', 'Narasimha Koppula'],
    ['surrounding spaces', '  Claims  ', 'Claims'],
    ['surrounding zero-width spaces', '\u200bClaims\u200b', 'Claims'],
    ['a leading byte-order mark', '\ufeffClaims', 'Claims'],
    ['interior spaces', 'More  actions', 'More  actions'],
  ])('keeps the visible part of %s', (_case, input, expected) => {
    expect(nxsVisibleText(input)).toBe(expected);
  });

  it('keeps a joiner inside the text, where it changes what the text says', () => {
    const family = '\u{1F468}\u200d\u{1F469}\u200d\u{1F467}';
    expect(nxsVisibleText(` ${family} `)).toBe(family);
    expect(nxsVisibleText('\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645')).toBe(
      '\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645',
    );
  });

  it('keeps the variation selector that draws an emoji', () => {
    expect(nxsVisibleText('Love \u2764\ufe0f')).toBe('Love \u2764\ufe0f');
  });
});

describe('nxsInitials', () => {
  it.each([
    ['two letters, upper-cased', 'nk', 2, 'NK'],
    ['one letter of two', 'NK', 1, 'N'],
    ['spaces between letters', 'N K', 2, 'NK'],
    ['zero-width characters before the letters', '\u200b\u200bnk', 2, 'NK'],
    ['blank', ' \u200b ', 2, ''],
    ['a count below one', 'NK', 0, ''],
  ])('%s', (_case, input, count, expected) => {
    expect(nxsInitials(input, count)).toBe(expected);
  });

  it('counts an accented letter written with a combining mark as one initial', () => {
    expect(nxsInitials('E\u0301mile', 1)).toBe('E\u0301');
  });

  it('never cuts an emoji in half', () => {
    expect(nxsInitials('\u{1F600}x', 1)).toBe('\u{1F600}');
  });
});
