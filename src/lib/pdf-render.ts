import PDFDocument from "pdfkit";
import type { Report } from "./types";
import {
  formatBytes,
  formatDate,
  formatDuration,
  gradeOf,
  severityCounts,
  summaryExcerpt,
  systemicFixes,
  testEvidenceOf,
  topFindings,
  verificationOf,
  verdictOf,
  type PdfFinding,
} from "./pdf";

/**
 * Server-side PDF renderer.
 *
 * The report used to be "printed" from the browser, which meant the PDF existed
 * only if a popup opened, the print dialog appeared, and the reader chose
 * "Save as PDF". A download that depends on three pieces of browser UI is not a
 * download. This draws the same three pages directly into a PDF stream, so
 * `?format=pdf` returns a file the way `?format=md` already did.
 *
 * Geometry is in points: A4 is 595.28 × 841.89. Colours match the on-screen
 * print stylesheet exactly, because the two are meant to be the same document.
 */

const W = 595.28;
const H = 841.89;
const M = 38;
const CW = W - M * 2;

const C = {
  navy: "#05091a",
  panel: "#0c1730",
  panel2: "#101d3a",
  hair: "#1c2c4d",
  ink: "#eaf1fc",
  ink2: "#a7bad9",
  ink3: "#6c81a6",
  blue: "#4d8dff",
  blue2: "#7fb0ff",
  teal: "#22d3a6",
  amber: "#f5a524",
  red: "#ff4d6a",
  redSoft: "#ff8ba0",
} as const;

/**
 * Characters outside WinAnsi silently render as blanks with the standard
 * fonts. Arrows and ticks are the ones this content would naturally use, so
 * they are transliterated rather than dropped.
 */
function safe(s: string): string {
  return s
    .replace(/→/g, "->")
    .replace(/←/g, "<-")
    .replace(/[✓✔]/g, "yes")
    .replace(/[✗✘]/g, "no")
    .replace(/[▸►]/g, ">")
    .replace(/[^\u0000-\u00ff\u2018\u2019\u201c\u201d\u2013\u2014\u2026\u00d7\u00b7]/g, "");
}

type Doc = PDFKit.PDFDocument;

function severityColor(sev: string): string {
  if (sev === "critical" || sev === "high") return C.red;
  if (sev === "medium") return C.amber;
  return C.blue;
}

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

function background(doc: Doc): void {
  doc.rect(0, 0, W, H).fill(C.navy);
  // A single soft accent, echoing the on-screen gradient without a raster.
  doc.save();
  doc.fillOpacity(0.08).circle(W - 40, -10, 190).fill(C.blue);
  doc.restore();
}

function label(doc: Doc, text: string, x: number, y: number, color: string = C.ink3): void {
  doc
    .font("Helvetica-Bold")
    .fontSize(6.4)
    .fillColor(color)
    .text(safe(text.toUpperCase()), x, y, { characterSpacing: 1.4, lineBreak: false });
}

function heading(doc: Doc, text: string, y: number): void {
  doc.font("Helvetica-Bold").fontSize(9.6).fillColor(C.ink).text(safe(text), M, y, {
    width: CW,
    lineBreak: false,
  });
  doc
    .moveTo(M, y + 14)
    .lineTo(W - M, y + 14)
    .lineWidth(0.5)
    .strokeColor(C.hair)
    .stroke();
}

function paragraph(
  doc: Doc,
  text: string,
  x: number,
  y: number,
  width: number,
  opts: { size?: number; color?: string; bold?: boolean; lineGap?: number } = {}
): number {
  const size = opts.size ?? 7.6;
  doc
    .font(opts.bold ? "Helvetica-Bold" : "Helvetica")
    .fontSize(size)
    .fillColor(opts.color ?? C.ink2)
    .text(safe(text), x, y, { width, lineGap: opts.lineGap ?? 1.6 });
  return doc.heightOfString(safe(text), {
    width,
    lineGap: opts.lineGap ?? 1.6,
  });
}

/** A rounded label, sized to its text. */
function chip(
  doc: Doc,
  text: string,
  x: number,
  y: number,
  color: string,
  opts: { fill?: number; size?: number } = {}
): number {
  const size = opts.size ?? 5.8;
  const t = safe(text.toUpperCase());
  doc.font("Helvetica-Bold").fontSize(size);
  const w = doc.widthOfString(t, { characterSpacing: 0.8 }) + 10;
  const h = size + 6;
  doc.save();
  doc.roundedRect(x, y, w, h, h / 2).lineWidth(0.6).strokeColor(color);
  doc.fillOpacity(opts.fill ?? 0.14).fillColor(color).fill();
  doc.restore();
  doc
    .fillColor(color)
    .fontSize(size)
    .text(t, x + 5, y + 3.1, { characterSpacing: 0.8, lineBreak: false });
  return w;
}

function panel(doc: Doc, x: number, y: number, w: number, h: number): void {
  doc.save();
  doc.roundedRect(x, y, w, h, 5).lineWidth(0.6).strokeColor(C.hair);
  doc.fillOpacity(1).fillColor(C.panel).fill();
  doc.restore();
}

/** The brand mark: teal squircle, white H, cyan node cut out of the corner. */
function mark(doc: Doc, x: number, y: number, size = 19): void {
  const grad = doc.linearGradient(x, y, x + size, y + size);
  grad.stop(0, "#2dd4bf").stop(1, "#0d9488");
  doc.roundedRect(x, y, size, size, size * 0.3).fill(grad);

  const r = size * 0.34;
  const cx = x + size - r * 0.35;
  const cy = y + r * 0.35;
  doc.circle(cx, cy, r + 1.5).fill(C.navy);
  doc.circle(cx, cy, r).fill("#22d3ee");

  doc
    .font("Helvetica-Bold")
    .fontSize(size * 0.62)
    .fillColor("#ffffff")
    .text("H", x, y + size * 0.19, { width: size, align: "center", lineBreak: false });
}

function footer(doc: Doc, report: Report, page: string): void {
  doc
    .moveTo(M, H - 34)
    .lineTo(W - M, H - 34)
    .lineWidth(0.5)
    .strokeColor(C.hair)
    .stroke();
  doc
    .font("Helvetica")
    .fontSize(6.2)
    .fillColor(C.ink3)
    .text(
      safe(`${report.repo.fullName} · generated by static analysis — no model, no execution`),
      M,
      H - 26,
      { width: CW - 40, lineBreak: false }
    );
  doc
    .font("Helvetica-Bold")
    .fontSize(6.2)
    .fillColor(C.ink3)
    .text(page, W - M - 34, H - 26, { width: 34, align: "right", lineBreak: false });
}

function pageHeader(doc: Doc, section: string, note: string): void {
  mark(doc, M, M - 2);
  doc
    .font("Helvetica-Bold")
    .fontSize(8)
    .fillColor(C.ink)
    .text("HARYN AI", M + 26, M + 1, { characterSpacing: 1.6, lineBreak: false });
  doc
    .font("Helvetica")
    .fontSize(6.4)
    .fillColor(C.ink3)
    .text("Engineering health report", M + 26, M + 11, { lineBreak: false });

  doc
    .font("Helvetica-Bold")
    .fontSize(6.4)
    .fillColor(C.blue2)
    .text(safe(section.toUpperCase()), W - M - 150, M + 1, {
      width: 150,
      align: "right",
      characterSpacing: 1.2,
      lineBreak: false,
    });
  doc
    .font("Helvetica")
    .fontSize(6.4)
    .fillColor(C.ink2)
    .text(safe(note), W - M - 150, M + 10, { width: 150, align: "right", lineBreak: false });

  doc
    .moveTo(M, M + 26)
    .lineTo(W - M, M + 26)
    .lineWidth(0.5)
    .strokeColor(C.hair)
    .stroke();
}

/* ------------------------------------------------------------------ */
/* Page 1 — executive summary                                          */
/* ------------------------------------------------------------------ */

function pageOne(doc: Doc, report: Report): void {
  background(doc);
  pageHeader(doc, "Section 01", "Executive summary");

  const counts = severityCounts(report.findings);
  const top = topFindings(report, 5);
  const [owner, name] = report.repo.fullName.split("/");

  let y = M + 44;

  // Repository name: the owner recedes, the name carries the page.
  doc.font("Helvetica-Bold").fontSize(22).fillColor(C.ink3);
  const ownerW = doc.widthOfString(`${owner}/`);
  doc.text(safe(`${owner}/`), M, y, { lineBreak: false });
  doc.fontSize(22).fillColor(C.ink).text(safe(name), M + ownerW, y, { lineBreak: false });

  y += 30;

  const meta: string[] = [
    `Branch ${report.repo.defaultBranch}`,
    `Scanned ${formatDate(report.completedAt)}`,
    `Duration ${formatDuration(report.durationMs)}`,
  ];
  if (report.activity?.totalCommits) {
    meta.push(`Commits ${report.activity.totalCommits.toLocaleString("en-GB")}`);
  }
  if (report.repo.license) meta.push(`Licence ${report.repo.license}`);
  doc.font("Helvetica").fontSize(7.2).fillColor(C.ink3);
  doc.text(safe(meta.join("   ·   ")), M, y, { width: CW, lineBreak: false });

  /* --- score + severity -------------------------------------------- */
  y += 22;
  const cardW = 196;
  const cardH = 84;
  panel(doc, M, y, cardW, cardH);

  label(doc, "Overall health", M + 14, y + 12);
  doc
    .font("Helvetica-Bold")
    .fontSize(40)
    .fillColor(C.blue2)
    .text(String(report.healthScore), M + 13, y + 22, { lineBreak: false });
  const scoreW = doc.widthOfString(String(report.healthScore));
  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor(C.ink3)
    .text("/ 100", M + 16 + scoreW, y + 42, { lineBreak: false });

  const grade = `GRADE ${gradeOf(report.healthScore)}`;
  doc.font("Helvetica-Bold").fontSize(6.2);
  const gw = doc.widthOfString(grade, { characterSpacing: 0.8 }) + 12;
  chip(doc, grade, M + cardW - gw - 12, y + 13, C.blue2);

  paragraph(
    doc,
    "Weighted across eight categories: security, bugs, quality, testing, architecture, performance, dependencies and documentation.",
    M + 14,
    y + 56,
    cardW - 28,
    { size: 6.4, color: C.ink3, lineGap: 1.4 }
  );

  // 2 × 2 severity grid
  const gridX = M + cardW + 12;
  const cellW = (CW - cardW - 12 - 8) / 2;
  const cellH = (cardH - 8) / 2;
  const cells: { key: "critical" | "high" | "medium" | "low"; label: string; color: string }[] = [
    { key: "critical", label: "Critical", color: C.red },
    { key: "high", label: "High", color: C.redSoft },
    { key: "medium", label: "Medium", color: C.amber },
    { key: "low", label: "Low", color: C.blue2 },
  ];
  cells.forEach((cell, i) => {
    const cx = gridX + (i % 2) * (cellW + 8);
    const cy = y + Math.floor(i / 2) * (cellH + 8);
    const n = counts[cell.key];
    doc.save();
    doc.roundedRect(cx, cy, cellW, cellH, 4).lineWidth(0.6).strokeColor(C.hair);
    doc.fillOpacity(1).fillColor("#0a1329").fill();
    doc.restore();
    doc
      .font("Helvetica-Bold")
      .fontSize(20)
      .fillColor(n === 0 ? C.ink3 : cell.color)
      .text(String(n), cx + 10, cy + 8, { lineBreak: false });
    label(doc, cell.label, cx + 10, cy + cellH - 14);
  });

  /* --- findings ----------------------------------------------------- */
  y += cardH + 20;
  heading(doc, "Most important findings", y);
  doc
    .font("Helvetica")
    .fontSize(6.4)
    .fillColor(C.ink3)
    .text(
      safe(`${counts.total} actionable of ${report.findings.length} total`),
      W - M - 120,
      y + 1,
      { width: 120, align: "right", lineBreak: false }
    );
  y += 22;

  for (const f of top) {
    const loc = f.filePath
      ? `${f.filePath}${f.lineStart ? `:${f.lineStart}` : ""}`
      : "repository-wide";
    const extra =
      (f.occurrences > 1 ? `  ·  x${f.occurrences} in ${f.files} file${f.files === 1 ? "" : "s"}` : "") +
      (f.heuristic ? "  ·  heuristic" : "  ·  confirmed");

    doc.circle(M + 3, y + 4, 2).fill(severityColor(f.severity));
    doc
      .font("Helvetica-Bold")
      .fontSize(8)
      .fillColor(C.ink)
      .text(safe(f.title), M + 12, y, { width: CW - 130, lineBreak: false });
    doc
      .font("Helvetica")
      .fontSize(6.4)
      .fillColor(C.ink3)
      .text(safe(loc + extra), M + 12, y + 10, { width: CW - 130, lineBreak: false });
    doc
      .font("Helvetica-Bold")
      .fontSize(5.8)
      .fillColor(C.ink3)
      .text(safe(f.categoryLabel.toUpperCase()), W - M - 110, y + 2, {
        width: 110,
        align: "right",
        characterSpacing: 0.8,
        lineBreak: false,
      });

    y += 22;
    doc
      .moveTo(M + 12, y - 6)
      .lineTo(W - M, y - 6)
      .lineWidth(0.4)
      .strokeColor("#16233c")
      .stroke();
  }

  /* --- stack + coverage --------------------------------------------- */
  y += 6;
  const colW = (CW - 24) / 2;
  const rightX = M + colW + 24;

  heading(doc, "Tech stack", y);
  let ly = y + 20;
  for (const l of report.languages.slice(0, 4)) {
    doc.font("Helvetica").fontSize(7).fillColor(C.ink3).text(safe(l.name), M, ly, { lineBreak: false });
    doc
      .font("Helvetica-Bold")
      .fontSize(7)
      .fillColor(C.ink)
      .text(`${l.percent.toFixed(1)}%`, M + colW - 40, ly, { width: 40, align: "right", lineBreak: false });
    ly += 13;
  }

  heading(doc, "Scan coverage", y);
  const coverage: [string, string][] = [
    ["Files analysed", report.structure.fileCount.toLocaleString("en-GB")],
    ["Directories", report.structure.dirCount.toLocaleString("en-GB")],
    ["Source size", formatBytes(report.structure.totalBytes)],
    ["Code chunks indexed", (report.stats.indexedChunks ?? 0).toLocaleString("en-GB")],
  ];
  let ry = y + 20;
  for (const [k, v] of coverage) {
    doc.font("Helvetica").fontSize(7).fillColor(C.ink3).text(safe(k), rightX, ry, { lineBreak: false });
    doc
      .font("Helvetica-Bold")
      .fontSize(7)
      .fillColor(C.ink)
      .text(safe(v), rightX + colW - 60, ry, { width: 60, align: "right", lineBreak: false });
    ry += 13;
  }

  /* --- recommendation ------------------------------------------------ */
  y = Math.max(ly, ry) + 12;
  heading(doc, "Recommendation", y);
  y += 18;

  const verdict = verdictOf(report, counts);
  const blockH = 44 + paragraph(doc, summaryExcerpt(report, 2), M + 12, y + 10, CW - 24, {
    size: 7,
    color: C.ink2,
  });
  panel(doc, M, y, CW, blockH);

  const verdictLabel =
    counts.critical > 0
      ? "BLOCK RELEASE"
      : counts.high > 0
        ? "FIX BEFORE RELEASE"
        : counts.medium > 0
          ? "SCHEDULE"
          : "NO BLOCKERS";
  const vc = counts.critical > 0 || counts.high > 0 ? C.red : counts.medium > 0 ? C.amber : C.teal;
  const vw = chip(doc, verdictLabel, M + 12, y + 10, vc);
  paragraph(doc, verdict, M + 20 + vw, y + 11, CW - 32 - vw, { size: 6.6, color: C.ink3 });

  // Re-draw the excerpt below the chip row.
  paragraph(doc, summaryExcerpt(report, 2), M + 12, y + 30, CW - 24, { size: 7, color: C.ink2 });

  footer(doc, report, "01 / 03");
}

/* ------------------------------------------------------------------ */
/* Page 2 — detailed findings                                          */
/* ------------------------------------------------------------------ */

function findingBlock(doc: Doc, f: PdfFinding, y: number): number {
  const pad = 10;
  const innerW = CW - pad * 2;
  const colW = (innerW - 16) / 2;

  const what = paragraph(doc, f.what, M + pad, y + 26, colW, { size: 6.8, color: C.ink2 });
  const fix = paragraph(doc, f.fix ?? "No specific repair recorded for this rule.", M + pad + colW + 16, y + 26, colW, {
    size: 6.8,
    color: C.ink2,
  });

  const bodyTop = y + 26;
  let cursor = bodyTop + Math.max(what, fix) + 6;

  let impactH = 0;
  if (f.why) {
    impactH = paragraph(doc, f.why, M + pad, cursor + 8, innerW, { size: 6.8, color: C.ink2 });
    cursor += impactH + 14;
  }

  let evidenceH = 0;
  if (f.evidence) {
    const ev = safe(f.evidence);
    doc.font("Courier").fontSize(6.2);
    evidenceH = doc.heightOfString(ev, { width: innerW - 12, lineGap: 1.2 });
    cursor += 6;
    doc.save();
    doc.roundedRect(M + pad, cursor, innerW, evidenceH + 8, 3).lineWidth(0.5).strokeColor(C.hair);
    doc.fillOpacity(1).fillColor("#03060f").fill();
    doc.restore();
    doc
      .font("Courier")
      .fontSize(6.2)
      .fillColor("#b9cbe8")
      .text(ev, M + pad + 6, cursor + 4, { width: innerW - 12, lineGap: 1.2 });
    cursor += evidenceH + 12;
  }

  const blockH = cursor - y;

  // Frame + severity rail
  doc.save();
  doc.roundedRect(M, y, CW, blockH, 4).lineWidth(0.5).strokeColor(C.hair);
  doc.fillOpacity(1).fillColor("#080f22").fill();
  doc.restore();
  doc.rect(M, y + 4, 2.4, blockH - 8).fill(severityColor(f.severity));

  // Header
  doc
    .font("Courier-Bold")
    .fontSize(7)
    .fillColor(C.ink3)
    .text(String(f.rank).padStart(2, "0"), M + pad, y + 9, { lineBreak: false });
  doc
    .font("Helvetica-Bold")
    .fontSize(8.4)
    .fillColor(C.ink)
    .text(safe(f.title), M + pad + 18, y + 8, { width: innerW - 200, lineBreak: false });

  let cx = W - M - pad;
  const conf = f.heuristic ? `${Math.round(f.confidence * 100)}% HEURISTIC` : "CONFIRMED";
  doc.font("Helvetica-Bold").fontSize(5.8);
  const confW = doc.widthOfString(safe(conf.toUpperCase()), { characterSpacing: 0.8 }) + 10;
  cx -= confW;
  chip(doc, conf, cx, y + 7, f.heuristic ? C.amber : C.teal);
  cx -= 6;
  if (f.occurrences > 1) {
    const occW = doc.widthOfString(`X${f.occurrences}`, { characterSpacing: 0.8 }) + 10;
    cx -= occW;
    chip(doc, `x${f.occurrences}`, cx, y + 7, C.ink2);
    cx -= 6;
  }
  const sevW = doc.widthOfString(f.severity.toUpperCase(), { characterSpacing: 0.8 }) + 10;
  cx -= sevW;
  chip(doc, f.severity, cx, y + 7, severityColor(f.severity));

  // Location
  const loc = f.filePath
    ? `${f.filePath}${f.lineStart ? `:${f.lineStart}` : ""}${f.inTest ? "  ·  test file" : ""}${
        f.occurrences > 1 ? `  ·  repeated in ${f.files} file${f.files === 1 ? "" : "s"}` : ""
      }`
    : "repository-wide";
  doc
    .font("Courier")
    .fontSize(6.2)
    .fillColor(C.blue2)
    .text(safe(loc), M + pad, y + 20, { width: innerW, lineBreak: false });

  label(doc, "What it is", M + pad, y + 26 - 6);
  label(doc, "Fix", M + pad + colW + 16, y + 26 - 6, C.teal);

  if (f.why) {
    label(doc, "Impact", M + pad, bodyTop + Math.max(what, fix) + 4, C.red);
  }

  return blockH;
}

function pageTwo(doc: Doc, report: Report): void {
  doc.addPage();
  background(doc);
  pageHeader(doc, "Section 02", "Detailed findings");

  const findings = topFindings(report, 5);
  let y = M + 44;

  heading(doc, "What is wrong, where, and why it matters", y);
  doc
    .font("Helvetica")
    .fontSize(6.4)
    .fillColor(C.ink3)
    .text(
      safe(`Top ${findings.length} distinct problems · xN = one rule, many files`),
      W - M - 170,
      y + 1,
      { width: 170, align: "right", lineBreak: false }
    );

  y += 24;
  for (const f of findings) {
    const h = findingBlock(doc, f, y);
    y += h + 9;
  }

  footer(doc, report, "02 / 03");
}

/* ------------------------------------------------------------------ */
/* Page 3 — action plan                                                */
/* ------------------------------------------------------------------ */

function statusCard(
  doc: Doc,
  x: number,
  y: number,
  w: number,
  n: number,
  text: string,
  color: string
): void {
  doc.save();
  doc.roundedRect(x, y, w, 40, 4).lineWidth(0.5).strokeColor(C.hair);
  doc.fillOpacity(1).fillColor("#080f22").fill();
  doc.restore();
  doc.font("Helvetica-Bold").fontSize(18).fillColor(color).text(String(n), x + 10, y + 8, { lineBreak: false });
  label(doc, text, x + 10, y + 29);
}

function planRow(doc: Doc, n: string, title: string, detail: string, y: number): number {
  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor(C.blue)
    .text(n, M, y, { width: 20, lineBreak: false });
  doc
    .font("Helvetica-Bold")
    .fontSize(7.4)
    .fillColor(C.ink)
    .text(safe(title), M + 22, y, { width: CW - 22, lineBreak: false });
  const h = paragraph(doc, detail, M + 22, y + 11, CW - 22, { size: 6.6, color: C.ink3 });
  return 14 + h;
}

function pageThree(doc: Doc, report: Report): void {
  doc.addPage();
  background(doc);
  pageHeader(doc, "Section 03", "Fixes & action plan");

  const counts = severityCounts(report.findings);
  const verification = verificationOf(report);
  const systemic = systemicFixes(report, 3);
  const tests = testEvidenceOf(report);
  const deps = report.dependencies.stat;
  const graph = report.graph;
  const blocking = report.findings.filter(
    (f) => f.severity === "critical" || f.severity === "high"
  );
  const backlog = report.findings.filter((f) => f.severity === "medium" || f.severity === "low");

  let y = M + 44;
  heading(doc, "Verification status", y);
  doc
    .font("Helvetica")
    .fontSize(6.4)
    .fillColor(C.ink3)
    .text("What this report can and cannot claim", W - M - 170, y + 1, {
      width: 170,
      align: "right",
      lineBreak: false,
    });

  y += 20;
  const cardW = (CW - 18) / 4;
  statusCard(doc, M, y, cardW, verification.detected, "Detected", C.blue2);
  statusCard(doc, M + cardW + 6, y, cardW, verification.confirmed, "Confirmed in source", C.teal);
  statusCard(doc, M + (cardW + 6) * 2, y, cardW, verification.heuristic, "Heuristic — verify", C.amber);
  statusCard(doc, M + (cardW + 6) * 3, y, cardW, verification.fixesVerified, "Fixes verified", C.ink3);

  y += 50;
  const honesty =
    "Every finding was detected by a static rule reading the source. The repairs are suggestions — this analysis reads code, it never changes it, so 0 fixes are applied and 0 are verified. A finding marked heuristic is a pattern to check, not a proven defect.";
  const honestyH = paragraph(doc, honesty, M + 10, y + 8, CW - 20, { size: 6.8, color: C.ink2 });
  panel(doc, M, y, CW, honestyH + 16);

  /* --- two columns -------------------------------------------------- */
  y += honestyH + 26;
  const colW = (CW - 22) / 2;
  const rightX = M + colW + 22;

  heading(doc, "Proposed fixes", y);
  doc
    .font("Helvetica")
    .fontSize(6)
    .fillColor(C.ink3)
    .text("one decision each", W - M - colW, y + 1, { width: colW, align: "right", lineBreak: false });

  let ly = y + 20;
  systemic.forEach((s, i) => {
    ly += planRow(
      doc,
      String(i + 1).padStart(2, "0"),
      `${s.title} — ${s.count}x across ${s.files} file${s.files === 1 ? "" : "s"}`,
      s.fix ?? "No specific repair recorded.",
      ly
    ) + 6;
  });

  heading(doc, "Tests", ly + 4);
  doc
    .font("Helvetica")
    .fontSize(6)
    .fillColor(C.ink3)
    .text("evidence, not results", W - M - colW, ly + 5, {
      width: colW,
      align: "right",
      lineBreak: false,
    });

  const testRows: [string, string, string?][] = [
    ["Test suite executed", "No — not run", C.amber],
    ["Test files / source files", `${tests.testFiles} / ${tests.sourceFiles}`],
    ["Frameworks detected", tests.frameworks.join(", ") || "none"],
  ];
  if (tests.uncovered.length) testRows.push(["Untested critical areas", tests.uncovered.join(", "), C.amber]);

  let ty = ly + 24;
  for (const [k, v, color] of testRows) {
    doc.font("Helvetica").fontSize(6.6).fillColor(C.ink3).text(safe(k), M, ty, { lineBreak: false });
    doc
      .font("Helvetica-Bold")
      .fontSize(6.6)
      .fillColor(color ?? C.ink)
      .text(safe(v), M + colW - 150, ty, { width: 150, align: "right", lineBreak: false });
    ty += 12;
  }

  /* right column */
  let ry = y;
  heading(doc, "Dependencies", ry);
  ry += 20;
  const depRows: [string, string, string?][] = [
    ["Declared", String(deps.total)],
    ["Vulnerable", String(deps.vulnerable), deps.vulnerable > 0 ? C.red : C.teal],
    ["Outdated", String(deps.outdated), deps.outdated > 0 ? C.amber : C.teal],
    ["Healthy", String(deps.healthy)],
  ];
  for (const [k, v, color] of depRows) {
    doc.font("Helvetica").fontSize(6.6).fillColor(C.ink3).text(safe(k), rightX, ry, { lineBreak: false });
    doc
      .font("Helvetica-Bold")
      .fontSize(6.6)
      .fillColor(color ?? C.ink)
      .text(safe(v), rightX + colW - 60, ry, { width: 60, align: "right", lineBreak: false });
    ry += 12;
  }

  heading(doc, "Knowledge graph", ry + 6);
  ry += 26;
  const skipped = graph?.skippedFiles ?? 0;
  const graphRows: [string, string, string?][] = [
    [
      "Nodes / edges",
      `${(graph?.nodeCount ?? 0).toLocaleString("en-GB")} / ${(graph?.edgeCount ?? 0).toLocaleString("en-GB")}`,
    ],
    ["Files parsed", String(graph?.parsedFiles ?? 0)],
    ["Skipped as unsupported", String(skipped), skipped > 0 ? C.amber : C.teal],
    [
      "Completeness",
      graph?.truncated ? "subset (cap reached)" : "complete",
      graph?.truncated ? C.amber : C.teal,
    ],
  ];
  for (const [k, v, color] of graphRows) {
    doc.font("Helvetica").fontSize(6.6).fillColor(C.ink3).text(safe(k), rightX, ry, { lineBreak: false });
    doc
      .font("Helvetica-Bold")
      .fontSize(6.6)
      .fillColor(color ?? C.ink)
      .text(safe(v), rightX + colW - 110, ry, { width: 110, align: "right", lineBreak: false });
    ry += 12;
  }

  /* --- next steps --------------------------------------------------- */
  y = Math.max(ty, ry) + 16;
  heading(doc, "Next steps", y);
  doc
    .font("Helvetica")
    .fontSize(6)
    .fillColor(C.ink3)
    .text("in this order", W - M - 100, y + 1, { width: 100, align: "right", lineBreak: false });

  let sy = y + 20;
  let step = 0;
  if (blocking.length) {
    step += 1;
    sy += planRow(
      doc,
      String(step).padStart(2, "0"),
      `Resolve the ${blocking.length} critical and high findings first`,
      `Start with ${blocking[0].title.toLowerCase()} in ${blocking[0].filePath ?? "the codebase"}. These are the ones worth delaying a release for.`,
      sy
    ) + 6;
  }
  if (systemic.length) {
    step += 1;
    const repeat = systemic.reduce((n, s) => n + s.count, 0);
    sy += planRow(
      doc,
      String(step).padStart(2, "0"),
      `Collapse the repeated patterns — ${systemic.length} rules, ${repeat} findings`,
      `One decision per rule removes ${repeat} findings. This is the cheapest work in the report per edit.`,
      sy
    ) + 6;
  }
  if (backlog.length) {
    step += 1;
    sy += planRow(
      doc,
      String(step).padStart(2, "0"),
      `Schedule the ${backlog.length} medium and low findings`,
      "None of these block a release. Group them by area rather than fixing them one at a time.",
      sy
    ) + 6;
  }
  step += 1;
  sy += planRow(
    doc,
    String(step).padStart(2, "0"),
    "Re-run the analysis to confirm the fixes",
    "This report cannot verify a repair: it read the code, it did not change it. Re-analysing after the fix is what turns a suggestion into a verified result.",
    sy
  );

  /* --- limitations -------------------------------------------------- */
  y = sy + 14;
  heading(doc, "Limitations", y);
  let limY = y + 18;
  const limits: [string, string][] = [
    ["warn", "No test suite was executed. The counts above describe test files, not passing or failing tests."],
    [
      "warn",
      `${verification.heuristic} finding${verification.heuristic === 1 ? " is" : "s are"} heuristic — the rule reports a pattern, not a proven runtime defect.`,
    ],
  ];
  if (skipped > 0) limits.push(["warn", `${skipped} files could not be parsed into the knowledge graph.`]);
  if (graph?.truncated) limits.push(["warn", "The knowledge graph hit its node cap, so call relationships are a subset."]);
  limits.push(["", "Static analysis reads code; it does not run it. Behaviour that depends on runtime state is out of scope."]);

  for (const [kind, text] of limits) {
    doc.circle(M + 2, limY + 3, 1.6).fill(kind === "warn" ? C.amber : C.blue);
    const h = paragraph(doc, text, M + 10, limY, CW - 10, { size: 6.4, color: C.ink3 });
    limY += h + 5;
  }

  footer(doc, report, "03 / 03");
}

/* ------------------------------------------------------------------ */

export function renderReportPdf(report: Report): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
      info: {
        Title: `${report.repo.fullName} — Health Report`,
        Author: "Haryn AI",
        Subject: `Health ${report.healthScore}/100 · ${severityCounts(report.findings).total} actionable findings`,
        CreationDate: new Date(report.completedAt),
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      pageOne(doc, report);
      pageTwo(doc, report);
      pageThree(doc, report);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
