const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "shots");
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE || "http://localhost:3000";

/*
 * Asks a real question in the real UI and captures the answer.
 *
 * The point of the shot is that the answer is *derived*: it names a file and a
 * line, describes the role of the match, and walks the call order. A screenshot
 * of the JSON API would not prove the panel renders it correctly.
 */
const QUESTIONS = [
  "How does the scoring work?",
  "Analyse the facebook/react repository",
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 2,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  const report = process.env.REPORT || "/report/an_mvej5wzi9qtlxx";
  await page.goto(`${BASE}${report}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  // Collapse the provider panel: it is diagnostic, and left open it pushes the
  // actual answer out of frame, which is the thing the shot is meant to show.
  const providerToggle = page.getByRole("button", { name: /AI provider/i }).first();
  if ((await providerToggle.count()) > 0) {
    const expanded = await providerToggle.getAttribute("aria-expanded");
    if (expanded !== "false") await providerToggle.click();
    await page.waitForTimeout(600);
  }

  const input = page.getByPlaceholder(/ask a question about this repository/i).first();
  await input.waitFor({ state: "visible", timeout: 20000 });

  const out = { report, errors, answers: [] };

  for (let i = 0; i < QUESTIONS.length; i++) {
    await input.fill(QUESTIONS[i]);
    await page.getByRole("button", { name: /send question/i }).first().click();
    // The answer streams in; wait for the text to stop changing.
    let prev = "";
    for (let t = 0; t < 40; t++) {
      await page.waitForTimeout(500);
      const now = await page.locator("body").innerText();
      if (now === prev && t > 4) break;
      prev = now;
    }
    // Show the answer from its first line: scroll the element that opens the
    // answer to the top of its scroll container rather than to the bottom.
    await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll("aside *"));
      // The newest answer is the last matching element, not the first — the
      // previous answer is still in the DOM above it.
      const openers = all.filter((el) =>
        /^(the clearest match|the closest code|i can only answer)/i.test(
          (el.textContent || "").trim()
        )
      );
      const opener = openers[openers.length - 1];
      if (opener) opener.scrollIntoView({ block: "start" });
    });
    await page.waitForTimeout(400);
    out.answers.push({ question: QUESTIONS[i], chars: prev.length });
    await page.screenshot({
      path: path.join(OUT, `answer-${i + 1}.png`),
      fullPage: false,
    });
  }

  await browser.close();
  console.log(JSON.stringify(out, null, 2));
})();
