// Standalone test harness for the multi-page PDF generator used in the
// "Generate Anschreiben PDF" code node of Bewerbung My.
// Run:  node scripts/pdf_test.js   -> writes docs/sample-anschreiben.pdf
const fs = require('fs');

function buildPdf(data, profile) {
  const WIN1252 = {
    '\u00e4':228,'\u00f6':246,'\u00fc':252,
    '\u00c4':196,'\u00d6':214,'\u00dc':220,
    '\u00df':223,'\u00e9':233,'\u00e8':232,
    '\u00e0':224,'\u00e2':226,'\u00ea':234,
    '\u00fb':251,'\u00ee':238,'\u00ef':239,
    '\u2013':150,'\u2014':151,
    '\u2019':146,'\u201c':147,'\u201d':148,
  };

  function escPdf(str) {
    let r = '';
    for (const ch of String(str)) {
      if (WIN1252[ch] !== undefined) {
        r += BS + WIN1252[ch].toString(8).padStart(3, '0');
      } else if (ch === BS) { r += BS + BS; }
      else if (ch === '(')  { r += BS + '('; }
      else if (ch === ')')  { r += BS + ')'; }
      else {
        const c = ch.charCodeAt(0);
        r += (c >= 32 && c <= 126) ? ch : '?';
      }
    }
    return r;
  }

  const BS = String.fromCharCode(92); // backslash for PDF escapes
  const NL = String.fromCharCode(10); // real newline for object/xref lines

  function wrap(text, max) {
    const words = String(text).split(' ');
    const lines = []; let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (t.length > max && cur) { lines.push(cur); cur = w; }
      else cur = t;
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  }

  const PW = 595.28, PH = 841.89, ML = 70.8, MR = 524.4;
  const FS = 11, LH = 16, LSM = 14, MAX_CHARS = 80, BOTTOM = 80;

  // ---- page-aware layout ----------------------------------------------------
  const pages = [];   // one array of content operators per page
  let ops = [];       // current page operators
  let y = 800;        // current baseline (PDF origin is bottom-left)

  function newPage() { if (ops.length) pages.push(ops); ops = []; y = 800; }
  function flushPages() { if (ops.length) pages.push(ops); ops = []; }
  function ensureRoom(linesNeeded) {
    if (y - LH * linesNeeded < BOTTOM) newPage();
  }

  function T(x, yy, str, font, size) {
    const s = escPdf(str);
    if (s) ops.push(`BT /${font} ${size} Tf ${x.toFixed(1)} ${yy.toFixed(1)} Td (${s}) Tj ET`);
  }
  function TR(str, yy, font, size) {
    T(MR - str.length * size * 0.52, yy, str, font, size);
  }

  // Sender block (page 1 only)
  T(ML, y, profile.name, 'FB', FS); y -= LSM;
  T(ML, y, profile.address, 'F', FS); y -= LSM;
  T(ML, y, `Mobil: ${profile.phone}  E-Mail: ${profile.email}`, 'F', FS); y -= 22;

  // Recipient block
  const topY = y;
  for (const l of [data.company_name, data.hiring_manager, data.company_address, data.location].filter(Boolean)) {
    ensureRoom(1);
    T(ML, y, l, 'F', FS); y -= LSM;
  }
  TR('Ulm, den ' + data.date_applied, topY, 'F', FS); y -= 14;

  // Subject line
  for (const l of wrap('Bewerbung als ' + data.job_title, MAX_CHARS)) {
    ensureRoom(1);
    T(ML, y, l, 'FB', FS); y -= LH;
  }
  y -= 8;

  // Body paragraphs - page break instead of truncation
  for (const para of String(data.cover_letter).split(/\n\n+/)) {
    for (const line of para.trim().split('\n')) {
      if (!line.trim()) { y -= 6; continue; }
      for (const wl of wrap(line, MAX_CHARS)) {
        ensureRoom(1);
        T(ML, y, wl, 'F', FS); y -= LH;
      }
    }
    y -= 6;
  }

  // Attachments block
  if (profile.attachments && profile.attachments.length) {
    ensureRoom(profile.attachments.length + 1);
    T(ML, y, 'Anlagen:', 'F', FS); y -= LH;
    for (const a of profile.attachments) { T(ML, y, a, 'F', FS); y -= LH; }
  }

  flushPages();
  // ---- PDF object assembly --------------------------------------------------
  const fontDict = '/F << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >> '
                 + '/FB << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  const resources = `<< /Font << ${fontDict} >> >>`;

  function toBytes(s) {
    const a = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 0xff;
    return a;
  }

  const parts = [];
  let offset = 0;
  const off = {};

  function addObj(id, content) {
    const b = toBytes(content);
    off[id] = offset;
    parts.push(b);
    offset += b.length;
  }

  const nPages = pages.length;
  // ids: 1 catalog, 2 page tree; for page i (0-based): page obj = 3+2i, content obj = 4+2i
  const kids = [];
  for (let i = 0; i < nPages; i++) kids.push(`${3 + 2 * i} 0 R`);

  const hdrBytes = toBytes('%PDF-1.4' + NL);
  parts.push(hdrBytes); offset += hdrBytes.length;

  addObj(1, '1 0 obj' + BS + 'n<< /Type /Catalog /Pages 2 0 R >>' + BS + 'nendobj' + NL);
  addObj(2, `2 0 obj${NL}<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${nPages} >>${NL}endobj${NL}`);

  for (let i = 0; i < nPages; i++) {
    const stream = pages[i].join(NL);
    addObj(3 + 2 * i, `${3 + 2 * i} 0 obj${NL}<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Contents ${4 + 2 * i} 0 R /Resources ${resources} >>${NL}endobj${NL}`);
    addObj(4 + 2 * i, `${4 + 2 * i} 0 obj${NL}<< /Length ${stream.length} >>${NL}stream${NL}${stream}${NL}endstream${NL}endobj${NL}`);
  }

  const totalObjects = 2 + 2 * nPages;
  const xrefPos = offset;
  let xref = `xref${NL}0 ${totalObjects + 1}${NL}0000000000 65535 f ${NL}`;
  for (let i = 1; i <= totalObjects; i++) {
    xref += String(off[i]).padStart(10, '0') + ' 00000 n ' + NL;
  }
  xref += `trailer${NL}<< /Size ${totalObjects + 1} /Root 1 0 R >>${NL}startxref${NL}${xrefPos}${NL}%%EOF`;
  parts.push(toBytes(xref));

  const total = parts.reduce((s, p) => s + p.length, 0);
  const allBytes = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) { allBytes.set(p, pos); pos += p.length; }

  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let b64 = '';
  for (let i = 0; i < allBytes.length; i += 3) {
    const b0 = allBytes[i], b1 = allBytes[i + 1] || 0, b2 = allBytes[i + 2] || 0;
    b64 += B64[b0 >> 2];
    b64 += B64[((b0 & 3) << 4) | (b1 >> 4)];
    b64 += i + 1 < allBytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    b64 += i + 2 < allBytes.length ? B64[b2 & 63] : '=';
  }

  return { base64: b64, pages: nPages };
}

// ---- sample run --------------------------------------------------------------
const longLetter = [
  'Sehr geehrte Damen und Herren,',
  'mit großem Interesse habe ich Ihre Stellenausschreibung gelesen. Als Fachinformatiker für Anwendungsentwicklung bringe ich Erfahrung in Automatisierung, API-Integration und Datenverarbeitung mit.',
  'In meinen Projekten habe ich Workflows gebaut, die Rohdaten aus öffentlichen APIs strukturiert aufbereiten, Dokumente automatisch erzeugen und die Kommunikation zwischen Systemen orchestrieren. Dabei trenne ich bewusst deterministische Logik von KI-gestützten Schritten: Parsing, Validierung und Dokumentenerzeugung sind deterministisch, nur Textextraktion und Formulierung übernehmen Modelle.',
  'Besonders reizvoll finde ich die Frage, wie man Zuverlässigkeit in solchen Systemen messbar macht - Retry-Logik, Fehler-Triggers und Audit-Protokolle gehören genauso zur Implementierung wie der Happy Path.',
  'Über eine Einladung zu einem Vorstellungsgespräch würde ich mich sehr freuen und stehe für Rückfragen jederzeit gerne zur Verfügung.',
  'Mit freundlichen Grüßen',
].join('\n\n');


const data = {
  company_name: 'Test GmbH',
  hiring_manager: 'Frau Beispiel',
  company_address: 'Beispielstraße 12',
  location: 'Ulm',
  date_applied: '23.10.2026',
  job_title: 'Fachinformatiker für Anwendungsentwicklung',
  cover_letter: longLetter,
};
const profile = {
  name: '<APPLICANT_NAME>',
  address: '<APPLICANT_ADDRESS>',
  phone: '<APPLICANT_PHONE>',
  email: '<YOUR_EMAIL>',
  attachments: ['Lebenslauf', 'Zeugnisse'],
};

if (require.main === module) {
  const short = buildPdf(data, profile);
  // Regression test for the old single-page truncation bug:
  // a long letter must now spill onto additional pages instead of being cut off.
  const longData = Object.assign({}, data, { cover_letter: Array(12).fill(longLetter).join('\n\n') });
  const long = buildPdf(longData, profile);

  fs.writeFileSync('docs/sample-anschreiben.pdf', Buffer.from(long.base64, 'base64'));
  console.log('short letter pages:', short.pages, '| long letter pages:', long.pages);
  if (long.pages < 2) {
    console.error('FAIL: multi-page support is not working');
    process.exit(1);
  }
}

module.exports = { buildPdf };
