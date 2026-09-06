/**
 * The lodgement PDF (PRD FR-14 a) — every figure laid out by myTax item/label,
 * in myTax on-screen order, ready to transcribe.
 *
 * Uses `pdf-lib` (pure JS, no native deps). The content is exactly
 * {@link renderReturnPdfLines}, so the PDF and every text assertion in the
 * test suite stay in lock-step.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { renderReturnPdfLines, type PdfLine, type PdfLineStyle } from "./pdf-text";
import type { ExportPackageInput } from "./types";

const PAGE_WIDTH = 595.28; // A4 portrait, points
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const BOTTOM_MARGIN = 56;

interface StyleSpec {
  readonly size: number;
  readonly bold: boolean;
  readonly gapBefore: number;
  readonly color: readonly [number, number, number];
}

const STYLES: Readonly<Record<PdfLineStyle, StyleSpec>> = {
  title: { size: 17, bold: true, gapBefore: 0, color: [0.17, 0.15, 0.13] },
  h1: { size: 13, bold: true, gapBefore: 10, color: [0.17, 0.15, 0.13] },
  h2: { size: 11, bold: true, gapBefore: 6, color: [0.35, 0.3, 0.26] },
  label: { size: 9.5, bold: false, gapBefore: 1, color: [0.17, 0.15, 0.13] },
  detail: { size: 8.5, bold: false, gapBefore: 0, color: [0.4, 0.36, 0.32] },
  body: { size: 9, bold: false, gapBefore: 0, color: [0.3, 0.27, 0.24] },
  spacer: { size: 6, bold: false, gapBefore: 0, color: [1, 1, 1] },
};

const LINE_HEIGHT = 1.38;

/** CP1252 code points pdf-lib's WinAnsi standard fonts can render but that aren't printable ASCII. */
const WIN_ANSI_EXTRA = new Set([
  0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2026, 0x00b7, 0x00a0, 0x2122,
]);

/** Replace anything a WinAnsi standard font can't draw (crashes pdf-lib) with a safe stand-in. */
function winAnsiSafe(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 9) {
      out += "    ";
    } else if (code >= 0x20 && code <= 0x7e) {
      out += ch;
    } else if (WIN_ANSI_EXTRA.has(code)) {
      out += ch;
    } else if (code >= 0xa1 && code <= 0xff) {
      out += ch;
    } else {
      out += "?";
    }
  }
  return out;
}

/** Wrap `text` to `maxWidth` at `size` using `font`'s metrics. */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(" ");
  const rows: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || current === "") {
      current = candidate;
    } else {
      rows.push(current);
      current = word;
    }
  }
  if (current) rows.push(current);
  return rows.length > 0 ? rows : [""];
}

/**
 * Render the lodgement summary PDF for `input`. Deterministic: given the same
 * input (including `generatedAt`) the byte output is stable.
 */
export async function buildReturnPdf(input: ExportPackageInput): Promise<Uint8Array> {
  const lines = renderReturnPdfLines(input);
  const doc = await PDFDocument.create();
  doc.setTitle(`Tax return ${input.targetYear} — lodgement summary`);
  doc.setProducer("aus-tax-lodge");
  doc.setCreationDate(new Date(input.generatedAt ?? "2025-07-01T00:00:00.000Z"));
  doc.setModificationDate(new Date(input.generatedAt ?? "2025-07-01T00:00:00.000Z"));

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const textWidth = PAGE_WIDTH - MARGIN * 2;

  let page: PDFPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const newPage = (): void => {
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  };

  for (const line of lines as PdfLine[]) {
    const spec = STYLES[line.style];
    const font = spec.bold ? bold : regular;

    if (line.style === "spacer") {
      y -= spec.size;
      continue;
    }

    y -= spec.gapBefore;
    const rows = wrap(winAnsiSafe(line.text), font, spec.size, textWidth);
    for (const row of rows) {
      if (y - spec.size < BOTTOM_MARGIN) newPage();
      page.drawText(row, {
        x: MARGIN,
        y: y - spec.size,
        size: spec.size,
        font,
        color: rgb(spec.color[0], spec.color[1], spec.color[2]),
      });
      y -= spec.size * LINE_HEIGHT;
    }
  }

  return doc.save();
}
