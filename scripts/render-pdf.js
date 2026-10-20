/**
 * Render the three-page PDF report.
 *
 * Usage:
 *   node scripts/render-pdf.js [analysisId] [outputPath]
 *
 * Produces the PDF and one PNG per page so the layout can be reviewed without a
 * PDF viewer. Print media is emulated for both, so the PNG is what the PDF
 * contains — a screenshot of the screen view would not be.
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const id = process.argv[2] || process.env.REPORT_ID;
const out = process.argv[3] || path.join("reports", "haryn-health-report.pdf");

if (!id) {
  console.error("usage: node scripts/render-pdf.js <analysisId> [output.pdf]");
  process.exit(1);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1240, height: 1754 } });

  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  const url = `${BASE}/report/${id}/print`;
  const res = await page.goto(url, { waitUntil: "networkidle" });
  if (!res || res.status() !== 200) {
    console.error(`page returned ${res ? res.status() : "no response"}: ${url}`);
    await browser.close();
    process.exit(1);
  }

  // The PDF is the print layout, not the screen layout.
  await page.emulateMedia({ media: "print" });
  await page.evaluate(() => document.fonts?.ready);

  const pageCount = await page.locator(".page").count();
  const overflow = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".page")).map((el, i) => ({
      page: i + 1,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      overflow: el.scrollHeight - el.clientHeight,
    }))
  );

  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.pdf({
    path: out,
    format: "A4",
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    preferCSSPageSize: true,
  });

  // One PNG per page, at A4 proportions (96 dpi), for visual review.
  const shots = [];
  const pages = page.locator(".page");
  for (let i = 0; i < pageCount; i++) {
    const file = out.replace(/\.pdf$/, `-p${i + 1}.png`);
    await pages.nth(i).screenshot({ path: file });
    shots.push(file);
  }

  const stat = fs.statSync(out);
  console.log(
    JSON.stringify(
      {
        url,
        pdf: out,
        bytes: stat.size,
        pages: pageCount,
        overflow,
        screenshots: shots,
        errors,
      },
      null,
      2
    )
  );

  await browser.close();
})();
