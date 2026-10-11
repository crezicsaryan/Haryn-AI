/**
 * Verifies the retrieval + AI layer end to end.
 *
 * Runs a real analysis, reports the index size, then asks a set of questions
 * through /api/chat and prints the answers with their retrieved sources.
 * Finally drives the chat UI in a browser and screenshots it.
 *
 * Usage: NODE_PATH=<managed node workspace>/node_modules node scripts/verify-ai.js [owner/repo]
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const REPO = process.argv[2] || "crezicsaryan/gym-saathi";
const BASE = "http://localhost:3000";
const OUT = path.join(__dirname, "shots");
fs.mkdirSync(OUT, { recursive: true });

const QUESTIONS = [
  "How does authentication work?",
  "Where is the database connection configured?",
  "Which files should I improve first?",
  "How does the payment flow work?",
];

async function ask(id, question) {
  const res = await fetch(`${BASE}/api/chat/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: question }),
  });
  return res.json();
}

(async () => {
  /* ---- 1. Analyse ---- */
  console.log("analysing", REPO, "…");
  const res = await fetch(`${BASE}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repositoryUrl: `https://github.com/${REPO}` }),
  });

  const events = (await res.text())
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

  const result = events.find((e) => e.type === "result");
  if (!result) {
    console.error("ANALYSIS FAILED:", JSON.stringify(events.at(-1)));
    process.exit(1);
  }

  const r = result.report;
  console.log("=".repeat(70));
  console.log(`  ${r.repo.fullName}  —  health ${r.healthScore}/100`);
  console.log(`  summary engine : ${r.summaryEngine}`);
  console.log(`  chunks indexed : ${r.stats.indexedChunks}`);
  console.log(`  files scanned  : ${r.stats.sourceFilesSampled}`);
  console.log(`  duration       : ${r.durationMs}ms`);
  console.log("=".repeat(70));

  /* ---- 2. Ask questions ---- */
  for (const q of QUESTIONS) {
    console.log(`\n${"─".repeat(70)}\nQ: ${q}\n${"─".repeat(70)}`);
    const a = await ask(r.id, q);
    if (a.error) {
      console.log("ERROR:", a.error.message);
      continue;
    }
    console.log(`engine: ${a.engine}   grounded in: ${a.groundedIn} excerpts`);
    console.log(a.answer);
    if (a.matches?.length) {
      console.log("\nretrieved:");
      a.matches.slice(0, 5).forEach((m) =>
        console.log(
          `  ${m.score.toFixed(2)}  ${m.path}:${m.line}${m.symbol ? `  (${m.symbol})` : ""}  [${m.reasons.join(", ")}]`
        )
      );
    }
  }

  /* ---- 3. Screenshot the chat UI ---- */
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 }, deviceScaleFactor: 2 });
  await page.goto(`${BASE}/report/${r.id}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await page.evaluate(() => document.getElementById("ai")?.scrollIntoView());
  await page.waitForTimeout(1200);

  try {
    const input = page.locator('input[aria-label="Ask a question about this repository"]');
    await input.fill("How does authentication work?");
    await input.press("Enter");
    await page.waitForTimeout(4500);
    // Reveal the retrieved sources panel.
    const toggle = page.locator("button:has-text('retrieved source')").first();
    if (await toggle.count()) {
      await toggle.click();
      await page.waitForTimeout(700);
    }
    await page.evaluate(() => document.getElementById("ai")?.scrollIntoView());
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, "A1-live-chat.png") });
    console.log("\nchat screenshot → scripts/shots/A1-live-chat.png");
  } catch (e) {
    console.log("screenshot step skipped:", e.message);
  }

  await browser.close();
})().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
