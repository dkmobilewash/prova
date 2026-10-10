import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PARTITION_TYPES } from "./model";
import { standardFontDir, type BenchRun, type CaseResult } from "./run";
import type { Quantities } from "./harness";

/**
 * THE SCORECARD, the per-wall CSV, the holdout report and the overlays.
 *
 * The numbers are written as measured. Nothing here decides a pass bar beyond
 * the five the brief set; the founder summary is written by a person reading
 * these, not generated.
 */

const pct = (a: number, b: number) => (b === 0 ? "—" : `${(((a - b) / b) * 100).toFixed(1)}%`);
const f0 = (n: number) => n.toFixed(0);
const f1 = (n: number) => n.toFixed(1);

function scaleCell(r: CaseResult): string {
  const s = r.scale;
  if (s.outcome === "CORRECT") return `✅ ${s.named}${s.source === "PRINTED" ? " (title block)" : ""}`;
  if (s.outcome === "UNDETERMINED") return "⚪ declined";
  if (s.outcome === "UNDETERMINED_MISLEADING") return "🟡 declined, wrong reason";
  if (s.outcome === "OFFERED_UNSAVABLE") return "🟡 offered, refused on save";
  return `❌ ${s.named}${s.source === "PRINTED" ? " (title block)" : ""} — WRONG`;
}

function scaleExpected(r: CaseResult): string {
  if (r.key.scaleBehaviour === "decline") return r.key.expectedRefusal ? `decline (${r.key.expectedRefusal})` : "decline (no scale)";
  return r.key.scales.map((s) => `${s.view}: ${s.scaleName ?? "non-standard"}`).join("; ");
}

function passBars(run: BenchRun): string[] {
  const main = run.main;
  const wrong = main.filter((r) => r.scale.outcome === "WRONG_CONFIDENT" || r.scale.outcome === "WRONG_PRINTED");
  const scaleOk = main.filter((r) => r.scale.outcome === "CORRECT" || r.scale.outcome === "UNDETERMINED" || r.scale.outcome === "UNDETERMINED_MISLEADING").length;
  const lfCases = main.filter((r) => ["clean", "revit", "autocad", "skia"].includes(r.key.variant) && (r.key.sheetId === "A-101" || r.key.sheetId === "A-102"));
  const lfRows: string[] = [];
  let lfPass = true;
  for (const r of lfCases) {
    for (const [t, v] of Object.entries(r.walls.perType)) {
      const err = v.keyCl === 0 ? 0 : (v.found - v.keyCl) / v.keyCl;
      if (Math.abs(err) > 0.02) lfPass = false;
      lfRows.push(`${r.key.caseId}/${t} ${(err * 100).toFixed(1)}%`);
    }
  }
  const zero = main.filter((r) => !r.key.expectWalls);
  const zeroFail = zero.filter((r) => r.walls.phantom.lf + r.walls.duplicate.lf > 0);
  const missed10 = main.filter((r) => r.walls.missedOver10.length > 0);
  const scan = main.find((r) => r.key.variant === "scan");
  return [
    `| Scale: 100% correct or honestly undetermined, zero wrong-but-confident | ${wrong.length === 0 ? "✅ PASS" : "❌ FAIL"} | ${scaleOk}/${main.length} cases correct or declined; **${wrong.length} wrong-but-confident**: ${wrong.map((r) => `${r.key.caseId} (${r.scale.named})`).join(", ") || "none"} |`,
    `| In-scope wall LF within 2% per type (clean, Revit, AutoCAD, Skia) | ${lfPass ? "✅ PASS" : "❌ FAIL"} | ${lfRows.filter((x) => Math.abs(parseFloat(x.split(" ")[1])) > 2).length} of ${lfRows.length} type-totals outside ±2%; worst: ${[...lfRows].sort((a, b) => Math.abs(parseFloat(b.split(" ")[1])) - Math.abs(parseFloat(a.split(" ")[1]))).slice(0, 4).join(", ")} |`,
    `| Zero-wall sheets: 0 phantom LF | ${zeroFail.length === 0 ? "✅ PASS" : "❌ FAIL"} | ${zeroFail.length} of ${zero.length} zero-wall cases produced walls: ${zeroFail.map((r) => `${r.key.caseId} ${f0(r.walls.phantom.lf + r.walls.duplicate.lf)} ft`).join(", ")} |`,
    `| No wall over 10 ft missed entirely | ${missed10.length === 0 ? "✅ PASS" : "❌ FAIL"} | ${missed10.length} cases miss at least one; ${main.reduce((s, r) => s + r.walls.missedOver10.length, 0)} walls in total |`,
    `| Scanned sheet refuses with a clear message | ${scan && scan.walls.phantom.lf === 0 && scan.scale.outcome === "UNDETERMINED" ? "🟡 PARTIAL — the scale refusal is clear; the wall finder's is not" : "❌ FAIL"} | scale: "${scan?.scale.reason ?? "?"}"; walls: ${scan?.reader.pathOperators ?? "?"} path operators, so the finder returns nothing and the viewer says "No walls found on this sheet. That is a fact about the drawing, not a failure." |`,
  ];
}

function qRow(label: string, q: Record<string, Quantities>, ref: Record<string, Quantities> | null, types: string[]) {
  const cell = (t: string, k: keyof Quantities) => {
    const v = q[t]?.[k] ?? 0;
    const r = ref?.[t]?.[k];
    return r === undefined || ref === null ? f0(v) : `${f0(v)} (${pct(v, r)})`;
  };
  return types.map((t) => `| ${label} | ${t} | ${cell(t, "lf")} | ${cell(t, "studs")} | ${cell(t, "trackLf")} | ${cell(t, "boardSf")} | ${cell(t, "insulationSf")} |`);
}

export function writeReports(run: BenchRun, outDir: string, heuristicsMd: string): void {
  mkdirSync(outDir, { recursive: true });
  const main = [...run.main].sort((a, b) => b.badness - a.badness);
  const L: string[] = [];
  L.push("# Takeoff accuracy bench — scorecard");
  L.push("");
  L.push("Mesa Ridge Medical Office Building (fictional, generated). Every number below is the product's own pipeline run on a PDF this bench wrote, graded against an answer key computed from the model — never from the PDF. Regenerate with `TAKEOFF_BENCH=1 pnpm takeoff:bench`.");
  L.push("");
  L.push(`Main set: **${run.main.length} cases** across ${new Set(run.main.map((r) => r.key.sheetId)).size} sheets and ${new Set(run.main.map((r) => r.key.variant)).size} export variants, two PDF producers (hand-written raw PDF; Chromium/Skia from SVG). Holdout: ${run.holdout.length} seeded plans, reported separately in HOLDOUT.md.`);
  if (run.skipped.length) L.push(`\n**NOT RUN:** ${run.skipped.map((s) => `${s.caseId} — ${s.skipped}`).join("; ")}`);
  L.push("");
  L.push("## Against the pass bar");
  L.push("");
  L.push("| Bar | Result | Detail |");
  L.push("| --- | --- | --- |");
  L.push(...passBars(run));
  L.push("");
  L.push("## Mechanism probes — one heuristic, the smallest input that shows it");
  L.push("");
  L.push("Each probe calls the product function directly with nothing else on the page. ❌ = a confirmed defect, with the product's own output.");
  L.push("");
  L.push("| | Probe | Heuristic / code path | Input | Correct answer | Product says |");
  L.push("| --- | --- | --- | --- | --- | --- |");
  for (const p of run.probes) L.push(`| ${p.holds ? "✅" : "❌"} | ${p.id} | ${p.heuristic} | ${p.input} | ${p.expected} | ${p.observed} |`);
  L.push("");
  L.push("## Scorecard — one row per case, worst first");
  L.push("");
  L.push("LF columns are feet of in-scope wall the sheet should yield, measured at the TRUE scale (detection alone), centreline convention. `face` is what a perfect two-face pair-finder could claim (the overlap of the two drawn faces — junctions and openings removed); both conventions are reported because an estimator measures centrelines and the geometry only supports faces.");
  L.push("");
  L.push("| # | Case | Producer | Scale expected | Scale got | Walls found/partial/missed of counted | LF found / key CL (face) | Error vs CL | Phantom (n / ft) | Must-not-count ft | Out-of-scope ft | Double ft | Targets |");
  L.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  main.forEach((r, i) => {
    const w = r.walls;
    L.push(
      `| ${i + 1} | ${r.key.caseId} | ${r.key.producer} | ${scaleExpected(r)} | ${scaleCell(r)} | ${w.counted ? `${w.found}/${w.partial}/${w.missed} of ${w.counted}` : "—"} | ${w.counted ? `${f0(w.trueLf)} / ${f0(w.keyClLf)} (${f0(w.keyFaceLf)})` : "—"} | ${w.counted ? pct(w.trueLf, w.keyClLf) : "—"} | ${w.phantom.count} / ${f0(w.phantom.lf + w.duplicate.lf)} | ${f0(w.mustNotCount.lf)} | ${f0(w.outOfScope.lf)} | ${f0(w.doubleCountLf)} | ${r.key.targets} |`,
    );
  });
  L.push("");
  L.push("## Findings per case, worst first");
  L.push("");
  for (const r of main) {
    if (r.findings.length === 0) continue;
    L.push(`**${r.key.caseId}** — ${r.key.title}; ${VARIANT_LABEL(r)}`);
    L.push("");
    for (const f of r.findings) L.push(f.startsWith("  ") ? `    - ${f.trim()}` : `- ${f}`);
    L.push(`- overlay: \`overlays/${r.key.caseId}.png\``);
    L.push("");
  }
  L.push("## In-scope LF by wall type (bid sheets)");
  L.push("");
  L.push("| Case | Type | Key CL ft | Key face ft | Found ft | Error vs CL | Error vs face |");
  L.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const r of run.main.filter((x) => x.key.sheetId === "A-101" || x.key.sheetId === "A-102")) {
    for (const [t, v] of Object.entries(r.walls.perType)) L.push(`| ${r.key.caseId} | ${t} | ${f1(v.keyCl)} | ${f1(v.keyFace)} | ${f1(v.found)} | ${pct(v.found, v.keyCl)} | ${pct(v.found, v.keyFace)} |`);
  }
  L.push("");
  L.push("## Materials");
  L.push("");
  const mat = run.main.find((r) => r.key.caseId === "A-101__clean")?.materials;
  if (mat) {
    const types = Object.keys(mat.handApp);
    L.push("A-101, clean. Four ways to the same quantities. **(1)** the app's assembly rules written out by hand, independently of the app; **(2)** the app's own `scheduleLines` on the answer-key runs — (1) and (2) agreeing is the check on the recipe math; **(3)** an estimator's hand count (every opening deducted from board, door widths out of the bottom track, two jamb studs each side of an opening) — the gap between (1) and (3) is shop convention, not a bug; **(4)** the Find-the-walls path: every found group accepted, each given the type most of its footage really is and that type's commonest height, posted as `postMeasuredWallRun` does (one run per group, no openings typed). Percentages are against (1).");
    L.push("");
    L.push("| Path | Type | LF | Studs | Track LF | Board SF | Insulation SF |");
    L.push("| --- | --- | --- | --- | --- | --- | --- |");
    L.push(...qRow("(1) app rules, by hand", mat.handApp, null, types));
    L.push(...qRow("(2) app scheduleLines", mat.app, mat.handApp, types));
    L.push(...qRow("(3) estimator by hand", mat.estimator, mat.handApp, types));
    L.push(...qRow("(4) Find the walls → post", mat.foundPath, mat.handApp, types));
    L.push("");
    for (const n of mat.notes) L.push(`- ${n}`);
    L.push("");
  }
  for (const r of run.main.filter((x) => x.materials && x.key.caseId !== "A-101__clean" && ["revit", "autocad", "skia"].includes(x.key.variant))) {
    const m = r.materials!;
    const tot = (q: Record<string, Quantities>, k: keyof Quantities) => Object.values(q).reduce((s, v) => s + v[k], 0);
    L.push(`- ${r.key.caseId}: Find-the-walls path board ${f0(tot(m.foundPath, "boardSf"))} SF vs ${f0(tot(m.handApp, "boardSf"))} (${pct(tot(m.foundPath, "boardSf"), tot(m.handApp, "boardSf"))}); studs ${f0(tot(m.foundPath, "studs"))} vs ${f0(tot(m.handApp, "studs"))} (${pct(tot(m.foundPath, "studs"), tot(m.handApp, "studs"))})`);
  }
  L.push("");
  L.push("## Schedules (deterministic half: `tableRowsFromPage`)");
  L.push("");
  for (const r of run.main.filter((x) => x.schedules)) {
    const s = r.schedules!;
    L.push(`- **${r.key.caseId}**: looksLikeTable=${s.looksLikeTable}; ${s.expected} schedule rows expected, ${s.exact} reach the model as an exact row, ${s.merged} merged with a row of the OTHER schedule, ${s.shifted} have blank cells dropped (columns no longer line up), ${s.missing} missing, ${s.orphanRows} orphan rows from wrapped cells. Examples: ${s.examples.map((e) => `\`${e}\``).join("; ")}`);
  }
  L.push("");
  L.push("## Addendum 2 and takeoff currency");
  L.push("");
  for (const a of run.addendum) L.push(`- ${a}`);
  for (const c of run.currency) L.push(`- ${c}`);
  L.push("");
  L.push("## How each stage decides, and which case targets which threshold");
  L.push("");
  L.push(heuristicsMd);
  writeFileSync(join(outDir, "SCORECARD.md"), L.join("\n") + "\n");

  const header = "case,set,view,wall,type,in_scope,counted,why_not,key_cl_ft,key_face_ft,key_net_ft,height_ft,runs,reported_ft,covered_ft,err_vs_cl_pct,err_vs_face_pct,double_count_ft,status,diagnosis";
  writeFileSync(join(outDir, "walls.csv"), [header, ...run.main.flatMap((r) => r.wallRows)].join("\n") + "\n");
  writeFileSync(join(outDir, "holdout-walls.csv"), [header, ...run.holdout.flatMap((r) => r.wallRows)].join("\n") + "\n");

  const H: string[] = [];
  H.push("# Holdout — run once, reported separately");
  H.push("");
  H.push(`${run.holdout.length} seeded random plans (seeds in \`holdout.ts\`) built from the same partition types, junctions and export quirks. **A fix may be tuned on the main set; it must be validated here.**`);
  H.push("");
  H.push("| Case | Variant | Scale | Found/partial/missed of counted | LF found / key CL | Error | Phantom ft | Biggest loss |");
  H.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of run.holdout) {
    const top = Object.entries(r.walls.diagnoses).sort((a, b) => b[1].lf - a[1].lf)[0];
    H.push(`| ${r.key.caseId} | ${r.key.variant} | ${scaleCell(r)} | ${r.walls.found}/${r.walls.partial}/${r.walls.missed} of ${r.walls.counted} | ${f0(r.walls.trueLf)} / ${f0(r.walls.keyClLf)} | ${pct(r.walls.trueLf, r.walls.keyClLf)} | ${f0(r.walls.phantom.lf)} | ${top ? `${f0(top[1].lf)} ft: ${top[0]}` : "—"} |`);
  }
  const tot = (xs: CaseResult[], k: "trueLf" | "keyClLf") => xs.reduce((s, r) => s + r.walls[k], 0);
  H.push("");
  H.push(`Total: ${f0(tot(run.holdout, "trueLf"))} of ${f0(tot(run.holdout, "keyClLf"))} ft (${pct(tot(run.holdout, "trueLf"), tot(run.holdout, "keyClLf"))}); wrong-but-confident scales: ${run.holdout.filter((r) => r.scale.outcome.startsWith("WRONG")).length}.`);
  writeFileSync(join(outDir, "HOLDOUT.md"), H.join("\n") + "\n");

  writeFileSync(
    join(outDir, "results.json"),
    JSON.stringify(
      {
        main: run.main.map(({ overlay, wallRows, ...rest }) => (void overlay, void wallRows, { ...rest, key: { ...rest.key, walls: undefined } })),
        holdout: run.holdout.map(({ overlay, wallRows, ...rest }) => (void overlay, void wallRows, { ...rest, key: { ...rest.key, walls: undefined } })),
        probes: run.probes,
        addendum: run.addendum,
        currency: run.currency,
        skipped: run.skipped,
      },
      null,
      1,
    ),
  );
}

const VARIANT_LABEL = (r: CaseResult) => r.key.targets;

/** Overlays: the real PDF rendered by pdfjs, then the key and the findings drawn over it. */
export async function writeOverlays(cases: CaseResult[], outDir: string, pdfDir: string): Promise<number> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // @ts-expect-error pdfjs ships no types for the worker build; imported for its side effect.
  await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  mkdirSync(join(outDir, "overlays"), { recursive: true });
  let n = 0;
  for (const r of cases) {
    const bytes = readFileSync(join(pdfDir, `${r.key.caseId}.pdf`));
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0, standardFontDataUrl: standardFontDir() }).promise;
    try {
      const page = await doc.getPage(1);
      const scale = 1600 / page.getViewport({ scale: 1 }).width;
      const vp = page.getViewport({ scale });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pdfjs's node canvas factory is untyped.
      const { canvas, context } = (doc as any).canvasFactory.create(Math.ceil(vp.width), Math.ceil(vp.height));
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, vp.width, vp.height);
      await page.render({ canvasContext: context, viewport: vp }).promise;
      // Fade the drawing so the overlay reads.
      context.fillStyle = "rgba(255,255,255,0.55)";
      context.fillRect(0, 0, vp.width, vp.height);
      const px = (u: number) => u * vp.width;
      const line = (x1: number, y1: number, x2: number, y2: number, color: string, w: number, dash: number[] = []) => {
        context.strokeStyle = color;
        context.lineWidth = w;
        context.setLineDash(dash);
        context.beginPath();
        context.moveTo(px(x1), px(y1));
        context.lineTo(px(x2), px(y2));
        context.stroke();
      };
      for (const w of r.key.walls) {
        const color = !w.count ? "rgba(120,120,120,0.9)" : w.inScope ? "rgba(30,90,220,0.45)" : "rgba(140,60,200,0.45)";
        const dash = !w.count ? [6, 4] : [];
        if (w.display) line(w.display.x1, w.display.y1, w.display.x2, w.display.y2, color, w.count ? 7 : 3, dash);
        if (w.arc) {
          context.strokeStyle = color;
          context.lineWidth = 7;
          context.setLineDash([]);
          context.beginPath();
          context.arc(px(w.arc.cx), px(w.arc.cy), px(w.arc.r), (w.arc.a0 * Math.PI) / 180, (w.arc.a1 * Math.PI) / 180);
          context.stroke();
        }
      }
      const colors: Record<string, string> = { TRUE: "#0a9d3a", PHANTOM: "#e01010", MUST_NOT_COUNT: "#ff8c00", OUT_OF_SCOPE: "#9b30ff", DUPLICATE: "#e010c0" };
      for (const g of r.overlay.graded) line(g.run.x1, g.run.y1, g.run.x2, g.run.y2, colors[g.cls], 2.2);
      for (const w of r.overlay.walls) {
        if (w.wall.count && w.wall.inScope && w.status === "MISSED" && w.wall.display) {
          const d = w.wall.display;
          context.fillStyle = "#e01010";
          context.font = "bold 13px sans-serif";
          context.fillText("MISSED", px((d.x1 + d.x2) / 2) + 4, px((d.y1 + d.y2) / 2) - 4);
        }
      }
      // Legend.
      const items: [string, string][] = [
        ["rgba(30,90,220,0.6)", "expected wall (answer key)"],
        ["rgba(120,120,120,0.9)", "expected NOT counted (demo / hidden / clipped / duplicate)"],
        ["#0a9d3a", "found, on a real in-scope wall"],
        ["#e01010", "PHANTOM — no wall there"],
        ["#ff8c00", "counted but must not be"],
        ["#9b30ff", "found on CMU / storefront (not drywall scope)"],
        ["#e010c0", "found on a wall repeated from the floor plan (RCP / MEP background)"],
      ];
      context.fillStyle = "rgba(255,255,255,0.95)";
      context.fillRect(8, 8, 470, 30 + items.length * 20);
      context.fillStyle = "#000";
      context.font = "bold 15px sans-serif";
      context.fillText(`${r.key.caseId}  —  ${r.walls.found}/${r.walls.counted} found, ${r.walls.missed} missed, ${r.walls.phantom.count} phantom`, 16, 28);
      context.font = "13px sans-serif";
      items.forEach(([c, label], i) => {
        context.fillStyle = c;
        context.fillRect(16, 40 + i * 20, 26, 8);
        context.fillStyle = "#000";
        context.fillText(label, 50, 48 + i * 20);
      });
      writeFileSync(join(outDir, "overlays", `${r.key.caseId}.png`), canvas.toBuffer("image/png"));
      n += 1;
      page.cleanup();
    } finally {
      await doc.destroy();
    }
  }
  return n;
}

export { PARTITION_TYPES };
