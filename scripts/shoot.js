const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "shots");
fs.mkdirSync(OUT, { recursive: true });

const BASE = "http://localhost:3000";

(async () => {
  const browser = await chromium.launch();

  // ---------- Desktop ----------
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(2200);
  await page.screenshot({ path: path.join(OUT, "01-landing-hero.png") });

  // Features grid
  await page.evaluate(() => document.getElementById("analyze")?.scrollIntoView());
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, "02-landing-coverage.png") });

  // How it works
  await page.evaluate(() => document.getElementById("how")?.scrollIntoView());
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, "03-landing-how.png") });

  // Principle + FAQ
  await page.evaluate(() => document.getElementById("principle")?.scrollIntoView());
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, "04-landing-principle.png") });

  // ---------- Report ----------
  await page.goto(`${BASE}/report/an_sample`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2600);
  await page.screenshot({ path: path.join(OUT, "05-report-top.png") });

  await page.evaluate(() => document.getElementById("scores")?.scrollIntoView());
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, "06-report-scores.png") });

  await page.evaluate(() => document.getElementById("findings")?.scrollIntoView());
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, "07-report-findings.png") });

  // Expand the first finding
  try {
    await page.locator("#findings button[aria-expanded]").first().click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, "08-report-finding-open.png") });
  } catch {
    /* ignore */
  }

  await page.evaluate(() => document.getElementById("architecture")?.scrollIntoView());
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(OUT, "09-report-architecture.png") });

  await page.evaluate(() => document.getElementById("ai")?.scrollIntoView());
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, "10-report-ai.png") });

  await page.evaluate(() => document.getElementById("actions")?.scrollIntoView());
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, "11-report-actions.png") });

  // ---------- Mobile ----------
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  await mobile.goto(BASE, { waitUntil: "networkidle" });
  await mobile.waitForTimeout(2000);
  await mobile.screenshot({ path: path.join(OUT, "12-mobile-landing.png") });

  await mobile.goto(`${BASE}/report/an_sample`, { waitUntil: "networkidle" });
  await mobile.waitForTimeout(2200);
  await mobile.screenshot({ path: path.join(OUT, "13-mobile-report.png") });

  // ---------- Tablet ----------
  const tablet = await browser.newPage({
    viewport: { width: 768, height: 1024 },
    deviceScaleFactor: 2,
  });
  await tablet.goto(BASE, { waitUntil: "networkidle" });
  await tablet.waitForTimeout(1800);
  await tablet.screenshot({ path: path.join(OUT, "14-tablet-landing.png") });

  await browser.close();
  console.log("screenshots written to", OUT);
  console.log(fs.readdirSync(OUT).join("\n"));
})().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
