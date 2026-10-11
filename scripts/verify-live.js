/**
 * End-to-end verification: runs a real analysis against a live GitHub repo,
 * prints the key figures, then screenshots the resulting report.
 *
 * Usage:  NODE_PATH=<managed node workspace>/node_modules node scripts/verify-live.js [owner/repo]
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const REPO = process.argv[2] || "crezicsaryan/gym-saathi";
const BASE = "http://localhost:3000";
const OUT = path.join(__dirname, "shots");
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  /* ---- 1. Run the analysis ---- */
  const res = await fetch(`${BASE}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repositoryUrl: `https://github.com/${REPO}` }),
  });

  const text = await res.text();
  const events = text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

  const result = events.find((e) => e.type === "result");
  const error = events.find((e) => e.type === "error");

  if (!result) {
    console.error("ANALYSIS FAILED:", JSON.stringify(error ?? events.at(-1)));
    process.exit(1);
  }

  const r = result.report;
  const counts = r.findings.reduce((a, f) => ((a[f.severity] = (a[f.severity] || 0) + 1), a), {});

  console.log("=".repeat(66));
  console.log(`  ${r.repo.fullName}  —  health ${r.healthScore}/100`);
  console.log("=".repeat(66));
  console.log(`files/dirs    : ${r.structure.fileCount} / ${r.structure.dirCount}  (${r.structure.sizeClass})`);
  console.log(`scanned       : ${r.stats.sourceFilesSampled} files, ${(r.stats.bytesAnalyzed / 1024).toFixed(0)} KB`);
  console.log(`languages     : ${r.languages.map((l) => `${l.name} ${l.percent.toFixed(0)}%`).join(", ")}`);
  console.log(`scores        : ${r.scores.map((s) => `${s.label} ${s.score}`).join(" | ")}`);
  console.log(`findings      : ${r.findings.length}  ${JSON.stringify(counts)}`);
  console.log(`dependencies  : ${JSON.stringify(r.dependencies.stat)}`);
  console.log(`testing       : ${r.testing.testFiles}/${r.testing.sourceFiles}  [${r.testing.frameworks.join(", ") || "no framework"}]`);
  console.log(`architecture  : ${r.architecture.nodes.map((n) => n.id).join(", ")}`);
  console.log(`duration      : ${r.durationMs}ms  (${r.stats.apiCalls} API calls)`);
  console.log("-".repeat(66));
  r.findings.slice(0, 10).forEach((f) =>
    console.log(`  [${f.severity.toUpperCase().padEnd(8)}] ${f.title} — ${f.filePath || "(repo-wide)"}${f.lineStart ? ":" + f.lineStart : ""}`)
  );
  console.log("=".repeat(66));

  /* ---- 2. Screenshot the report ---- */
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

  await page.goto(`${BASE}/report/${r.id}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2600);
  await page.screenshot({ path: path.join(OUT, "L1-live-report-top.png") });

  await page.evaluate(() => document.getElementById("findings")?.scrollIntoView());
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, "L2-live-findings.png") });

  // Expand the top finding
  try {
    await page.locator("#findings button[aria-expanded]").first().click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, "L3-live-finding-open.png") });
  } catch {}

  await page.evaluate(() => document.getElementById("architecture")?.scrollIntoView());
  await page.waitForTimeout(1700);
  await page.screenshot({ path: path.join(OUT, "L4-live-architecture.png") });

  await browser.close();
  console.log(`report id ${r.id} → screenshots in scripts/shots/`);
})().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
