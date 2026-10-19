const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "shots");
fs.mkdirSync(OUT, { recursive: true });

const BASE = process.env.BASE || "http://localhost:3000";

// Report views are keyed by a rail; the knowledge graph sits behind the
// "Knowledge graph" entry. We click it rather than deep-linking so the shot
// proves the view is actually reachable through the UI.
async function openGraphView(page) {
  const rail = page.locator('nav[aria-label="Report views"]');
  await rail.waitFor({ state: "visible", timeout: 20000 });
  const btn = rail.getByRole("button", { name: /knowledge graph/i }).first();
  await btn.click();
  await page.waitForTimeout(3200); // let the graph settle + camera fit
}

(async () => {
  const browser = await chromium.launch();
  const log = [];

  // ---------- Desktop, sample report ----------
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });

  await page.goto(`${BASE}/report/an_sample`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  // Is the graph view reachable without scrolling? Measure before clicking.
  const railBox = await page
    .locator('nav[aria-label="Report views"]')
    .boundingBox();
  log.push(`view rail box: ${JSON.stringify(railBox)}`);

  await openGraphView(page);
  await page.screenshot({ path: path.join(OUT, "KG-01-sample-3d-top.png") });

  // Measure the canvas — proves it is on-screen and sized.
  const canvasInfo = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return {
      cssW: Math.round(r.width),
      cssH: Math.round(r.height),
      top: Math.round(r.top),
      viewportH: window.innerHeight,
      visiblePx: Math.round(Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0))),
      pixels: `${c.width}x${c.height}`,
    };
  });
  log.push(`sample canvas: ${JSON.stringify(canvasInfo)}`);

  // Count distinct colours drawn — a blank canvas would be ~1.
  const colours = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    if (!c) return -1;
    const ctx = c.getContext("2d");
    if (!ctx) return -1;
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const set = new Set();
    for (let i = 0; i < d.length; i += 4 * 37) {
      set.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
    }
    return set.size;
  });
  log.push(`sample distinct colours: ${colours}`);

  // 2D renderer toggle.
  const twoD = page.getByRole("button", { name: /^2d$/i }).first();
  if (await twoD.count()) {
    await twoD.click();
    await page.waitForTimeout(2600);
    await page.screenshot({ path: path.join(OUT, "KG-02-sample-2d.png") });
    const n = await page.evaluate(
      () => document.querySelectorAll(".react-flow__node").length,
    );
    log.push(`2D nodes rendered: ${n}`);
    const back = page.getByRole("button", { name: /^3d$/i }).first();
    if (await back.count()) {
      await back.click();
      await page.waitForTimeout(2200);
    }
  }

  // ---------- Mobile ----------
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  await mobile.goto(`${BASE}/report/an_sample`, { waitUntil: "networkidle" });
  await mobile.waitForTimeout(1500);
  // Mobile collapses the rail into a switcher.
  const sw = mobile.getByRole("button", { name: /graph|knowledge/i }).first();
  if (await sw.count()) {
    await sw.click();
    await mobile.waitForTimeout(2600);
  }
  await mobile.screenshot({ path: path.join(OUT, "KG-03-mobile.png") });
  const mCanvas = await mobile.evaluate(() => {
    const c = document.querySelector("canvas");
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { cssW: Math.round(r.width), cssH: Math.round(r.height) };
  });
  log.push(`mobile canvas: ${JSON.stringify(mCanvas)}`);

  // ---------- The real repo graph, if it is present ----------
  const realId = "an_mv8z3p0ljiwyjm";
  const probe = await page.goto(`${BASE}/report/${realId}`, {
    waitUntil: "networkidle",
  });
  log.push(`real repo status: ${probe ? probe.status() : "n/a"}`);
  if (probe && probe.ok()) {
    await page.waitForTimeout(1200);
    await openGraphView(page);
    await page.screenshot({ path: path.join(OUT, "KG-04-real-repo-3d.png") });
    const realCanvas = await page.evaluate(() => {
      const c = document.querySelector("canvas");
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { cssW: Math.round(r.width), cssH: Math.round(r.height), pixels: `${c.width}x${c.height}` };
    });
    log.push(`real canvas: ${JSON.stringify(realCanvas)}`);
  }

  await browser.close();
  log.push(`page errors: ${errors.length ? errors.slice(0, 5).join(" | ") : "none"}`);
  console.log(log.join("\n"));
})().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
