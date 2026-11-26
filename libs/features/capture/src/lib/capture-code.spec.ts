import { CAPTURE_CODE_MAX_LENGTH, captureLookup, readCaptureCode } from './capture-code';

const UID = '6f0c5c84-3c39-4a5e-9d7c-5c1a8e0d3003';

describe('readCaptureCode', () => {
  it('reads a number as typed, without the spaces at either end', () => {
    expect(readCaptureCode('  DC-3003 ')).toEqual({ kind: 'number', number: 'DC-3003' });
  });

  it('drops what a scanner sends round a barcode: tabs, returns, a group separator, zero-width', () => {
    expect(readCaptureCode('\tMV-2003\r\n')).toEqual({ kind: 'number', number: 'MV-2003' });
    expect(readCaptureCode('MV\u001d-2003\u200b')).toEqual({ kind: 'number', number: 'MV-2003' });
  });

  it("reads a record's id alone, in a link to its page, or in a link to this page", () => {
    expect(readCaptureCode(UID.toUpperCase())).toEqual({ kind: 'id', id: UID });
    expect(readCaptureCode(`https://example.test/nuxeo/ui/#/doc/${UID}`)).toEqual({
      kind: 'id',
      id: UID,
    });
    expect(readCaptureCode(`https://example.test/#/capture?record=${UID}`)).toEqual({
      kind: 'id',
      id: UID,
    });
  });

  it('says when there is nothing, or too much to be a number', () => {
    expect(readCaptureCode(' \t ')).toEqual({ kind: 'empty' });
    expect(readCaptureCode('x'.repeat(CAPTURE_CODE_MAX_LENGTH))).toEqual({
      kind: 'number',
      number: 'x'.repeat(CAPTURE_CODE_MAX_LENGTH),
    });
    expect(readCaptureCode('x'.repeat(CAPTURE_CODE_MAX_LENGTH + 1))).toEqual({ kind: 'too-long' });
  });
});

describe('captureLookup', () => {
  const claim = {
    type: 'DamageClaim',
    capture: {
      property: 'files:files',
      findBy: ['dmg:number', 'dmg:moveNumber'],
      keepLocation: false,
    },
  };

  it('looks the number up in each property, as given and in capitals, as values', () => {
    const lookup = captureLookup([claim], 'mv-2003');
    expect(lookup?.query).toBe(
      'SELECT * FROM Document WHERE ((ecm:primaryType = ? AND (dmg:number IN (?, ?) OR dmg:moveNumber IN (?, ?))))' +
        ' AND ecm:isVersion = 0 AND ecm:isProxy = 0 AND ecm:isTrashed = 0 ORDER BY dc:modified DESC',
    );
    expect(lookup?.params).toEqual(['DamageClaim', 'mv-2003', 'MV-2003', 'mv-2003', 'MV-2003']);
  });

  it('asks once for a number already in capitals, and never writes it into the text', () => {
    const lookup = captureLookup([claim], "DC-3003' OR 1=1 --");
    expect(lookup?.query).not.toContain('DC-3003');
    expect(lookup?.query).not.toContain('1=1');
    expect(lookup?.params).toEqual(['DamageClaim', "DC-3003' OR 1=1 --", "DC-3003' OR 1=1 --"]);
  });

  it('asks every type that looks a number up, in one search', () => {
    const lookup = captureLookup(
      [
        claim,
        {
          type: 'Move',
          capture: { property: 'files:files', findBy: ['move:number'], keepLocation: true },
        },
      ],
      'A1',
    );
    expect(lookup?.query).toContain('OR (ecm:primaryType = ? AND (move:number IN (?)))');
    expect(lookup?.params).toEqual(['DamageClaim', 'A1', 'A1', 'Move', 'A1']);
  });

  it('leaves out a type or a property not written as a name, and asks nothing with none left', () => {
    const hostile = {
      type: "Claim' OR 1=1",
      capture: { property: 'files:files', findBy: ['dmg:number'], keepLocation: false },
    };
    const badProperty = {
      type: 'DamageClaim',
      capture: { property: 'files:files', findBy: ['dmg:number = 1 OR x:y'], keepLocation: false },
    };
    const none = {
      type: 'Move',
      capture: { property: 'files:files', findBy: [], keepLocation: false },
    };
    expect(captureLookup([hostile, badProperty, none], 'A1')).toBeNull();
    expect(captureLookup([], 'A1')).toBeNull();
  });
});
