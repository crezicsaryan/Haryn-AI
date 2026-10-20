/**
 * Screenshot the logo at its real sizes, plus the favicon.
 *
 * The logo has to read at 26px and at 38px, and the favicon at 16px — a shape
 * that looks right large can turn to mush small, so both are checked.
 */
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = path.join("reports", "logo");

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  // The logo in the nav, at 3× for a close look.
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 3,
  });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.locator("header").first().screenshot({ path: path.join(OUT, "logo-nav.png") });

  // Close-up of the mark alone, so the tile, the node and the wordmark can be
  // judged at the size a designer would look at them.
  await page.locator('header a[aria-label="Haryn AI home"]').first()
    .screenshot({ path: path.join(OUT, "logo-closeup.png") });

  // The favicon, which is the same mark at 32px.
  const icon = await browser.newPage({
    viewport: { width: 128, height: 128 },
    deviceScaleFactor: 4,
  });
  const res = await icon.goto(`${BASE}/icon.svg`, { waitUntil: "networkidle" });
  await icon.screenshot({ path: path.join(OUT, "icon.png") });

  console.log(
    JSON.stringify(
      {
        nav: path.join(OUT, "logo-nav.png"),
        icon: path.join(OUT, "icon.png"),
        iconStatus: res.status(),
      },
      null,
      2
    )
  );

  await browser.close();
})();
