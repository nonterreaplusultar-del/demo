import { fmt } from "./market-data.js";

const up = "#40d4a9",
  down = "#f27988",
  mint = "#66e7c9";
const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
});
const axisNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

// Select round prices for grid lines while preserving the true high and low extremes.
function priceScale(low, high, targetTicks) {
  const padding = Math.max(
    (high - low) * 0.075,
    Math.abs(high) * 0.0004,
    0.001
  );
  const min = low - padding,
    max = high + padding,
    raw = (max - min) / targetTicks;
  const unit = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].find((n) => n * unit >= raw) * unit;
  const ticks = [];
  for (let i = Math.ceil(min / step); i <= Math.floor(max / step); i++)
    ticks.push(i * step);
  return { min, max, ticks };
}

export function makePlot(container, canvas, tip, empty, readout) {
  const ctx = canvas.getContext("2d");
  let points = [],
    options = {},
    hovered = -1,
    layout = null,
    reading = null;

  function report(point) {
    if (reading === point) return;
    reading = point;
    readout.replaceChildren();
    if (!point) return;
    const [stamp, close, open, high, low] = point;
    const fields = options.candles
      ? [
          ["开", open],
          ["高", high],
          ["低", low],
          ["收", close],
        ]
      : [[options.label, close]];
    for (const [name, price] of fields) {
      const cell = document.createElement("span"),
        value = document.createElement("b");
      cell.append(name, value);
      value.textContent = fmt(price);
      value.className = options.candles
        ? close >= open
          ? "up"
          : "down"
        : "flat";
      readout.append(cell);
    }
    readout.title = stamp;
  }

  function paint() {
    const w = container.clientWidth,
      h = container.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const width = Math.round(w * dpr),
      height = Math.round(h * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!points.length) {
      layout = null;
      tip.hidden = true;
      report(null);
      return;
    }

    const { candles, intraday, label } = options;
    const count = points.length,
      last = points[count - 1],
      active = points[hovered] ?? last;
    const low = Math.min(...points.map((p) => (candles ? p[4] : p[1])));
    const high = Math.max(...points.map((p) => (candles ? p[3] : p[1])));
    const { min, max, ticks } = priceScale(low, high, h < 320 ? 5 : 6);
    ctx.font = '10px "Geist Mono", monospace';
    ctx.textBaseline = "middle";
    const right =
      Math.max(
        ...[...ticks, active[1], last[1]].map(
          (v) => ctx.measureText(fmt(v)).width
        )
      ) + 15;
    const left = 1,
      end = w - right,
      top = 7,
      bottom = h - 27;
    const maxVolume = options.volume ? Math.max(0, ...points.map((p) => p[5] ?? 0)) : 0;
    const volumeHeight =
      maxVolume > 0 ? Math.min(61, Math.round((bottom - top) * 0.16)) : 0;
    const priceBottom = volumeHeight ? bottom - volumeHeight - 23 : bottom - 7;
    const xStep = (end - left - 5) / count;
    const x = (i) => left + (i + 0.5) * xStep;
    const y = (v) => top + ((max - v) / (max - min)) * (priceBottom - top);
    layout = { left, step: xStep };

    function stroke(x1, y1, x2, y2, color, dashed = false) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash(dashed ? [3, 4] : []);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const lastY = y(last[1]);
    for (const tick of ticks) {
      const gy = y(tick);
      stroke(left, gy, end, gy, "#20262d");
      if (Math.abs(gy - lastY) > 12) {
        ctx.fillStyle = "#84919e";
        ctx.textAlign = "right";
        ctx.fillText(axisNumber.format(tick), w - 4, gy);
      }
    }
    const labels = Math.min(count, w < 480 ? 4 : 6);
    for (let i = 0; i < labels; i++) {
      const idx = Math.round((i / Math.max(1, labels - 1)) * (count - 1)),
        stamp = points[idx][0];
      stroke(x(idx), top, x(idx), bottom, "#181d23");
      ctx.fillStyle = "#89939f";
      ctx.textAlign = i === 0 ? "left" : i === labels - 1 ? "right" : "center";
      ctx.fillText(
        intraday ? stamp.slice(11, 16) : stamp.slice(5).replace("-", "/"),
        x(idx),
        bottom + 15
      );
    }

    const bodyWidth = Math.max(1, Math.min(22, xStep * 0.67));
    if (candles) {
      points.forEach((p, i) => {
        const [, close, open, high, low] = p,
          cx = x(i);
        const color = close >= open ? up : down;
        stroke(cx, y(high), cx, y(low), color);
        ctx.fillStyle = color;
        ctx.fillRect(
          cx - bodyWidth / 2,
          Math.min(y(open), y(close)),
          bodyWidth,
          Math.max(1, Math.abs(y(open) - y(close)))
        );
      });
    } else {
      const path = new Path2D();
      points.forEach((p, i) =>
        i ? path.lineTo(x(i), y(p[1])) : path.moveTo(x(0), y(p[1]))
      );
      const area = new Path2D(path);
      area.lineTo(x(count - 1), priceBottom);
      area.lineTo(x(0), priceBottom);
      area.closePath();
      const shade = ctx.createLinearGradient(0, top, 0, priceBottom);
      shade.addColorStop(0, "rgba(86,222,191,.19)");
      shade.addColorStop(1, "rgba(86,222,191,0)");
      ctx.fillStyle = shade;
      ctx.fill(area);
      ctx.strokeStyle = mint;
      ctx.lineWidth = 1.9;
      ctx.lineJoin = "round";
      ctx.stroke(path);
      ctx.fillStyle = mint;
      ctx.beginPath();
      ctx.arc(x(count - 1), lastY, 2.9, 0, Math.PI * 2);
      ctx.fill();
    }

    const lastColor = candles && last[1] < last[2] ? down : mint;
    stroke(left, lastY, end, lastY, lastColor + "75", true);
    ctx.fillStyle = lastColor;
    ctx.fillRect(end + 2, lastY - 8.5, right - 2, 17);
    ctx.fillStyle = "#0b1615";
    ctx.textAlign = "center";
    ctx.fillText(fmt(last[1]), end + right / 2 + 1, lastY);

    if (volumeHeight) {
      stroke(left, priceBottom + 9, end, priceBottom + 9, "#22282e");
      ctx.fillStyle = "#97a3ac";
      ctx.textAlign = "left";
      const vol = Number.isFinite(active[5]) ? compact.format(active[5]) : "—";
      ctx.fillText("VOL  " + vol, left + 4, priceBottom + 19);
      points.forEach((p, i) => {
        if (!(p[5] > 0)) return;
        ctx.fillStyle = p[1] >= p[2] ? "#236b58" : "#814450";
        const vh = (p[5] / maxVolume) * volumeHeight;
        ctx.fillRect(x(i) - bodyWidth / 2, bottom - vh, bodyWidth, vh);
      });
    }
    report(active);
    if (hovered < 0) {
      tip.hidden = true;
      return;
    }
    const cx = x(hovered),
      cy = y(active[1]);
    stroke(cx, top, cx, bottom, "#78838c", true);
    stroke(left, cy, end, cy, "#606b74", true);
    ctx.fillStyle = candles ? (active[1] >= active[2] ? up : down) : mint;
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();
    const value = document.createElement("b");
    value.textContent = label + " " + fmt(active[1]);
    tip.replaceChildren(active[0], document.createElement("br"), value);
    tip.hidden = false;
    const tipX =
      cx + 12 + tip.offsetWidth < end ? cx + 12 : cx - 12 - tip.offsetWidth;
    tip.style.left = Math.max(0, tipX) + "px";
    tip.style.top =
      Math.max(0, Math.min(priceBottom - tip.offsetHeight, cy - 35)) + "px";
  }

  function move(index) {
    const next = Math.min(points.length - 1, Math.max(-1, index));
    if (hovered !== next) {
      hovered = next;
      paint();
    }
  }
  function pointer(e) {
    if (!layout) return;
    const px = e.clientX - canvas.getBoundingClientRect().left;
    move(Math.max(0, Math.floor((px - layout.left) / layout.step)));
  }
  canvas.addEventListener("pointermove", pointer);
  canvas.addEventListener("pointerdown", pointer);
  canvas.addEventListener("pointerleave", () => move(-1));
  container.addEventListener("blur", () => move(-1));
  container.addEventListener("keydown", (e) => {
    if (
      !points.length ||
      !["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(e.key)
    )
      return;
    e.preventDefault();
    if (e.key === "Escape") move(-1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End" || hovered < 0) move(points.length - 1);
    else move(Math.max(0, hovered + (e.key === "ArrowLeft" ? -1 : 1)));
    if (hovered >= 0)
      container.setAttribute(
        "aria-label",
        points[hovered][0] +
          " " +
          options.label +
          " " +
          fmt(points[hovered][1]) +
          "，左右方向键切换"
      );
  });
  new ResizeObserver(paint).observe(container);
  document.fonts.ready.then(paint);
  return (next, settings) => {
    const stamp = options.key === settings.key ? points[hovered]?.[0] : null;
    points = next;
    options = settings;
    reading = undefined;
    hovered = stamp ? points.findIndex((p) => p[0] === stamp) : -1;
    empty.hidden = points.length > 0;
    empty.textContent = settings.empty;
    container.dataset.view = settings.candles ? "candles" : "line";
    container.setAttribute(
      "aria-label",
      points.length
        ? settings.label +
            "走势，" +
            points[0][0] +
            " 至 " +
            points.at(-1)[0] +
            "，左右方向键查看价格"
        : settings.empty
    );
    paint();
  };
}
