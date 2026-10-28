/**
 * ── VIEWER RENDER BENCHMARK ──
 *
 * Measures what the takeoff viewer costs on a heavy sheet, in a real
 * Chromium, with no app and no sign-in: the page is a stand-in built the way
 * `TakeoffPlanViewer` builds its surface (an `overflow:auto` frame, a canvas
 * sized by `canvasPlan`, an SVG overlay of non-scaling-stroke lines), fed the
 * same pdf.js build the app ships. Nothing here reads a drawing into git —
 * the PDF and the label file come from env, and only timings are written.
 *
 *   BENCH_PDF=…/Topeka-Senior-Villas.pdf BENCH_PAGE=74 \
 *   BENCH_LINES=…/labels/Topeka-Senior-Villas.pdf/p74.json \
 *   BENCH_OUT=…/viewer-bench.json \
 *   node_modules/.bin/tsx scripts/viewer-bench.mts
 *
 * Three questions, one scenario each:
 *   zoom   — `page.render` wall time per zoom step, with the canvas size.
 *   pan    — scroll latency (double rAF) with and without the overlay, and
 *            the Chrome trace's top event names so the cost has an owner.
 *   load   — getDocument → first page drawn, with pdf.js's autoFetch on and
 *            off, over a throttled connection, counting bytes the server sent.
 */
import { createServer } from "node:http";
import { createReadStream, readFileSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import { createRequire } from "node:module";
// tsx compiles the app's `.ts` as CommonJS (no "type": "module"), so an ESM
// import of it sees only `default`; `require` gets the named export.
const { canvasPlan } = createRequire(import.meta.url)("../lib/takeoff/canvasPlan.ts") as typeof import("../lib/takeoff/canvasPlan");
const { PLAN_PDF_TRANSPORT } = createRequire(import.meta.url)("../lib/takeoff/planPdfTransport.ts") as typeof import("../lib/takeoff/planPdfTransport");

const PDF = process.env.BENCH_PDF ?? "";
const PAGE = Number(process.env.BENCH_PAGE ?? "1");
const LINES = process.env.BENCH_LINES ?? "";
const OUT = process.env.BENCH_OUT ?? "";
const MODE = process.env.BENCH_MODE ?? "before";
const BASE_SCALE = 1.5;
const FRAME = { width: 1400, height: 900 };
if (!PDF) throw new Error("BENCH_PDF names the drawing to measure");

const pdfjsDir = path.resolve(process.cwd(), "node_modules/pdfjs-dist");
const size = statSync(PDF).size;
let sent = 0;
let pacing = false;
let requests = 0;
/** Every Range asked for, in order — what pdf.js decided it needed. */
let ranges: string[] = [];
/** The line between the estimator and the file: a per-request delay like a
 *  serverless hop, and a shared byte budget like a real downlink. Paced here
 *  on the server because CDP's network emulation did not touch pdf.js's
 *  fetches at all in the first run (88 MB arrived in 3 s on a "50 Mbit" line). */
const LATENCY_MS = Number(process.env.BENCH_LATENCY_MS ?? "250");
const MBPS = Number(process.env.BENCH_MBPS ?? "50");
let budget = 0;
setInterval(() => { budget = Math.min(budget + (MBPS * 1024 * 1024) / 8 / 20, (MBPS * 1024 * 1024) / 8 / 4); }, 50).unref();
async function pace(bytes: number) { while (budget < bytes) await new Promise((r) => setTimeout(r, 10)); budget -= bytes; }

type OverlayLine = { x1: number; y1: number; x2: number; y2: number; traced?: boolean; rejected?: boolean };
/** Overlay lines as the viewer stores them: fractions of the page width. */
function overlayLines(): OverlayLine[] {
  if (!LINES) return [];
  const label = JSON.parse(readFileSync(LINES, "utf8")) as {
    verdicts?: Record<string, { x1: number; y1: number; x2: number; y2: number; verdict?: string }>;
    traced?: { x1: number; y1: number; x2: number; y2: number }[];
  };
  return [
    ...Object.values(label.verdicts ?? {}).map(({ x1, y1, x2, y2, verdict }) => ({ x1, y1, x2, y2, rejected: verdict === "not-a-wall" })),
    ...(label.traced ?? []).map(({ x1, y1, x2, y2 }) => ({ x1, y1, x2, y2, traced: true })),
  ];
}
/** Labelling mode draws EVERY candidate the finder offered, decided or not —
 *  the label file keeps coordinates only for decided ones, so the rest are the
 *  decided lines again, shifted. `BENCH_CANDIDATES` is that count (Topeka p74: 1,562). */
function labelingLines(real: OverlayLine[]): OverlayLine[] {
  const wanted = Number(process.env.BENCH_CANDIDATES ?? "0");
  const candidates = real.filter((l) => !l.traced);
  const out: OverlayLine[] = [...candidates];
  for (let i = 0; candidates.length > 0 && out.length < wanted; i++) {
    const l = candidates[i % candidates.length];
    const shift = 0.003 * (1 + Math.floor(i / candidates.length));
    out.push({ ...l, y1: l.y1 + shift, y2: l.y2 + shift, rejected: false });
  }
  return [...out, ...real.filter((l) => l.traced)];
}

const HTML = `<!doctype html><meta charset="utf-8">
<style>body{margin:0;background:#111}#frame{position:relative;width:${FRAME.width}px;height:${FRAME.height}px;overflow:auto}
#wrap{position:relative;width:fit-content}canvas{display:block}svg{position:absolute;left:0;top:0;pointer-events:none}</style>
<div id="frame"><div id="wrap"><canvas id="c"></canvas><svg id="o"></svg></div></div>
<script type="module">
import * as pdfjs from "/pdfjs/legacy/build/pdf.mjs";
pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/legacy/build/pdf.worker.mjs";
const now = () => performance.now();
const frame = document.getElementById("frame"), canvas = document.getElementById("c"), svg = document.getElementById("o");
const twoFrames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
window.bench = {
  async load(opts) { const t0 = now(); window.doc = await pdfjs.getDocument({ url: "/plan.pdf", standardFontDataUrl: "/pdfjs/standard_fonts/", ...opts }).promise; return { ms: now() - t0, pages: window.doc.numPages }; },
  async page(n) { const t0 = now(); window.pg = await window.doc.getPage(n); const vp = window.pg.getViewport({ scale: 1 }); return { ms: now() - t0, width: vp.width, height: vp.height }; },
  async ops() { const t0 = now(); const l = await window.pg.getOperatorList(); return { ms: now() - t0, ops: l.fnArray.length }; },
  async render(plan) {
    canvas.width = plan.canvasWidth; canvas.height = plan.canvasHeight;
    canvas.style.width = plan.cssWidth + "px"; canvas.style.height = plan.cssHeight + "px";
    svg.style.width = plan.cssWidth + "px"; svg.style.height = plan.cssHeight + "px";
    const t0 = now();
    await window.pg.render({ canvasContext: canvas.getContext("2d"), viewport: window.pg.getViewport({ scale: plan.renderScale }) }).promise;
    const drawn = now() - t0; await twoFrames(); return { renderMs: drawn, paintedMs: now() - t0 };
  },
  overlay(lines, aspect) {
    // Each line the way the viewer's key overlay draws it: a candidate is one
    // non-scaling stroke with a pointer cursor (rejected ones at 35% opacity);
    // a traced wall is a 32px transparent hit line under a 4px green one.
    svg.setAttribute("viewBox", "0 0 1 " + aspect); svg.setAttribute("preserveAspectRatio", "none");
    const at = (l) => 'x1="' + l.x1 + '" y1="' + l.y1 + '" x2="' + l.x2 + '" y2="' + l.y2 + '" vector-effect="non-scaling-stroke" stroke-linecap="round"';
    svg.innerHTML = lines.map(l => l.traced
      ? '<line ' + at(l) + ' stroke="transparent" stroke-width="32"/><line ' + at(l) + ' stroke="#16a34a" stroke-width="4"/>'
      : '<line ' + at(l) + ' stroke="' + (l.rejected ? "#9ca3af" : "#f59e0b") + '" stroke-width="3" style="cursor:pointer"' + (l.rejected ? ' opacity="0.35"' : '') + '/>').join("");
    return svg.childElementCount;
  },
  async scroll(dx, dy) { frame.scrollBy(dx, dy); const t0 = now(); await twoFrames(); return now() - t0; },
  scrollTo(x, y) { frame.scrollTo(x, y); },
};
window.ready = true;
</script>`;

const server = createServer((req, res) => {
  const url = req.url ?? "/";
  if (url === "/") return void res.writeHead(200, { "content-type": "text/html" }).end(HTML);
  if (url.startsWith("/pdfjs/")) {
    const file = path.join(pdfjsDir, url.slice("/pdfjs/".length));
    if (!file.startsWith(pdfjsDir)) return void res.writeHead(403).end();
    try {
      statSync(file);
    } catch {
      return void res.writeHead(404).end();
    }
    res.writeHead(200, { "content-type": file.endsWith(".mjs") ? "text/javascript" : "application/octet-stream" });
    return void createReadStream(file).pipe(res);
  }
  if (url === "/plan.pdf") {
    // Range-capable, like `app/api/takeoff/plan/[planId]/route.ts`.
    const asked = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
    const start = asked?.[1] ? Number(asked[1]) : 0;
    const end = asked?.[2] ? Math.min(Number(asked[2]), size - 1) : size - 1;
    requests += 1;
    ranges.push(asked ? `${start}-${end}` : "full");
    res.writeHead(asked ? 206 : 200, {
      "content-type": "application/pdf",
      "accept-ranges": "bytes",
      "content-length": end - start + 1,
      ...(asked ? { "content-range": `bytes ${start}-${end}/${size}` } : {}),
    });
    const stream = createReadStream(PDF, { start, end, highWaterMark: 64 * 1024 });
    return void (async () => {
      await new Promise((r) => setTimeout(r, pacing ? LATENCY_MS : 0));
      for await (const chunk of stream) {
        if (pacing) await pace(chunk.length);
        sent += chunk.length;
        if (!res.write(chunk)) await new Promise((r) => res.once("drain", r));
      }
      res.end();
    })().catch(() => res.destroy());
  }
  res.writeHead(404).end();
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const port = (server.address() as { port: number }).port;
const origin = `http://127.0.0.1:${port}`;

// BENCH_HEADED=1 runs a visible Chromium with the GPU the estimator has;
// headless rasterises differently and a number from it can mislead.
const browser = await chromium.launch({ headless: process.env.BENCH_HEADED !== "1" });
const context = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1000 } });

type Top = { name: string; ms: number }[];
/** The trace's heaviest event names: where the time went, by owner. */
async function traced<T>(page: import("@playwright/test").Page, run: () => Promise<T>): Promise<{ result: T; top: Top }> {
  await browser.startTracing(page, {
    categories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "blink", "cc", "gpu", "v8.execute"],
  });
  const result = await run();
  const buffer = await browser.stopTracing();
  const events = (JSON.parse(buffer.toString()) as { traceEvents: { name: string; ph: string; dur?: number }[] }).traceEvents;
  const byName = new Map<string, number>();
  for (const e of events) if (e.ph === "X" && e.dur) byName.set(e.name, (byName.get(e.name) ?? 0) + e.dur / 1000);
  const top = [...byName].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, ms]) => ({ name, ms: Math.round(ms) }));
  return { result, top };
}

const report: Record<string, unknown> = { mode: MODE, pdfBytes: size, page: PAGE, frame: FRAME };
const page = await context.newPage();
await page.goto(origin);
await page.waitForFunction(() => (window as unknown as { ready?: boolean }).ready === true);

// ── zoom: full-page render per step, the way the viewer does it ──
const load = await page.evaluate(() => (window as unknown as { bench: { load: (o: object) => Promise<unknown> } }).bench.load({}));
const pg = (await page.evaluate((n) => (window as unknown as { bench: { page: (n: number) => Promise<unknown> } }).bench.page(n), PAGE)) as {
  ms: number;
  width: number;
  height: number;
};
const ops = await page.evaluate(() => (window as unknown as { bench: { ops: () => Promise<unknown> } }).bench.ops());
report.load = load;
report.page = pg;
report.ops = ops;
const aspect = pg.height / pg.width;
const fitWidth = FRAME.width / (pg.width * BASE_SCALE);
const zooms: Record<string, number> = { fit: Math.min(fitWidth, FRAME.height / (pg.height * BASE_SCALE)), "100%": 1, "200%": 2, "400%": 4 };
const zoom: Record<string, unknown> = {};
let plan200 = canvasPlan({ pageWidth: pg.width, pageHeight: pg.height, scale: BASE_SCALE * 2, devicePixelRatio: 2 });
for (const [label, z] of Object.entries(zooms)) {
  const plan = canvasPlan({ pageWidth: pg.width, pageHeight: pg.height, scale: BASE_SCALE * z, devicePixelRatio: 2 });
  if (label === "200%") plan200 = plan;
  const { result, top } = await traced(page, () =>
    page.evaluate((p) => (window as unknown as { bench: { render: (p: object) => Promise<unknown> } }).bench.render(p), plan),
  );
  zoom[label] = { zoom: Math.round(z * 1000) / 1000, canvas: `${plan.canvasWidth}x${plan.canvasHeight}`, megapixels: Math.round((plan.canvasWidth * plan.canvasHeight) / 1e5) / 10, ...(result as object), top };
  console.log(`zoom ${label}`, JSON.stringify(zoom[label]));
}
report.zoom = zoom;

// ── pan: scroll the frame over the 200% render, bare and with the overlay ──
await page.evaluate((p) => (window as unknown as { bench: { render: (p: object) => Promise<unknown> } }).bench.render(p), plan200);
const lines = overlayLines();
const labeling = labelingLines(lines);
const pan: Record<string, unknown> = {};
for (const [label, set] of [
  ["canvas only", []],
  [`canvas + ${lines.length} overlay lines`, lines],
  [`labeling: ${labeling.length} lines (${labeling.filter((l) => !l.traced).length} candidates, ${labeling.filter((l) => l.traced).length} traced)`, labeling],
] as const) {
  const count = await page.evaluate(([l, a]) => (window as unknown as { bench: { overlay: (l: unknown, a: number) => number } }).bench.overlay(l, a), [set, aspect] as const);
  await page.evaluate(() => (window as unknown as { bench: { scrollTo: (x: number, y: number) => void } }).bench.scrollTo(0, 0));
  const { result, top } = await traced(page, async () => {
    const samples: number[] = [];
    for (let i = 0; i < 8; i++) {
      samples.push(await page.evaluate(() => (window as unknown as { bench: { scroll: (dx: number, dy: number) => Promise<number> } }).bench.scroll(300, 200)));
    }
    return samples;
  });
  const sorted = [...result].sort((a, b) => a - b);
  pan[label] = { lines: count, scrollMs: result.map((n) => Math.round(n)), medianMs: Math.round(sorted[sorted.length >> 1]), top };
  console.log(`pan ${label}`, JSON.stringify(pan[label]));
}
report.pan = pan;

// ── zoom with the labelling overlay up: the SVG re-lays out every line ──
const zoomLabeling: Record<string, unknown> = {};
await page.evaluate(([l, a]) => (window as unknown as { bench: { overlay: (l: unknown, a: number) => number } }).bench.overlay(l, a), [labeling, aspect] as const);
for (const label of ["fit", "100%", "200%"]) {
  const plan = canvasPlan({ pageWidth: pg.width, pageHeight: pg.height, scale: BASE_SCALE * zooms[label], devicePixelRatio: 2 });
  const { result, top } = await traced(page, () =>
    page.evaluate((p) => (window as unknown as { bench: { render: (p: object) => Promise<unknown> } }).bench.render(p), plan),
  );
  zoomLabeling[label] = { lines: labeling.length, ...(result as object), top };
  console.log(`zoom+labeling ${label}`, JSON.stringify(zoomLabeling[label]));
}
report.zoomLabeling = zoomLabeling;
await page.close();

// ── load: first page drawn, per pdf.js transport option, over the paced line ──
const firstLoad: Record<string, unknown> = {};
pacing = true;
const transports: [string, object][] = [
  ["default", {}],
  ["disableAutoFetch", { disableAutoFetch: true }],
  ["disableStream", { disableStream: true }],
  ["disableAutoFetch+disableStream", { disableAutoFetch: true, disableStream: true }],
  ["disableAutoFetch+disableStream, 4 MB chunks", { disableAutoFetch: true, disableStream: true, rangeChunkSize: 4 * 1024 * 1024 }],
  // The app's own setting, read from the module so this row cannot drift from it.
  ["app: PLAN_PDF_TRANSPORT", PLAN_PDF_TRANSPORT],
];
// BENCH_ROWS="default,app" runs only the rows whose label starts with one of these.
const rows = process.env.BENCH_ROWS?.split(",").map((r) => r.trim()).filter(Boolean);
for (const [label, opts] of process.env.BENCH_SKIP_LOAD === "1" ? [] : transports.filter(([l]) => !rows || rows.some((r) => l.startsWith(r)))) {
  sent = 0;
  requests = 0;
  ranges = [];
  const p = await context.newPage();
  await p.goto(origin);
  await p.waitForFunction(() => (window as unknown as { ready?: boolean }).ready === true);
  const t0 = Date.now();
  const l = await p.evaluate((o) => (window as unknown as { bench: { load: (o: object) => Promise<unknown> } }).bench.load(o), opts);
  const first = (await p.evaluate(() => (window as unknown as { bench: { page: (n: number) => Promise<unknown> } }).bench.page(1))) as { width: number; height: number };
  const plan = canvasPlan({ pageWidth: first.width, pageHeight: first.height, scale: BASE_SCALE * Math.min(FRAME.width / (first.width * BASE_SCALE), FRAME.height / (first.height * BASE_SCALE)), devicePixelRatio: 2 });
  const r = await p.evaluate((pl) => (window as unknown as { bench: { render: (p: object) => Promise<unknown> } }).bench.render(pl), plan);
  const firstDrawnMs = Date.now() - t0;
  const atFirst = { bytes: sent, requests };
  await p.waitForTimeout(5000);
  firstLoad[label] = { firstDrawnMs, load: l, render: r, atFirstDraw: atFirst, fiveSecondsLater: { bytes: sent, requests }, pdfBytes: size, line: { latencyMs: LATENCY_MS, mbps: MBPS }, ranges: [...ranges] };
  console.log(`load ${label}`, JSON.stringify(firstLoad[label]));
  await p.close();
}
pacing = false;
report.firstLoad = firstLoad;

await browser.close();
server.close();
if (OUT) await writeFile(OUT, JSON.stringify(report, null, 2));
console.log("done", OUT || "(no BENCH_OUT)");
