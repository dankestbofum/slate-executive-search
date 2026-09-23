'use strict';
const assert = require('node:assert/strict');
const site = require('../server/site');

function samplePdf(){
  const stream = 'BT /F1 12 Tf 72 720 Td (Adopted budget FY 2026 general fund) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (let i=0;i<objects.length;i++) { offsets.push(Buffer.byteLength(body)); body += `${i+1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10,'0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body);
}

const links = site.extractLinks(
  '<a href="/DocumentCenter/View/1234">Adopted budget FY 2026</a>'
  + '<a href="/budget?year=2026">Budget</a>'
  + '<a href="/budget?year=2025">Budget</a>',
  'https://example.gov/', 'municipality');
assert.ok(links.includes('https://example.gov/DocumentCenter/View/1234'));
assert.ok(links.includes('https://example.gov/budget?year=2026'));
assert.ok(links.includes('https://example.gov/budget?year=2025'));

const text = Array.from({ length:100 }, (_, i) => 'Unrelated navigation line number ' + i).join('\n')
  + '\nAdopted fiscal year 2026 general fund budget is $20 million.';
assert.ok(site.selectPassages(text, 240).includes('fiscal year 2026'));
assert.ok(site.selectPassages(text, 240).length <= 240);
assert.ok(site.ATTEMPT_LIMIT <= 6 && site.PAGE_LIMIT <= 4);
site.pdfText(samplePdf()).then(text => {
  assert.ok(text.includes('Adopted budget FY 2026'), text);
  console.log('Research retrieval: document centers, meaningful queries, PDF text, passage ranking and caps passed.');
}).catch(error => { console.error(error); process.exitCode = 1; });
