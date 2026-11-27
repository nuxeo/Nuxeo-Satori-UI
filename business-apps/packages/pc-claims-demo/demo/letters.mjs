#!/usr/bin/env node
/**
 * The P&C claims kit's two fictional letters, for demo step 3, as one-page PDFs:
 *
 *   node business-apps/packages/pc-claims-demo/demo/letters.mjs           # writes both beside this file
 *   node business-apps/packages/pc-claims-demo/demo/letters.mjs --check   # exits 1 if either differs
 *
 * - `claim-letter-pc-24003.pdf`, from Calder and Finch Bakery about claim PC-24003: its claim
 *   number, policy number and date of loss each on a line of its own, so the capture add-on's
 *   stand-in classifies it a claim letter at 100% and files it on PC-24003 by itself.
 * - `claim-letter-unclear.pdf`, from Ottoline Brandt about claim PC-24008, as a scan read badly: no
 *   policy number or date of loss, and its claim number read with a letter O for a zero,
 *   `PC-24O08`, which is not of a claim number's form. So it waits for a person, who corrects the
 *   number to PC-24008 and confirms.
 *
 * Every name is the kit's own, from `data.mjs`, and fictional, as each letter says at its foot.
 * The text is kept as text, not compressed and not drawn as an image, so the stand-in reads it:
 * a real scan is an image, and the stand-in gives it to a person. The bytes are the same on every
 * run: no date, no producer, no identifier, offsets counted here.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const FOOT = 'A fictional letter for the Nuxeo Satori P&C claims demo. No real person, business, policy or claim.';

/** Each letter: its file name, and its lines, `bold` for a heading. */
export const LETTERS = [
  {
    file: 'claim-letter-pc-24003.pdf',
    lines: [
      { text: 'Calder and Finch Bakery', bold: true },
      { text: '9 Market Square, Old Town' },
      { text: 'office@calder-finch.example.com' },
      { text: '' },
      { text: 'To: the claims department, Northgate Mutual, a fictional insurer' },
      { text: '' },
      { text: 'From: Calder and Finch Bakery' },
      { text: 'Claim number: PC-24003' },
      { text: 'Policy number: POL-PC-1002' },
      { text: 'Date of loss: the night of the windstorm' },
      { text: '' },
      { text: 'Dear claims team,' },
      { text: 'Further to our claim, we enclose the roofer\'s estimate for the repairs to the roof' },
      { text: 'torn in the windstorm, and the list of the stock that was soaked. Please add them' },
      { text: 'to the claim.' },
      { text: '' },
      { text: 'Yours faithfully,' },
      { text: 'M. Calder' },
    ],
  },
  {
    file: 'claim-letter-unclear.pdf',
    lines: [
      { text: 'Ottoline Brandt', bold: true },
      { text: '5 Kestrel Close, Cedar Falls' },
      { text: '' },
      { text: 'From: Ottoline Brandt' },
      { text: 'Claim number: PC-24O08' },
      { text: '' },
      { text: 'Dear Sir or Madam,' },
      { text: 'The electrician has now been. His report on the wiring in the attic, after the' },
      { text: 'lightning strike, is enclosed. I would be grateful if you could pass it to my adjuster.' },
      { text: '' },
      { text: 'Yours sincerely,' },
      { text: 'O. Brandt' },
    ],
  },
];

/** A PDF literal string: backslash and parentheses escaped. Only printable ASCII is drawn. */
function literal(text) {
  if (!/^[\x20-\x7e]*$/.test(text)) throw new Error(`a letter line is not printable ASCII: ${text}`);
  return `(${text.replace(/[\\()]/g, (c) => `\\${c}`)})`;
}

/** One letter's PDF, its bytes. */
export function pdf(letter) {
  const content = [];
  let y = 740;
  for (const line of [...letter.lines, { text: '' }, { text: FOOT, small: true }]) {
    if (line.text !== '') {
      const font = line.bold ? '/F2 14' : line.small ? '/F1 8' : '/F1 11';
      content.push(`BT ${font} Tf 72 ${y} Td ${literal(line.text)} Tj ET`);
    }
    y -= line.bold ? 20 : 15;
  }
  const stream = `${content.join('\n')}\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}endstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

function main() {
  const check = process.argv.includes('--check');
  let stale = 0;
  for (const letter of LETTERS) {
    const path = join(HERE, letter.file);
    const bytes = pdf(letter);
    if (check) {
      let held = null;
      try {
        held = readFileSync(path);
      } catch {
        held = null;
      }
      if (held === null || !held.equals(bytes)) {
        console.error(`${letter.file} is not what letters.mjs writes: run it, and commit the result.`);
        stale++;
      }
    } else {
      writeFileSync(path, bytes);
      console.log(`wrote ${letter.file}, ${bytes.length} bytes`);
    }
  }
  process.exit(stale === 0 ? 0 : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
