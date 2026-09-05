/**
 * Builds a tiny, hand-rolled single-page PDF with a real extractable text
 * layer — enough for `unpdf` to read back via `getDocumentProxy` +
 * `extractText`, without pulling in a PDF-authoring dependency just for
 * tests. Used only by the `extractTextLayer` real-integration smoke test;
 * every other test injects a stub text layer directly.
 */
export function buildMinimalPdf(text: string): Buffer {
  const objects = [
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
    "3 0 obj<</Type/Page/Parent 2 0 R/Resources<</Font<</F1 4 0 R>>>>/MediaBox[0 0 300 300]/Contents 5 0 R>>endobj",
    "4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj",
  ];
  const stream = `BT /F1 18 Tf 10 200 Td (${text}) Tj ET`;
  objects.push(`5 0 obj<</Length ${stream.length}>>stream\n${stream}\nendstream\nendobj`);

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += `${obj}\n`;
  }
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}
