// Run the public release through its normal browser entry point, including its cross-origin price feeds.
const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");
const sites = {
  pages: "https://nonterreaplusultar-del.github.io/demo/markets/",
  vercel: "https://demo-nu-smoky-55.vercel.app/markets",
};
const url = sites[process.env.MARKET_SITE ?? "pages"];

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN,
    headless: true,
  });
  try {
    const page = await browser.newPage();
    // Poll the HTML without filling the browser's cache with the preceding release.
    const release = process.env.GITHUB_SHA;
    for (let attempt = 1; ; attempt++) {
      try {
        const probe = new URL(url);
        if (release) probe.searchParams.set("release", release);
        const response = await page.request.get(probe.href, { timeout: 15000 });
        assert.equal(response.status(), 200, `Failed to load ${url}`);
        assert.match(
          await response.text(),
          /\bid=["']?candle-mode\b/,
          `Waiting for the updated chart at ${url}`
        );
        break;
      } catch (error) {
        if (attempt === 12) throw error;
        await new Promise((done) => setTimeout(done, 10000));
      }
    }
    await page.goto(url, { waitUntil: "domcontentloaded" });
    assert.equal(await page.title(), "Tickline · 市场看板");
    assert.ok(
      await page.evaluate(async () => (await document.fonts.load('14px "Geist Mono"')).length > 0),
      "Market font failed to load"
    );
    await page.locator("#price").waitFor();
    await page.waitForFunction(
      () => document.querySelector("#price").textContent !== "—"
    );
    await page.waitForSelector('#plot[data-view="candles"]', {
      timeout: 40000,
    });
    assert.equal(await page.locator("#ohlc b").count(), 4);
    await page.locator("#line-mode").click();
    assert.equal(await page.locator("#plot").getAttribute("data-view"), "line");
    await page.locator("#candle-mode").click();
    assert.equal(
      await page.locator("#plot").getAttribute("data-view"),
      "candles"
    );
    console.log("Public route, OHLC chart and line switch loaded at", page.url());
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
    assert.equal(await page.locator("#plot").getAttribute("data-view"), "line");
    assert.equal(await page.locator("#candle-mode").isDisabled(), true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(
      () => document.querySelectorAll("#indices button").length === 2
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth),
      390
    );
    console.log("Daily fund NAV and mobile layout verified.");
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error.message);
  if (process.env.GITHUB_ACTIONS) {
    const message = error.message.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
    console.log(`::error title=Published market check failed::${message}`);
  }
  process.exitCode = 1;
});
