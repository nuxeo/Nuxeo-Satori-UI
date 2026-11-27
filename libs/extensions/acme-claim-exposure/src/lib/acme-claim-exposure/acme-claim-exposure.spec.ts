import { TestBed } from '@angular/core/testing';
import { ExtensionComponentRegistry } from '@nuxeo/satori-platform/extensions';
import type { NuxeoDocument } from '@nuxeo/satori-platform/nuxeo-client';

import { ACME_CLAIM_EXPOSURE_PLUGIN_IDS, provideAcmeClaimExposurePlugin } from '../extensions';
import {
  AcmeClaimExposureComponent,
  isHigh,
  outstanding,
  reserveRatio,
} from './acme-claim-exposure';

/** A claim as Nuxeo's REST API returns one, every property of its schema present, null when unset. */
function claim(number: string, amount: number | null, reserve: number | null): NuxeoDocument {
  return {
    uid: `claim-${number.toLowerCase()}`,
    title: number,
    type: 'Claim',
    path: `/claims/${number}`,
    lastModified: '2026-11-20T09:00:00.000Z',
    state: 'open',
    properties: {
      'dc:title': number,
      'cl:number': number,
      'cl:amount': amount,
      'cl:reserve': reserve,
    },
  };
}

/** The records of the element's observed behaviour, and what the element shows on each. */
const OBSERVED: readonly (readonly [NuxeoDocument, string])[] = [
  [
    claim('CL-1001', 12000, 3000),
    'Claim number CL-1001 Outstanding 9000.00 Reserve ratio 25% High exposure',
  ],
  [claim('CL-1002', 2500.5, 500), 'Claim number CL-1002 Outstanding 2000.50 Reserve ratio 20%'],
  [claim('CL-1003', 0, null), 'Claim number CL-1003 Outstanding 0.00 Reserve ratio –'],
  [claim('CL-1004', null, null), 'Claim number CL-1004 Outstanding Reserve ratio –'],
];

/**
 * What the plugin shows, as check 9 reads it: each piece of text, its spacing collapsed, one space
 * between pieces, so a label and its value read apart however the template is laid out.
 */
function shown(document: NuxeoDocument | null, threshold?: number): string {
  const fixture = TestBed.createComponent(AcmeClaimExposureComponent);
  fixture.componentRef.setInput('document', document);
  if (threshold !== undefined) fixture.componentRef.setInput('threshold', threshold);
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  const walker = host.ownerDocument.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  const pieces: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text) pieces.push(text);
  }
  return pieces.join(' ');
}

/** What the plugin shows on each observed record, beside what the element shows there. */
const onEachRecord = (): [string, string][] =>
  OBSERVED.map(([document, element]) => [shown(document), element]);

/**
 * The plugin held to what the custom element `acme-claim-exposure` does, as the inventory read it
 * from the package, on the records of its observed behaviour. Each test is named after the
 * behaviour the plugin command's skeleton named, as check 9 asks.
 */
describe('acme-claim-exposure, as a plugin', () => {
  beforeEach(() =>
    TestBed.configureTestingModule({ providers: [provideAcmeClaimExposurePlugin()] }),
  );

  it('is registered under its component ID, and resolves', async () => {
    const registry = TestBed.inject(ExtensionComponentRegistry);
    expect(await registry.resolve(ACME_CLAIM_EXPOSURE_PLUGIN_IDS.components[0])).toBe(
      AcmeClaimExposureComponent,
    );
  });

  // What it shows: the text bindings of its template.
  it("shows [[i18n('label.claim.number')]] as the element does, on each record", () => {
    for (const [plugin] of onEachRecord()) expect(plugin).toMatch(/^Claim number /);
  });

  it('shows [[document.properties.cl:number]] as the element does, on each record', () => {
    expect(onEachRecord().map(([plugin]) => plugin.split(' Outstanding')[0])).toEqual([
      'Claim number CL-1001',
      'Claim number CL-1002',
      'Claim number CL-1003',
      'Claim number CL-1004',
    ]);
    // Polymer shows null as nothing.
    const unnumbered = { ...claim('CL-1009', 1, 0), properties: { 'cl:number': null } };
    expect(shown(unnumbered)).toMatch(/^Claim number Outstanding/);
  });

  it("shows [[i18n('label.claim.outstanding')]] as the element does, on each record", () => {
    for (const [plugin] of onEachRecord()) expect(plugin).toContain(' Outstanding ');
  });

  it('shows [[_outstanding(document.properties.cl:amount, document.properties.cl:reserve)]] as the element does, on each record', () => {
    expect(outstanding(12000, 3000)).toBe('9000.00');
    expect(outstanding(2500.5, 500)).toBe('2000.50');
    // `reserve || 0`: no reserve is none.
    expect(outstanding(0, null)).toBe('0.00');
    expect(outstanding(100, undefined)).toBe('100.00');
    // No amount, nothing.
    expect(outstanding(null, null)).toBe('');
    expect(outstanding('12000', 0)).toBe('');
    expect(
      onEachRecord().map(([plugin]) => /Outstanding (.*?) ?Reserve ratio/.exec(plugin)?.[1]),
    ).toEqual(['9000.00', '2000.50', '0.00', '']);
  });

  it("shows [[i18n('label.claim.reserveRatio')]] as the element does, on each record", () => {
    for (const [plugin] of onEachRecord()) expect(plugin).toContain(' Reserve ratio ');
  });

  it('shows [[_ratio(document.properties.cl:amount, document.properties.cl:reserve)]] as the element does, on each record', () => {
    expect(reserveRatio(12000, 3000)).toBe('25%');
    // 500 / 2500.5 is 19.996%, which Math.round makes 20.
    expect(reserveRatio(2500.5, 500)).toBe('20%');
    expect(reserveRatio(0, null)).toBe('–');
    expect(reserveRatio(null, null)).toBe('–');
    expect(onEachRecord().map(([plugin]) => /Reserve ratio (\S+)/.exec(plugin)?.[1])).toEqual([
      '25%',
      '20%',
      '–',
      '–',
    ]);
  });

  it("shows [[i18n('label.claim.highExposure')]] as the element does, on each record", () => {
    expect(onEachRecord().map(([plugin]) => plugin.endsWith(' High exposure'))).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });

  // Its conditions.
  it('shows what dom-if [[_isHigh(document.properties.cl:amount, threshold)]] holds only while it passes', () => {
    expect(isHigh(10000, 10000)).toBe(true);
    expect(isHigh(9999.99, 10000)).toBe(false);
    expect(isHigh(null, 10000)).toBe(false);
    // The threshold is the element's property, 10000 unless the page gives another.
    expect(shown(claim('CL-1002', 2500.5, 500), 2000)).toMatch(/ High exposure$/);
  });

  it('shows on each record of the observed behaviour what the element shows, word for word', () => {
    for (const [plugin, element] of onEachRecord()) expect(plugin).toBe(element);
  });
});
