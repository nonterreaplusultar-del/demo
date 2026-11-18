// Build the small daily archive read by the static terminal. Failed symbols keep their dated records.
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { catalog } from "../public/markets/market-data.js";

export function closingSeries(result, now = Date.now()) {
  const meta = result?.meta;
  const prices = result?.indicators?.quote?.[0]?.close;
  if (!meta?.exchangeTimezoneName || !Array.isArray(prices))
    throw new Error("missing daily closes");
  const date = new Intl.DateTimeFormat("sv-SE", {
    timeZone: meta.exchangeTimezoneName,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const regular = meta.currentTradingPeriod?.regular;
  const unfinished =
    regular && now < regular.end * 1000
      ? date.format(regular.start * 1000)
      : null;
  const byDate = new Map();
  for (const [index, timestamp] of (result.timestamp ?? []).entries()) {
    const close = prices[index];
    if (
      !Number.isFinite(timestamp) ||
      timestamp * 1000 > now ||
      !Number.isFinite(close) ||
      close <= 0
    )
      continue;
    const tradingDate = date.format(timestamp * 1000);
    if (tradingDate !== unfinished)
      byDate.set(tradingDate, Number(close.toFixed(4)));
  }
  const points = Array.from(byDate)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-265);
  if (points.length < 2) throw new Error("insufficient completed sessions");
  return points;
}

export async function fetchHistory(asset, intraday = false) {
  const symbol = encodeURIComponent(asset.yahoo);
  const query = intraday ? "range=1d&interval=5m" : "range=1y&interval=1d";
  const response = await fetch(
    "https://query1.finance.yahoo.com/v8/finance/chart/" + symbol + "?" + query,
    {
      signal: AbortSignal.timeout(8000),
      headers: {
        Accept: "application/json",
        "User-Agent": "Tickline/1.0 (personal market dashboard)",
      },
    }
  );
  if (!response.ok) throw new Error("HTTP " + response.status);
  const json = await response.json(),
    result = json.chart?.result?.[0],
    meta = result?.meta;
  if (!meta?.exchangeTimezoneName) throw new Error("missing exchange timezone");
  const day = new Intl.DateTimeFormat("sv-SE", {
    timeZone: meta.exchangeTimezoneName,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  let points;
  if (intraday) {
    const minute = new Intl.DateTimeFormat("sv-SE", {
      timeZone: meta.exchangeTimezoneName,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    const closes = result.indicators?.quote?.[0]?.close ?? [];
    points = (result.timestamp ?? []).flatMap((t, i) =>
      Number.isFinite(t) && Number.isFinite(closes[i]) && closes[i] > 0
        ? [
            [
              day.format(t * 1000) + " " + minute.format(t * 1000),
              Number(closes[i].toFixed(4)),
            ],
          ]
        : []
    );
    if (!points.length) throw new Error("missing intraday bars");
  } else points = closingSeries(result);
  const time = meta.regularMarketTime * 1000,
    price = meta.regularMarketPrice;
  let quote = null;
  if (
    Number.isFinite(time) &&
    time > 0 &&
    Number.isFinite(price) &&
    price > 0
  ) {
    const session = day.format(time);
    const previous = intraday
      ? meta.previousClose ?? meta.chartPreviousClose
      : points.findLast((p) => p[0] < session)?.[1];
    const change =
      Number.isFinite(previous) && previous > 0 ? price - previous : null;
    quote = {
      price,
      time,
      change,
      percent: change === null ? null : (change / previous) * 100,
      source: "Yahoo Finance",
    };
  }
  return {
    source: "Yahoo Finance",
    url: "https://finance.yahoo.com/quote/" + symbol + "/history/",
    points,
    quote,
  };
}
async function main(input, output) {
  if (!input || !output)
    throw new Error(
      "Usage: node script/market-close.mjs PREVIOUS.json OUTPUT.json"
    );
  const archive = JSON.parse(await readFile(input, "utf8"));
  let succeeded = 0;
  for (const asset of catalog) {
    try {
      const { quote, ...row } = await fetchHistory(asset);
      if (
        (archive[asset.code]?.points?.at(-1)?.[0] ?? "") <= row.points.at(-1)[0]
      )
        archive[asset.code] = row;
      succeeded++;
    } catch (error) {
      console.error(asset.code + ": " + error.message);
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  if (!succeeded)
    throw new Error("No provider response. The previous archive is retained.");
  await writeFile(output, JSON.stringify(archive) + "\n");
  console.log(
    "Updated " + succeeded + " of " + catalog.length + " instruments."
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main(...process.argv.slice(2));
}
