/**
 * ── THE SCANNED-SHEET WORKER RUNS IN THE FUNCTION AS IT IS SHIPPED, NOT IN THE REPO ──
 *
 * 2026-11-24, #1252's production proof: the worker's PATH was finally right
 * (/var/task/apps/web/lib/takeoff/raster/rasterWorker.mjs) and the thread died on its first import:
 * `ERR_MODULE_NOT_FOUND Cannot find package 'pdfjs-dist'`. The worker is copied into every function by
 * `outputFileTracingIncludes`, which copies the FILE; nothing traces what it imports, and the repo's
 * node_modules hides that from every test run on a laptop or in CI. Scanned reading has never worked in
 * production.
 *
 * So this runs after `next build`. It rebuilds the scanned-sheet route's function from its `.nft.json`
 * exactly as traced: files copied, symlinks recreated as symlinks, and nothing else, so there is no
 * node_modules above it that the function would not have. It then starts the REAL worker inside that tree:
 *   1. a render of a one-page drawing (pdf.js, its in-thread worker, @napi-rs/canvas, `./tilePlan.mjs`);
 *   2. tesseract.js loaded as the worker loads it, its WASM core chosen and loaded as its own thread does,
 *      and EVERY core module the package ships loaded from the thread's own require (which one runs depends on
 *      tesseract's own choice, which is not the OEM it is asked for; see the step's comment).
 * Before the tree, the same probe runs against the repo: if it fails THERE, the probe is broken, not the
 * function (a failing control is an instruction to fix the harness).
 *
 * Not covered, and said: Tesseract downloads `eng.traineddata` from its CDN at run time into
 * os.tmpdir(), so no file in the function holds it. Production proves that leg.
 */
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PDFDocument, rgb } from "pdf-lib";
import { createRequire } from "node:module";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(APP, "..", ".."); // outputFileTracingRoot in next.config.mjs
const ENTRY = join(APP, ".next", "server", "app", "api", "takeoff", "raster", "[planId]", "[page]", "route.js.nft.json");
const WORKER_DIR = join("apps", "web", "lib", "takeoff", "raster");

const PROBE = String.raw`
import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { storeImport, storeRequire } from "./runtimeStore.mjs";
const here = dirname(fileURLToPath(import.meta.url));
const results = [];
const step = async (name, run) => {
  try { results.push({ name, ok: true, detail: await run() }); }
  catch (e) { results.push({ name, ok: false, detail: String(e?.stack ?? e).split("\n").slice(0, 3).join(" | ") }); }
};
await step("the worker renders a sheet (pdf.js, its worker, @napi-rs/canvas, tilePlan.mjs)", () => new Promise((done, fail) => {
  const worker = new Worker(join(here, "rasterWorker.mjs"));
  const timer = setTimeout(() => { worker.terminate(); fail(new Error("no answer in 60 s")); }, 60_000);
  worker.on("error", (e) => { clearTimeout(timer); fail(e); });
  worker.on("message", (m) => {
    clearTimeout(timer);
    worker.terminate();
    if (!m.ok) fail(new Error(m.error));
    else if (!(m.width > 0 && m.height > 0)) fail(new Error("rendered nothing: " + m.width + "x" + m.height));
    else done(m.width + "x" + m.height);
  });
  const bytes = new Uint8Array(readFileSync(process.argv[2]));
  worker.postMessage({ type: "render", bytes, page: 1, dpi: 36, bandPx: 512 });
}));
await step("tesseract.js loads as the worker imports it", async () => { await storeImport("tesseract.js"); return "ok"; });
await step("tesseract's own thread loads its WASM core", async () => {
  const main = storeRequire.resolve("tesseract.js");
  const thread = createRequire(join(dirname(main), "worker-script", "node", "index.js"));
  thread("../index.js");
  thread("./gunzip");
  thread("./cache");
  // EVERY core the package ships, not the one an OEM suggests. tesseract.js 7.0.0's thread calls
  // getCore(lstmOnly, …) with a BOOLEAN that its Node getCore compares to OEM numbers, so in Node it always picks a
  // non-LSTM core; #1255 assumed OEM 1 and shipped only the LSTM ones, and this check, calling getCore(1, …), agreed
  // with it (production, 2026-11-25 17:17Z: Cannot find module 'tesseract.js-core/tesseract-core-relaxedsimd').
  // The list comes from the package as installed (PROBE_CORES), so the function must hold whatever it might load.
  const cores = JSON.parse(process.env.PROBE_CORES ?? "[]");
  if (cores.length < 6) throw new Error("the probe was handed " + cores.length + " core modules; tesseract.js-core ships six");
  const missing = [];
  for (const name of cores) {
    try {
      const factory = thread("tesseract.js-core/" + name);
      if (typeof factory !== "function") missing.push(name + " (not a module factory)");
      const js = thread.resolve("tesseract.js-core/" + name);
      for (const file of [js.replace(/\.js$/, ".wasm.js"), js.replace(/\.js$/, ".wasm")]) if (!existsSync(file)) missing.push(file);
    } catch (e) {
      missing.push(String(e?.message ?? e).split("\n")[0]);
    }
  }
  if (missing.length > 0) throw new Error("cores the thread can pick are missing: " + missing.join("; "));
  return cores.length + " cores";
});
if (process.env.RASTER_TRACE_OCR === "1") {
  // OPT-IN (it downloads eng.traineddata from Tesseract's CDN): the next layer, a real OCR through the worker, as
  // nodeStack.ts asks for it. Passes only when Tesseract reads the drawing's printed title back.
  await step("the worker OCRs the drawing and reads its title (RASTER_TRACE_OCR=1)", () => new Promise((done, fail) => {
    const worker = new Worker(join(here, "rasterWorker.mjs"));
    const timer = setTimeout(() => { worker.terminate(); fail(new Error("no answer in 150 s")); }, 150_000);
    let rendered = false;
    worker.on("error", (e) => { clearTimeout(timer); fail(e); });
    worker.on("message", (m) => {
      if (!m.ok) { clearTimeout(timer); worker.terminate(); return fail(new Error(m.error)); }
      if (!rendered) {
        rendered = true;
        worker.postMessage({ type: "ocr", gray: m.gray, width: m.width, height: m.height, dpi: 100, cachePath: process.env.PROBE_CACHE, tilePxAt150: 1200, minConfidence: 40, regions: null, skipTiles: null, lanes: 1 }, [m.gray.buffer]);
        return;
      }
      clearTimeout(timer);
      worker.postMessage({ type: "close" });
      setTimeout(() => worker.terminate(), 500);
      const text = m.items.map((i) => i.str).join(" ");
      if (/FLOOR/i.test(text)) done("read: " + text.slice(0, 60));
      else fail(new Error("OCR ran but read no title: " + JSON.stringify(text.slice(0, 120)) + " (tiles " + m.tiles + ", items " + m.items.length + ", image " + m.gray?.length + ")"));
    });
    worker.postMessage({ type: "render", bytes: new Uint8Array(readFileSync(process.argv[2])), page: 1, dpi: 100, bandPx: 512 });
  }));
}
console.log("PROBE-RESULTS " + JSON.stringify(results));
`;

async function drawing() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([300, 200]);
  page.drawRectangle({ x: 20, y: 20, width: 200, height: 120, borderColor: rgb(0, 0, 0), borderWidth: 4 });
  // A printed title AS A PICTURE, the way a scan carries it, for the opt-in OCR step to read back. (Text drawn as
  // text would not reach the pixels: the worker renders with no standard-font data, and a scan has none to need.)
  const { createCanvas } = createRequire(join(ROOT, "node_modules", ".pnpm", "node_modules", "__check__.js"))("@napi-rs/canvas");
  const picture = createCanvas(900, 160);
  const ink = picture.getContext("2d");
  ink.fillStyle = "#ffffff";
  ink.fillRect(0, 0, 900, 160);
  ink.fillStyle = "#000000";
  ink.font = "bold 110px sans-serif";
  ink.fillText("FLOOR PLAN", 20, 125);
  page.drawImage(await pdf.embedPng(picture.toBuffer("image/png")), { x: 20, y: 145, width: 260, height: 46 });
  return pdf.save();
}

// The core modules tesseract.js-core ships (each `tesseract-core*.js` beside its .wasm.js and .wasm), read from the
// installed package, never from the function being judged.
const CORES = readdirSync(join(ROOT, "node_modules", ".pnpm", "node_modules", "tesseract.js-core"))
  .filter((f) => /^tesseract-core.*\.js$/.test(f) && !f.endsWith(".wasm.js"))
  .map((f) => f.replace(/\.js$/, ""));

function runProbe(label, workerDir, pdfPath, cwd) {
  const probe = join(workerDir, "__trace_probe.mjs");
  writeFileSync(probe, PROBE);
  try {
    const out = spawnSync(process.execPath, [probe, pdfPath], { cwd, encoding: "utf8", timeout: 180_000, env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", PROBE_CORES: JSON.stringify(CORES), RASTER_TRACE_OCR: process.env.RASTER_TRACE_OCR ?? "", PROBE_CACHE: join(tmpdir(), "prova-tessdata") } });
    const line = (out.stdout ?? "").split("\n").find((l) => l.startsWith("PROBE-RESULTS "));
    if (!line) {
      console.error(`raster-worker-trace-check: the probe printed no result in ${label} (exit ${out.status}). stderr: ${(out.stderr ?? "").slice(0, 2000)}`);
      process.exit(1);
    }
    return JSON.parse(line.slice("PROBE-RESULTS ".length));
  } finally {
    rmSync(probe, { force: true });
  }
}

if (!existsSync(ENTRY)) {
  console.error(`raster-worker-trace-check: no trace at ${relative(APP, ENTRY)}: did \`next build\` run, and does the scanned-sheet route still exist? A check that finds nothing must never pass.`);
  process.exit(1);
}
const { files = [] } = JSON.parse(readFileSync(ENTRY, "utf8"));
if (files.length < 50) {
  console.error(`raster-worker-trace-check: the route's trace lists ${files.length} files; a real function lists hundreds. Refusing to read that as a pass.`);
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), "raster-trace-"));
try {
  const pdfPath = join(work, "drawing.pdf");
  writeFileSync(pdfPath, await drawing());

  // The control: the same probe, in the repo, must pass, or the probe is what is broken.
  const control = runProbe("the repo", join(ROOT, WORKER_DIR), pdfPath, ROOT);
  const brokenControl = control.filter((r) => !r.ok);
  const steps = process.env.RASTER_TRACE_OCR === "1" ? 4 : 3;
  if (control.length !== steps || brokenControl.length > 0) {
    console.error("raster-worker-trace-check: the PROBE fails in the repo itself, so it cannot judge the function:");
    for (const r of brokenControl) console.error(`  ${r.name}: ${r.detail}`);
    process.exit(1);
  }

  // The function, as traced.
  const task = join(work, "task");
  let copied = 0;
  let links = 0;
  for (const file of files) {
    const abs = resolve(dirname(ENTRY), file);
    const rel = relative(ROOT, abs);
    if (rel.startsWith("..") || rel.split(sep).includes(".next")) continue; // the route's own build output is not what the worker needs
    const to = join(task, rel);
    mkdirSync(dirname(to), { recursive: true });
    const stat = lstatSync(abs, { throwIfNoEntry: false });
    if (stat === undefined) {
      console.error(`raster-worker-trace-check: the trace names ${rel}, which is not on disk: the build is stale. Run \`next build\` on this checkout first.`);
      process.exit(1);
    }
    if (stat.isSymbolicLink()) {
      symlinkSync(readlinkSync(abs), to);
      links += 1;
    } else if (stat.isFile()) {
      copyFileSync(abs, to);
      copied += 1;
    }
  }
  const workerInTask = join(task, WORKER_DIR);
  if (!existsSync(join(workerInTask, "rasterWorker.mjs"))) {
    console.error("raster-worker-trace-check: rasterWorker.mjs itself is not in the route's trace (outputFileTracingIncludes in next.config.mjs).");
    process.exit(1);
  }
  const shipped = runProbe("the function", workerInTask, pdfPath, task);
  const failed = shipped.filter((r) => !r.ok);
  if (shipped.length !== steps || failed.length > 0) {
    console.error(`FAIL: the scanned-sheet worker cannot run in the function as traced (${copied} files, ${links} links from ${relative(APP, ENTRY)}):`);
    for (const r of failed) console.error(`  ${r.name}\n    ${r.detail}`);
    process.exit(1);
  }
  console.log(`raster-worker-trace-check: the worker rendered and Tesseract's core loaded inside the traced function (${copied} files, ${links} links); ${shipped.map((r) => r.detail).join(", ")}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
