import {
  catalog,
  indexAssets,
  kindNames,
  places,
  ranges,
  fmt,
  signed,
  tone,
  exchangeTime,
  getQuotes,
  chartPoint,
  getSeries,
  periodPoints,
} from "./market-data.js";
import { makePlot } from "./plot.js";

const $ = (id) => document.getElementById(id);
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function read(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem("tickline.v1." + key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try {
    localStorage.setItem("tickline.v1." + key, JSON.stringify(value));
  } catch {
    /* The dashboard also works without storage. */
  }
}
const savedCustom = read("custom", []);
const custom = Array.isArray(savedCustom)
  ? savedCustom
      .filter(
        (a) =>
          a &&
          /^(105|106|107|116)\.[A-Z0-9.-]{1,12}$/.test(a.id) &&
          typeof a.name === "string" &&
          ["US", "HK"].includes(a.market) &&
          ["stock", "etf", "fund"].includes(a.kind) &&
          /^[A-Z0-9.-]{1,12}$/.test(a.code)
      )
      .slice(0, 30)
  : [];
const assets = [
  ...catalog,
  ...custom.filter((c) => !catalog.some((a) => a.code === c.code)),
];
const resolve = (code) => assets.find((a) => a.code === code);
const savedStars = read("stars", []);
const stars = new Set(
  Array.isArray(savedStars) ? savedStars.filter(resolve) : []
);
let current =
  resolve(new URLSearchParams(location.search).get("symbol")) ?? catalog[0];
let stylePreference = read("chartStyle", null);
const compactTape = matchMedia("(max-width: 600px)");
let chosenRange = "quarter",
  market = "all",
  kind = "all",
  onlyStars = false,
  indexPage = 0;
let automatic = read("auto", true) !== false,
  fetching = false,
  phase = "waiting",
  lastCheck = 0;
let pollTimer,
  archiveBusy = false,
  archiveRead = 0;
const quotes = new Map(
  Object.entries(read("quotes", {}) || {}).filter(
    ([code, q]) => resolve(code) && q && q.price > 0 && Number.isFinite(q.time)
  )
);
const archive = new Map();
const seriesCache = new Map();
const pendingSeries = new Set(),
  pendingBackup = new Map();
const draw = makePlot(
  $("plot"),
  $("chart"),
  $("plot-tip"),
  $("plot-empty"),
  $("ohlc")
);
const dayFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "long",
});
const clockFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Shanghai",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const zones = {
  US: "America/New_York",
  HK: "Asia/Hong_Kong",
  JP: "Asia/Tokyo",
  CN: "Asia/Shanghai",
  DE: "Europe/Berlin",
  UK: "Europe/London",
};
const dayFormatters = Object.fromEntries(
  Object.entries(zones).map(([k, timeZone]) => [
    k,
    new Intl.DateTimeFormat("sv-SE", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }),
  ])
);
function updateClock() {
  const now = new Date();
  $("clock").textContent = clockFormatter.format(now);
  $("clock").title = dayFormatter.format(now);
}
function cleanPoints(list, intraday = false) {
  if (!Array.isArray(list)) return [];
  const pattern = intraday
    ? /^\d{4}-\d{2}-\d{2} \d\d:\d\d$/
    : /^\d{4}-\d{2}-\d{2}$/;
  return list
    .filter(
      (p) =>
        Array.isArray(p) &&
        pattern.test(p[0]) &&
        Number.isFinite(p[1]) &&
        p[1] > 0
    )
    .slice(-1600)
    .map(([stamp, close, open, high, low, volume]) =>
      chartPoint(stamp, close, open, high, low, volume)
    );
}
function preferSeries(first, second) {
  if (!first) return second;
  if (!second) return first;
  const a = first.points.at(-1),
    b = second.points.at(-1);
  if (a[0] !== b[0]) return a[0] > b[0] ? first : second;
  // A previously cached close-only response must not hide a full candle on the same date.
  if (a.length < 5 && b.length >= 5) return second;
  return first;
}
function mergeArchive(data, remote) {
  if (!data || typeof data !== "object") return;
  for (const [code, row] of Object.entries(data)) {
    if (!resolve(code) || !row || typeof row.source !== "string") continue;
    const points = cleanPoints(row.points);
    if (!points.length) continue;
    const next = { ...row, points },
      prior = archive.get(code);
    archive.set(
      code,
      remote ? preferSeries(next, prior) : preferSeries(prior, next)
    );
  }
}
function history(asset, intraday = false) {
  const key = asset.code + (intraday ? ".m" : ".d");
  if (!seriesCache.has(key)) {
    const stored = read("series." + key, null),
      points = cleanPoints(stored?.points, intraday);
    seriesCache.set(key, points.length ? { ...stored, points } : null);
  }
  const data = seriesCache.get(key);
  return intraday ? data : preferSeries(data, archive.get(asset.code));
}
function quote(asset) {
  const live = quotes.get(asset.code);
  const backup = history(asset),
    list = backup?.points;
  const day = live ? dayFormatters[asset.market].format(live.time) : "";
  if (live && (!list || day >= list.at(-1)[0]))
    return {
      ...live,
      stamp: exchangeTime.format(live.time) + " 北京时间",
      day,
      archive: false,
    };
  if (!list?.length) return null;
  const [date, price] = list.at(-1),
    previous = list.at(-2)?.[1];
  const change = previous ? price - previous : null;
  return {
    price,
    change,
    percent: Number.isFinite(backup.percent)
      ? backup.percent
      : previous
      ? (change / previous) * 100
      : null,
    stamp: date,
    day: date,
    source: backup.source,
    archive: true,
  };
}
function describe(q) {
  return !q ? "等待报价" : q.archive ? "收盘 " + q.day : "报价 " + q.stamp;
}
function deltaText(n) {
  return Number.isFinite(n) ? signed(n) + "%" : "—";
}
function indexGroupSize() {
  return compactTape.matches ? 2 : 4;
}
function visibleIndices() {
  const size = indexGroupSize();
  return indexAssets.slice(indexPage * size, (indexPage + 1) * size);
}
function renderIndices() {
  $("index-page").textContent =
    indexPage + 1 + " / " + Math.ceil(indexAssets.length / indexGroupSize());
  $("indices").replaceChildren(
    ...visibleIndices().map((a) => {
      const q = quote(a),
        btn = el("button", "index-quote");
      btn.dataset.code = a.code;
      btn.setAttribute("aria-pressed", String(a === current));
      btn.title = a.name + " · " + describe(q);
      btn.setAttribute(
        "aria-label",
        a.name +
          " " +
          fmt(q?.price) +
          "，日涨跌 " +
          deltaText(q?.percent) +
          "，" +
          describe(q)
      );
      const title = el("span", "index-title");
      title.append(el("b", "", a.name));
      if (!a.name.includes(a.code))
        title.append(el("span", "index-symbol", a.code));
      const values = el("span", "index-values");
      values.append(
        el("span", "index-price", fmt(q?.price)),
        el("span", "index-delta " + tone(q?.percent), deltaText(q?.percent))
      );
      btn.append(title, values);
      return btn;
    })
  );
}
function renderWatch() {
  const list = assets.filter(
    (a) =>
      (onlyStars
        ? stars.has(a.code)
        : a.kind !== "index" || kind === "index") &&
      (market === "all" || a.market === market) &&
      (kind === "all" || a.kind === kind)
  );
  $("watch-title").textContent = onlyStars ? "我的自选" : "市场行情";
  $("list-count").textContent = list.length;
  $("list-count").setAttribute("aria-label", list.length + " 个品种");
  $("kind-text").textContent = $("kind").selectedOptions[0].text;
  $("overview-tab").classList.toggle("active", !onlyStars);
  $("stars-tab").classList.toggle("active", onlyStars);
  $("overview-tab").setAttribute("aria-pressed", String(!onlyStars));
  $("stars-tab").setAttribute("aria-pressed", String(onlyStars));
  for (const b of $("market-filter").children)
    b.setAttribute("aria-pressed", String(b.dataset.market === market));
  const focused = $("watch-rows").contains(document.activeElement)
    ? document.activeElement.dataset.code
    : null;
  $("watch-rows").replaceChildren(
    ...list.map((a) => {
      const q = quote(a),
        btn = el("button", "watch-row");
      btn.dataset.code = a.code;
      btn.setAttribute("aria-pressed", String(a === current));
      btn.title = a.name + " · " + describe(q);
      btn.setAttribute(
        "aria-label",
        a.code +
          " " +
          a.name +
          "，" +
          fmt(q?.price) +
          "，日涨跌 " +
          deltaText(q?.percent) +
          "，" +
          describe(q)
      );
      const id = el("span", "row-id");
      id.append(el("strong", "", a.code), el("small", "", a.name));
      btn.append(
        id,
        el("span", "row-price", fmt(q?.price)),
        el("span", "row-delta " + tone(q?.percent), deltaText(q?.percent))
      );
      return btn;
    })
  );
  if (!list.length)
    $("watch-rows").append(
      el(
        "p",
        "empty-list",
        onlyStars && !stars.size
          ? "点击品种名称旁的星标，即可加入自选。"
          : "当前筛选下没有品种。"
      )
    );
  if (focused)
    Array.from($("watch-rows").children)
      .find((b) => b.dataset.code === focused)
      ?.focus({ preventScroll: true });
}
function renderDetail() {
  const a = current,
    q = quote(a),
    intraday = chosenRange === "day",
    h = history(a, intraday);
  const saved = stars.has(a.code);
  $("asset-code").textContent = a.code;
  $("asset-name").textContent = a.name;
  $("asset-market").textContent =
    places[a.market] + " · " + (a.id ? kindNames[a.kind] : "开放式基金");
  const icon = $("asset-icon");
  icon.style.background = a.colors?.[0] ?? "";
  icon.style.color = a.colors?.[1] ?? "";
  if (a.kind === "index")
    icon.innerHTML =
      '<svg class="icon" aria-hidden="true"><use href="#i-line"/></svg>';
  else icon.textContent = a.badge ?? a.code.slice(0, 2);
  $("star").setAttribute("aria-pressed", String(saved));
  $("star").setAttribute("aria-label", saved ? "移出自选" : "加入自选");
  $("star").title = saved ? "移出自选" : "加入自选";
  $("price").textContent = fmt(q?.price);
  $("unit").textContent = a.unit;
  const diff = Number.isFinite(q?.change) ? signed(q.change) : "";
  const percent = Number.isFinite(q?.percent) ? deltaText(q.percent) : "";
  $("change").textContent =
    diff && percent ? diff + " (" + percent + ")" : diff || percent || "—";
  $("change").className = tone(q?.percent);
  for (const b of $("ranges").children) {
    b.setAttribute("aria-pressed", String(b.dataset.range === chosenRange));
    b.disabled = !a.id && b.dataset.range === "day";
  }
  const points = periodPoints(h?.points, chosenRange),
    nav = !a.id;
  const label = nav ? "单位净值" : intraday ? "分时价" : "收盘价";
  const canCandle =
    !nav && points.length > 0 && points.every((p) => p.length >= 5);
  const candles =
    canCandle && (stylePreference ? stylePreference === "candles" : !intraday);
  $("legend").textContent = nav
    ? "净值"
    : intraday
    ? "分时"
    : candles
    ? "日 K"
    : "日线";
  $("candle-mode").disabled = !canCandle;
  $("candle-mode").title = canCandle
    ? "K 线图"
    : nav
    ? "基金按日公布单位净值"
    : "此区间缺少完整开高低收数据";
  $("candle-mode").setAttribute("aria-pressed", String(candles));
  $("line-mode").setAttribute("aria-pressed", String(!candles));
  const key = a.code + (intraday ? ".m" : ".d");
  const message = pendingSeries.has(key)
    ? "正在读取走势…"
    : intraday
    ? "暂无分时数据，可切换到日线。"
    : "暂无可用历史记录";
  draw(points, {
    key: key + "." + chosenRange,
    label,
    intraday,
    candles,
    volume: !nav,
    empty: message,
  });
  const low = points.map((p) => (nav ? p[1] : p[4] ?? p[1])),
    high = points.map((p) => (nav ? p[1] : p[3] ?? p[1]));
  const growth =
    points.length > 1 ? (points.at(-1)[1] / points[0][1] - 1) * 100 : null;
  $("period-low").textContent = points.length ? fmt(Math.min(...low)) : "—";
  $("period-high").textContent = points.length ? fmt(Math.max(...high)) : "—";
  $("period-change").textContent = deltaText(growth);
  $("period-change").className = tone(growth);
  const source = el(
    "span",
    "",
    q ? q.source + " · " + describe(q) : "等待" + a.name + "报价"
  );
  $("quote-asof").replaceChildren(source);
  if (points.length) {
    const first = points[0][0],
      last = points.at(-1)[0];
    const dates = el(
      "time",
      "",
      (h.source !== q?.source ? h.source + " · " : "") +
        first +
        " — " +
        (intraday && first.slice(0, 10) === last.slice(0, 10)
          ? last.slice(11)
          : last)
    );
    dates.title = "图表覆盖区间";
    $("quote-asof").append(dates);
  }
}
function render() {
  renderIndices();
  renderWatch();
  renderDetail();
}
function renderStatus() {
  $("refresh").classList.toggle("busy", fetching);
  $("refresh").disabled = fetching;
  $("auto").setAttribute("aria-pressed", String(automatic));
  $("auto").querySelector("span").textContent = automatic
    ? "自动刷新 · 60s"
    : "自动刷新已暂停";
  $("auto").title = automatic ? "暂停自动刷新" : "恢复自动刷新";
  $("auto").setAttribute("aria-label", $("auto").title);
  $("feed-status").classList.toggle(
    "connected",
    phase === "connected" || phase === "backup"
  );
  const labels = {
    waiting: "正在连接行情源…",
    connected: "东方财富已连接",
    backup: "备用行情源 Yahoo Finance 已连接",
    failed: "连接中断 · 显示最近可用记录",
  };
  $("feed-status").textContent =
    labels[phase] +
    (lastCheck ? " · 上次检查 " + clockFormatter.format(lastCheck) : "");
}
function backupSeries(asset, intraday = false) {
  if (!asset.yahoo) return Promise.reject(new Error("no alternate symbol"));
  const key = asset.code + (intraday ? ".m" : ".d");
  if (pendingBackup.has(key)) return pendingBackup.get(key);
  const origin =
    location.hostname === "nonterreaplusultar-del.github.io"
      ? "https://demo-nu-smoky-55.vercel.app"
      : location.origin;
  const url = new URL("/api/market-history", origin);
  url.search = new URLSearchParams({
    symbol: asset.code,
    range: intraday ? "day" : "daily",
  });
  const task = (async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(9500) });
    if (!response.ok) throw new Error("alternate feed unavailable");
    const data = await response.json(),
      points = cleanPoints(data.points, intraday);
    if (!points.length) throw new Error("empty alternate series");
    const result = { points, source: "Yahoo Finance", received: Date.now() };
    const q = data.quote;
    if (
      q &&
      Number.isFinite(q.price) &&
      q.price > 0 &&
      Number.isFinite(q.time) &&
      q.time >= (quotes.get(asset.code)?.time ?? 0)
    ) {
      quotes.set(asset.code, q);
      save("quotes", Object.fromEntries(quotes));
    }
    seriesCache.set(key, result);
    save("series." + key, result);
    return result;
  })().finally(() => pendingBackup.delete(key));
  pendingBackup.set(key, task);
  return task;
}
// Probe one symbol before fanning out. A disconnected alternate source costs one request.
async function refreshBackupBoard() {
  const probe = current.yahoo ? current : catalog[0];
  try {
    await backupSeries(probe);
  } catch {
    return false;
  }
  const visible = Array.from(
    $("watch-rows").querySelectorAll("[data-code]")
  ).map((b) => resolve(b.dataset.code));
  const others = [...new Set([...visibleIndices(), ...visible])].filter(
    (a) => a?.yahoo && a !== probe
  );
  for (let i = 0; i < others.length; i += 3) {
    if (document.hidden) break;
    await Promise.allSettled(
      others.slice(i, i + 3).map((a) => backupSeries(a))
    );
  }
  return true;
}
async function loadSeries(asset, intraday = false, force = false) {
  const key = asset.code + (intraday ? ".m" : ".d"),
    recent = seriesCache.get(key);
  const age = Date.now() - (recent?.received ?? 0);
  if (
    pendingSeries.has(key) ||
    (!force && recent && age < (intraday ? 50000 : 5 * 60000))
  )
    return;
  pendingSeries.add(key);
  if (asset === current && !history(asset, intraday)) renderDetail();
  try {
    const data = asset.id
      ? await getSeries(asset, intraday)
      : await backupSeries(asset, false);
    data.received = Date.now();
    seriesCache.set(key, data);
    save("series." + key, data);
  } catch {
    if (asset.id)
      try {
        await backupSeries(asset, intraday);
      } catch {
        /* Keep the dated cache. */
      }
  } finally {
    pendingSeries.delete(key);
    if (asset === current) renderDetail();
    renderWatch();
    if (asset.kind === "index") renderIndices();
  }
}
function select(code, focusChart = false) {
  const asset = resolve(code);
  if (!asset) return;
  current = asset;
  if (!asset.id && chosenRange === "day") chosenRange = "quarter";
  const url = new URL(location.href);
  url.searchParams.set("symbol", code);
  window.history.replaceState(null, "", url);
  if (asset.kind === "index")
    indexPage = Math.floor(indexAssets.indexOf(asset) / indexGroupSize());
  render();
  void loadSeries(asset, chosenRange === "day");
  if (focusChart && matchMedia("(max-width:800px)").matches)
    $("detail").scrollIntoView({ block: "start", behavior: "instant" });
}
async function readArchive(url, remote = false) {
  const response = await fetch(url, {
    cache: "no-cache",
    signal: AbortSignal.timeout(9000),
  });
  if (!response.ok) throw new Error("归档未发布");
  mergeArchive(await response.json(), remote);
  render();
}
async function refreshArchive() {
  if (archiveBusy || Date.now() - archiveRead < 30 * 60000) return;
  archiveBusy = true;
  archiveRead = Date.now();
  try {
    await readArchive(
      "https://raw.githubusercontent.com/nonterreaplusultar-del/demo/market-data/close.json",
      true
    );
  } catch {
    /* Local archives remain available if the daily publication is delayed. */
  } finally {
    archiveBusy = false;
  }
}
async function refresh(userInitiated = false) {
  if (fetching || (!userInitiated && document.hidden)) return;
  fetching = true;
  renderStatus();
  void refreshArchive();
  void loadSeries(current, chosenRange === "day", userInitiated);
  try {
    const available = assets.filter((a) => a.id);
    const data = await getQuotes(available.map((a) => a.id));
    for (const a of available) {
      const q = data.get(a.id);
      if (q && q.time >= (quotes.get(a.code)?.time ?? 0)) quotes.set(a.code, q);
    }
    save("quotes", Object.fromEntries(quotes));
    phase = "connected";
    for (const a of visibleIndices()) if (a !== current) void loadSeries(a);
    const nav = assets.find((a) => !a.id);
    if (nav) void loadSeries(nav);
  } catch {
    phase = (await refreshBackupBoard()) ? "backup" : "failed";
  } finally {
    fetching = false;
    lastCheck = Date.now();
    render();
    renderStatus();
    schedule();
  }
}
function schedule() {
  clearTimeout(pollTimer);
  if (automatic && !document.hidden)
    pollTimer = setTimeout(() => refresh(), 60000);
}
function starView(active) {
  onlyStars = active;
  market = "all";
  kind = "all";
  $("kind").value = "all";
  renderWatch();
  if (active)
    $("watch").scrollIntoView({ block: "nearest", behavior: "instant" });
}
function expand(open) {
  $("detail").classList.toggle("expanded", open);
  document.body.classList.toggle("expanded", open);
  $("expand").setAttribute("aria-pressed", String(open));
  $("expand").title = open ? "收起图表" : "展开图表";
  $("expand").setAttribute("aria-label", $("expand").title);
  for (const item of document.querySelectorAll(
    ".masthead,.overview,.watch,footer"
  ))
    item.inert = open;
}
function querySpec(input) {
  const value = input.trim().toUpperCase();
  if (/^\d{1,5}$/.test(value))
    return { code: value.padStart(5, "0"), market: "HK" };
  if (/^[A-Z][A-Z0-9.-]{0,9}$/.test(value))
    return { code: value, market: "US" };
  return null;
}
function searchResults() {
  const value = $("search-input").value.trim().toLowerCase();
  const matches = assets.filter(
    (a) =>
      (a.code + " " + a.name + " " + kindNames[a.kind])
        .toLowerCase()
        .includes(value) || (a.yahoo ?? "").toLowerCase() === value
  );
  $("search-results").replaceChildren(
    ...matches.map((a) => {
      const btn = el("button", "result");
      btn.dataset.code = a.code;
      btn.append(
        el("strong", "", a.code),
        el("span", "label", a.name),
        el("small", "", places[a.market] + " · " + kindNames[a.kind])
      );
      return btn;
    })
  );
  const spec = querySpec(value);
  const canLookup = spec && !resolve(spec.code);
  $("custom-lookup").hidden = !canLookup;
  if (canLookup)
    $("lookup-button").textContent =
      "查询" + (spec.market === "HK" ? "港股 " : "美股 ") + spec.code;
  $("search-note").textContent =
    matches.length || canLookup
      ? ""
      : "没有匹配品种，可输入完整的美股代码或港股数字代码。";
}
function openSearch() {
  if ($("search-dialog").open) return;
  $("search-input").value = "";
  searchResults();
  $("search-dialog").showModal();
  $("search-input").focus();
}
async function lookup() {
  const input = $("search-input").value,
    spec = querySpec(input);
  if (!spec || resolve(spec.code)) return;
  if (custom.length >= 30) {
    $("search-note").textContent = "已达到 30 个自定义品种上限。";
    return;
  }
  const ids =
    spec.market === "HK"
      ? ["116." + spec.code]
      : ["105.", "106.", "107."].map((prefix) => prefix + spec.code);
  const type = $("custom-type").value;
  $("lookup-button").disabled = true;
  $("search-note").textContent = "正在查询交易所代码…";
  try {
    const result = await getQuotes(ids);
    if (!$("search-dialog").open || $("search-input").value !== input) return;
    const [id, q] = result.entries().next().value;
    const asset = {
      ...spec,
      id,
      name: q.name,
      kind: type,
      unit: spec.market === "US" ? "USD" : "HKD",
      badge: spec.code.slice(0, 2),
    };
    custom.push(asset);
    assets.push(asset);
    quotes.set(spec.code, q);
    stars.add(spec.code);
    save("custom", custom);
    save("stars", [...stars]);
    save("quotes", Object.fromEntries(quotes));
    $("search-dialog").close();
    select(spec.code, true);
  } catch {
    if ($("search-input").value === input)
      $("search-note").textContent =
        "未取得该代码的报价，请核对代码或稍后再试。";
  } finally {
    $("lookup-button").disabled = false;
  }
}
function codeClick(container, callback) {
  container.addEventListener("click", (e) => {
    const code = e.target.closest("[data-code]")?.dataset.code;
    if (code) callback(code);
  });
}
codeClick($("indices"), (c) => select(c, true));
codeClick($("watch-rows"), (c) => select(c, true));
codeClick($("search-results"), (c) => {
  $("search-dialog").close();
  select(c, true);
});
for (const [id, caption] of ranges) {
  const b = el("button", "", caption);
  b.dataset.range = id;
  $("ranges").append(b);
}
$("ranges").addEventListener("click", (e) => {
  if (!e.target.dataset.range) return;
  chosenRange = e.target.dataset.range;
  renderDetail();
  void loadSeries(current, chosenRange === "day");
});
$("chart-types").addEventListener("click", (e) => {
  const button = e.target.closest("button[data-mode]");
  if (!button || button.disabled) return;
  stylePreference = button.dataset.mode;
  save("chartStyle", stylePreference);
  renderDetail();
});
compactTape.addEventListener("change", () => {
  indexPage =
    current.kind === "index"
      ? Math.floor(indexAssets.indexOf(current) / indexGroupSize())
      : 0;
  renderIndices();
});
$("star").onclick = () => {
  if (stars.has(current.code)) stars.delete(current.code);
  else stars.add(current.code);
  save("stars", [...stars]);
  renderWatch();
  renderDetail();
};
$("overview-tab").onclick = () => starView(false);
$("stars-tab").onclick = () => starView(true);
$("market-filter").onclick = (e) => {
  if (e.target.dataset.market) {
    market = e.target.dataset.market;
    renderWatch();
  }
};
$("kind").onchange = () => {
  kind = $("kind").value;
  renderWatch();
};
function page(by) {
  const count = Math.ceil(indexAssets.length / indexGroupSize());
  indexPage = (indexPage + by + count) % count;
  renderIndices();
  if (phase === "connected")
    for (const a of visibleIndices()) void loadSeries(a);
}
$("indices-prev").onclick = () => page(-1);
$("indices-next").onclick = () => page(1);
$("auto").onclick = () => {
  automatic = !automatic;
  save("auto", automatic);
  schedule();
  renderStatus();
  if (automatic) void refresh(true);
};
$("refresh").onclick = () => refresh(true);
$("expand").onclick = () => expand(!$("detail").classList.contains("expanded"));
$("start-search").onclick = openSearch;
$("list-search").onclick = openSearch;
$("close-search").onclick = () => $("search-dialog").close();
$("search-dialog").addEventListener("click", (e) => {
  if (e.target === $("search-dialog")) {
    const r = e.target.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      e.target.close();
  }
});
$("search-input").oninput = searchResults;
$("lookup-button").onclick = lookup;
$("search-input").onkeydown = (e) => {
  if (e.key === "ArrowDown") {
    $("search-results").querySelector("button")?.focus();
    e.preventDefault();
  } else if (e.key === "Enter" && !e.isComposing) {
    e.preventDefault();
    const first = $("search-results").querySelector("button");
    if (first) first.click();
    else if (!$("custom-lookup").hidden) void lookup();
  }
};
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("search-dialog").open) expand(false);
  if (
    !document.body.classList.contains("expanded") &&
    ((e.key === "/" && !/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) ||
      ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k"))
  ) {
    e.preventDefault();
    openSearch();
  }
});
document.addEventListener("visibilitychange", () => {
  schedule();
  if (!document.hidden && automatic && Date.now() - lastCheck > 60000)
    void refresh();
});
updateClock();
setInterval(updateClock, 1000);
render();
renderStatus();
void readArchive(new URL("./snapshot.json", import.meta.url)).catch(() => {});
void refresh(true);
