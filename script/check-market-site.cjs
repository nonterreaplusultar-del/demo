// Run the public release through its normal browser entry point, including its cross-origin price feeds.
const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");
const url = "https://nonterreaplusultar-del.github.io/demo/markets/";

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN,
    headless: true,
  });
  try {
    const page = await browser.newPage();
    let response;
    for (let attempt = 0; attempt < 5; attempt++) {
      response = await page.goto(url, { waitUntil: "domcontentloaded" });
      if (response?.ok()) break;
      await new Promise((done) => setTimeout(done, 10000));
    }
    assert.equal(response?.status(), 200, "Pages did not return the terminal");
    assert.equal(await page.title(), "Tickline · 市场看板");
    await page.locator("#price").waitFor();
    await page.waitForFunction(
      () => document.querySelector("#price").textContent !== "—"
    );
    console.log("Public Pages route and chart loaded.");
    await page.waitForFunction(
      () =>
        document.querySelector("#feed-status").classList.contains("connected"),
      {},
      { timeout: 120000 }
    );
    console.log(
      "Quote feed:",
      await page.locator("#feed-status").textContent()
    );
    await page.locator("#indices [data-code=HSI]").click();
    await page.waitForFunction(
      () => document.querySelector("#quote-asof").textContent.includes("报价 "),
      {},
      { timeout: 40000 }
    );
    await page.locator("#ranges [data-range=day]").click();
    await page.waitForFunction(
      () =>
        /分时价走势，\d{4}-\d\d-\d\d \d\d:\d\d/.test(
          document.querySelector("#plot").getAttribute("aria-label")
        ),
      {},
      { timeout: 40000 }
    );
    console.log("Hong Kong intraday chart loaded with exchange timestamps.");
    await page.locator("#start-search").click();
    await page.locator("#search-input").fill("FXAIX");
    await page.locator("#search-input").press("Enter");
    await page.waitForFunction(
      () =>
        document.querySelector("#asset-meta").textContent.includes("FXAIX") &&
        document.querySelector("#price").textContent !== "—"
    );
    assert.equal(await page.locator("[data-range=day]").isDisabled(), true);
    console.log("Daily fund NAV loaded.");
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
