// A free-tier Vercel Function. A fixed symbol catalog bounds upstream destinations and cache keys.
import { catalog } from "../public/markets/market-data.js";
import { fetchHistory } from "../script/market-close.mjs";

export default async function marketHistory(request, response) {
  const params = new URL(request.url, "http://localhost").searchParams;
  const asset = catalog.find((a) => a.code === params.get("symbol"));
  const range = params.get("range") ?? "daily";
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader(
    "Access-Control-Allow-Origin",
    "https://nonterreaplusultar-del.github.io"
  );
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.statusCode = 405;
    return response.end("{}");
  }
  if (
    !asset ||
    !["daily", "day"].includes(range) ||
    (!asset.id && range === "day")
  ) {
    response.statusCode = 400;
    return response.end('{"error":"unknown symbol or interval"}');
  }
  try {
    const data = await fetchHistory(asset, range === "day");
    response.setHeader(
      "Cache-Control",
      "public, max-age=30, s-maxage=" +
        (!asset.id ? 1800 : 60) +
        ", stale-while-revalidate=120"
    );
    response.end(JSON.stringify(data));
  } catch {
    response.setHeader("Cache-Control", "no-store");
    response.statusCode = 502;
    response.end('{"error":"market data temporarily unavailable"}');
  }
}
