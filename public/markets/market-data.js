// Eastmoney IDs include the exchange. Its 100.NDX identifies the Nasdaq Composite.
export const kindNames = {
  index: "指数",
  stock: "股票",
  etf: "ETF",
  fund: "基金",
};
export const places = {
  US: "美国",
  HK: "香港",
  JP: "日本",
  DE: "德国",
  UK: "英国",
  CN: "中国内地",
};
const instruments = [
  // Display code, feed ID, name, market, type, badge, Yahoo symbol for the daily archive.
  ["SPX", "100.SPX", "标普 500", "US", "index", "SP", "^GSPC"],
  ["HSI", "100.HSI", "恒生指数", "HK", "index", "恒", "^HSI"],
  ["N225", "100.N225", "日经 225", "JP", "index", "日", "^N225"],
  ["DAX", "100.GDAXI", "德国 DAX", "DE", "index", "DX", "^GDAXI"],
  ["IXIC", "100.NDX", "纳斯达克综合", "US", "index", "NQ", "^IXIC"],
  ["DJI", "100.DJIA", "道琼斯工业", "US", "index", "DJ", "^DJI"],
  ["FTSE", "100.FTSE", "富时 100", "UK", "index", "FT", "^FTSE"],
  ["SSE", "1.000001", "上证指数", "CN", "index", "沪", "000001.SS"],
  ["NVDA", "105.NVDA", "英伟达", "US", "stock", "N", "NVDA"],
  ["AAPL", "105.AAPL", "苹果", "US", "stock", "A", "AAPL"],
  ["00700", "116.00700", "腾讯控股", "HK", "stock", "腾", "0700.HK"],
  ["SPY", "107.SPY", "SPDR 标普 500 ETF", "US", "etf", "SP", "SPY"],
  ["MSFT", "105.MSFT", "微软", "US", "stock", "M", "MSFT"],
  ["09988", "116.09988", "阿里巴巴", "HK", "stock", "阿", "9988.HK"],
  ["QQQ", "105.QQQ", "景顺纳斯达克 100 ETF", "US", "etf", "QQ", "QQQ"],
  ["02800", "116.02800", "盈富基金 ETF", "HK", "etf", "盈", "2800.HK"],
  ["TSLA", "105.TSLA", "特斯拉", "US", "stock", "T", "TSLA"],
  ["ADX", "106.ADX", "亚当斯多元股票基金", "US", "fund", "AD", "ADX"],
  [
    "00823",
    "116.00823",
    "领展房地产投资信托基金",
    "HK",
    "fund",
    "领",
    "0823.HK",
  ],
  ["03033", "116.03033", "南方恒生科技 ETF", "HK", "etf", "科", "3033.HK"],
  ["FXAIX", "", "富达 500 指数基金", "US", "fund", "F", "FXAIX"],
];
const inks = {
  NVDA: ["#283720", "#b7e48b"],
  AAPL: ["#35383c", "#e2e5e7"],
  "00700": ["#253748", "#9bc9f0"],
  SPY: ["#343229", "#e4d493"],
  MSFT: ["#403028", "#efb499"],
  "09988": ["#402d21", "#edb378"],
  QQQ: ["#292d43", "#b2b8ed"],
  "02800": ["#203936", "#a1dfcd"],
  TSLA: ["#402b2c", "#efa8ab"],
};
export const catalog = instruments.map(
  ([code, id, name, market, kind, badge, yahoo]) => ({
    code,
    id,
    name,
    market,
    kind,
    badge,
    yahoo,
    colors: inks[code],
    unit: kind === "index" ? "点" : market === "HK" ? "HKD" : "USD",
  })
);
export const indexAssets = catalog.filter((a) => a.kind === "index");
export const ranges = [
  ["day", "分时"],
  ["week", "1周"],
  ["month", "1月"],
  ["quarter", "3月"],
  ["year", "1年"],
];
export const number = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
export const signed = (n) =>
  Number.isFinite(n)
    ? (n > 0 ? "+" : n < 0 ? "−" : "") + number.format(Math.abs(n))
    : "—";
export const tone = (n) => (n > 0 ? "up" : n < 0 ? "down" : "flat");
export const fmt = (n) => (Number.isFinite(n) ? number.format(n) : "—");
const quoteHost = "https://push2.eastmoney.com";
const chartHost = "https://push2his.eastmoney.com";
let sequence = 0;

// Both public feeds implement a named JSONP callback, including on static HTTPS hosts.
function request(host, route, params) {
  return new Promise((resolve, reject) => {
    const callback = "__tickline_" + ++sequence;
    const url = new URL(route, host);
    const script = document.createElement("script");
    url.search = new URLSearchParams({ ...params, cb: callback }).toString();
    const finish = () => {
      clearTimeout(timer);
      script.remove();
      delete window[callback];
    };
    const timer = setTimeout(() => {
      finish();
      reject(new Error("行情请求超时"));
    }, 8000);
    window[callback] = (result) => {
      finish();
      resolve(result);
    };
    script.onerror = () => {
      finish();
      reject(new Error("行情源连接失败"));
    };
    script.referrerPolicy = "no-referrer";
    script.src = url.href;
    document.head.append(script);
  });
}
function numeric(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
// A record always starts with [exchange timestamp, close], including older snapshots.
// Append real OHLC fields only when the provider reports a consistent price range.
export function chartPoint(stamp, close, open, high, low, volume) {
  const point = [stamp, close];
  if (
    Number.isFinite(open) &&
    open > 0 &&
    Number.isFinite(high) &&
    high >= Math.max(open, close) &&
    Number.isFinite(low) &&
    low > 0 &&
    low <= Math.min(open, close)
  ) {
    point.push(open, high, low);
    if (Number.isFinite(volume) && volume >= 0) point.push(volume);
  }
  return point;
}
export async function getQuotes(ids) {
  const result = await request(quoteHost, "/api/qt/ulist.np/get", {
    secids: ids.join(","),
    fields: "f2,f3,f4,f12,f13,f14,f18,f124",
    fltt: "2",
    invt: "2",
  });
  const rows = Object.values(result?.data?.diff ?? {});
  const quotes = new Map();
  for (const row of rows) {
    const price = numeric(row.f2),
      timestamp = numeric(row.f124);
    if (!(price > 0) || !(timestamp > 0)) continue;
    const id = row.f13 + "." + row.f12;
    if (!ids.includes(id)) continue;
    quotes.set(id, {
      price,
      percent: numeric(row.f3),
      change: numeric(row.f4),
      name: String(row.f14 ?? row.f12),
      time: timestamp * 1000,
      source: "东方财富",
    });
  }
  if (!quotes.size) throw new Error("报价源未返回有效报价");
  return quotes;
}
export async function getSeries(asset, intraday = false) {
  const params = intraday
    ? {
        ndays: "1",
        iscr: "0",
        fields1: "f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13",
        fields2: "f51,f52,f53,f54,f55,f56,f57,f58",
      }
    : {
        klt: "101",
        fqt: "0",
        beg: "0",
        end: "20500101",
        lmt: "265",
        fields1: "f1,f2,f3,f4,f5,f6",
        fields2: "f51,f52,f53,f54,f55,f56",
      };
  const path = intraday ? "trends2/get" : "kline/get";
  const result = await request(chartHost, "/api/qt/stock/" + path, {
    ...params,
    secid: asset.id,
  });
  const list = intraday ? result?.data?.trends : result?.data?.klines;
  if (!Array.isArray(list)) throw new Error("缺少走势");
  const points = new Map();
  for (const item of list) {
    const [stamp, open, raw, high, low, volume] = String(item).split(",");
    const close = numeric(raw);
    const pattern = intraday
      ? /^\d{4}-\d{2}-\d{2} \d\d:\d\d$/
      : /^\d{4}-\d{2}-\d{2}$/;
    if (pattern.test(stamp) && close > 0) {
      points.set(
        stamp,
        chartPoint(
          stamp,
          close,
          numeric(open),
          numeric(high),
          numeric(low),
          numeric(volume)
        )
      );
    }
  }
  if (!points.size) throw new Error("暂无走势");
  return {
    points: Array.from(points.values()).sort((a, b) =>
      a[0].localeCompare(b[0])
    ),
    source: "东方财富",
  };
}
export function periodPoints(points, range) {
  if (!points?.length || range === "day") return points ?? [];
  const last = new Date(points.at(-1)[0] + "T12:00:00Z");
  if (range === "week") last.setUTCDate(last.getUTCDate() - 7);
  else
    last.setUTCMonth(
      last.getUTCMonth() - ({ month: 1, quarter: 3, year: 12 }[range] ?? 3)
    );
  const since = last.toISOString().slice(0, 10);
  return points.filter(([date]) => date > since);
}
export const exchangeTime = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
