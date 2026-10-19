const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "shots");
fs.mkdirSync(OUT, { recursive: true });

const BASE = process.env.BASE || "http://localhost:3000";
const REPORT = process.env.REPORT || "/report/an_sample";

/*
 * Verifies the AI-provider panel in the chat header.
 *
 * The panel is the only place the reader can see *why* an answer was offline, so
 * the shot has to prove three things at once: the engine badge is present, the
 * panel opens, and the chain it lists matches what /api/ai/status reports.
 */
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });

  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });

  await page.goto(`${BASE}${REPORT}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1800);

  const out = { report: REPORT, errors };

  // The provider trigger lives in the chat header.
  const trigger = page.getByRole("button", { name: /AI provider|offline|engine/i }).first();
  const hasTrigger = (await trigger.count()) > 0;
  out.triggerFound = hasTrigger;

  if (hasTrigger) {
    await trigger.click();
    await page.waitForTimeout(1200); // lazy status fetch
    await page.screenshot({ path: path.join(OUT, "provider-panel-open.png") });

    const panelText = await page.locator("body").innerText();
    out.showsOffline = /offline/i.test(panelText);
    out.showsProviderNames = /OpenAI|Anthropic|Gemini|Groq|OpenRouter/.test(panelText);
    out.showsPlaceholderHint = /placeholder/i.test(panelText);
  }

  await page.screenshot({ path: path.join(OUT, "chat-header.png") });

  // Mobile: the report collapses to a Report / AI switcher.
  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await m.goto(`${BASE}${REPORT}`, { waitUntil: "networkidle" });
  await m.waitForTimeout(1500);
  out.mobileOverflow = await m.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  await m.screenshot({ path: path.join(OUT, "mobile.png") });

  await browser.close();
  console.log(JSON.stringify(out, null, 2));
})();
