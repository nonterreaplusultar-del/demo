import { fmt } from "./market-data.js";

export function makePlot(container, canvas, tip, empty) {
  const ctx = canvas.getContext("2d");
  let points = [],
    hovered = -1,
    label = "收盘价",
    intraday = false;
  let layout;
  const pos = (i) =>
    layout.left + (i / Math.max(1, points.length - 1)) * layout.width;
  function paint() {
    const w = container.clientWidth,
      h = container.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(devicePixelRatio || 1, 3);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!points.length) {
      tip.hidden = true;
      return;
    }
    const values = points.map((p) => p[1]);
    const min = Math.min(...values),
      max = Math.max(...values);
    const pad = Math.max((max - min) * 0.14, Math.abs(max) * 0.00016, 0.0001);
    const lo = min - pad,
      hi = max + pad;
    ctx.font = "10px Consolas, monospace";
    const right =
      Math.ceil(
        Math.max(ctx.measureText(fmt(hi)).width, ctx.measureText(fmt(lo)).width)
      ) + 16;
    layout = {
      left: 4,
      top: 12,
      width: Math.max(4, w - right - 7),
      height: Math.max(10, h - 42),
    };
    const { left, top, width, height } = layout;
    const bottom = top + height,
      axis = left + width + 7;
    const y = (v) => top + ((hi - v) / (hi - lo)) * height;
    ctx.lineWidth = 1;
    ctx.textBaseline = "middle";
    for (let i = 0; i <= 4; i++) {
      const gy = top + (i * height) / 4;
      ctx.strokeStyle = "#30372e";
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(left, gy);
      ctx.lineTo(left + width, gy);
      ctx.stroke();
      ctx.fillStyle = "#90988b";
      ctx.textAlign = "left";
      ctx.fillText(fmt(hi - (i * (hi - lo)) / 4), axis + 2, gy);
    }
    ctx.setLineDash([]);
    const line = new Path2D();
    points.forEach((p, i) =>
      i ? line.lineTo(pos(i), y(p[1])) : line.moveTo(pos(0), y(p[1]))
    );
    const area = new Path2D(line);
    area.lineTo(pos(points.length - 1), bottom);
    area.lineTo(left, bottom);
    area.closePath();
    const fill = ctx.createLinearGradient(0, top, 0, bottom);
    fill.addColorStop(0, "rgba(190,239,117,.27)");
    fill.addColorStop(0.65, "rgba(154,203,86,.08)");
    fill.addColorStop(1, "rgba(154,203,86,.01)");
    ctx.fillStyle = fill;
    ctx.fill(area);
    ctx.strokeStyle = "#bff177";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2.2;
    ctx.stroke(line);
    const last = points.length - 1,
      px = pos(last),
      py = y(points[last][1]);
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    ctx.strokeStyle = "#9ab56680";
    ctx.beginPath();
    ctx.moveTo(left, py);
    ctx.lineTo(px, py);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#c3f678";
    ctx.beginPath();
    ctx.arc(px, py, 3.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#293422";
    ctx.fillRect(axis - 1, py - 8, right - 4, 16);
    ctx.fillStyle = "#c3f678";
    ctx.textAlign = "left";
    ctx.fillText(fmt(points[last][1]), axis + 2, py);
    const labels = Math.min(points.length, w < 460 ? 4 : 6);
    ctx.fillStyle = "#90988b";
    for (let i = 0; i < labels; i++) {
      const ix = Math.round((i / Math.max(1, labels - 1)) * last),
        s = points[ix][0];
      ctx.textAlign = i === 0 ? "left" : i === labels - 1 ? "right" : "center";
      ctx.fillText(
        intraday ? s.slice(11, 16) : s.slice(5).replace("-", "/"),
        pos(ix),
        bottom + 17
      );
    }
    if (hovered < 0 || hovered > last) {
      tip.hidden = true;
      return;
    }
    const x = pos(hovered),
      hy = y(points[hovered][1]);
    ctx.strokeStyle = "#a0ad96";
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#c3f678";
    ctx.beginPath();
    ctx.arc(x, hy, 4, 0, Math.PI * 2);
    ctx.fill();
    const value = document.createElement("b");
    value.textContent = label + " " + fmt(points[hovered][1]);
    tip.replaceChildren(
      document.createTextNode(points[hovered][0]),
      document.createElement("br"),
      value
    );
    tip.hidden = false;
    tip.style.left =
      Math.min(Math.max(0, x + 10), w - tip.offsetWidth - 2) + "px";
    tip.style.top = Math.min(Math.max(0, hy - 54), h - tip.offsetHeight) + "px";
  }
  function atPointer(event) {
    if (!layout || !points.length) return;
    const x = event.clientX - canvas.getBoundingClientRect().left;
    hovered = Math.min(
      points.length - 1,
      Math.max(
        0,
        Math.round(((x - layout.left) / layout.width) * (points.length - 1))
      )
    );
    paint();
  }
  canvas.addEventListener("pointermove", atPointer);
  canvas.addEventListener("pointerdown", atPointer);
  canvas.addEventListener("pointerleave", () => {
    hovered = -1;
    paint();
  });
  container.addEventListener("blur", () => {
    hovered = -1;
    paint();
  });
  container.addEventListener("keydown", (e) => {
    if (
      !points.length ||
      !["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(e.key)
    )
      return;
    e.preventDefault();
    if (e.key === "Escape") hovered = -1;
    else if (e.key === "Home") hovered = 0;
    else if (e.key === "End" || hovered < 0) hovered = points.length - 1;
    else
      hovered = Math.max(
        0,
        Math.min(points.length - 1, hovered + (e.key === "ArrowLeft" ? -1 : 1))
      );
    paint();
    if (hovered >= 0)
      container.setAttribute(
        "aria-label",
        points[hovered][0] +
          " " +
          label +
          " " +
          fmt(points[hovered][1]) +
          "，左右方向键切换"
      );
  });
  new ResizeObserver(paint).observe(container);
  return (next, options) => {
    points = next;
    hovered = -1;
    label = options.label;
    intraday = options.intraday;
    empty.hidden = points.length > 0;
    empty.textContent = options.empty;
    container.setAttribute(
      "aria-label",
      points.length
        ? label +
            "走势，" +
            points[0][0] +
            " 至 " +
            points.at(-1)[0] +
            "，左右方向键查看价格"
        : options.empty
    );
    paint();
  };
}
