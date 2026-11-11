import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { it } from "vitest";
import { hasTextLayer, openPlanPdf } from "../../plan-ingest/planPdf";
import { readScaleFromSheet } from "../../plan-ingest/pageInventory";
import { SNAP_SOURCE } from "../scaleFromDimensions";
import { excludedSheetReason, isHeldOut } from "../heldOutSets";

/**
 * ── SCALE SNAP ON EVERY LABELLED TRAINING SHEET ──
 *
 * What the inventory's scale read (`readScaleFromSheet`, the stage's own function) stores on
 * each labelled sheet, against the scale the labeller worked at (`feetPerUnit`, feet across the
 * page width). A snap is only ever stored where every other reader declined, so a sheet that
 * reads today reads the same — this counts that, and grades each NEW snap offer: right when
 * its feet across the page are within 2% of the key's.
 *
 *     LABEL_DIR=<labels> REAL_PLAN_DIR=<dir>[:<dir>] OUT=<file> \
 *       npx vitest run --config vitest.eval.config.mts lib/takeoff/realplan/scaleSnap.eval.ts
 *
 * HELD_OUT=1 grades the held-out sets instead (measured once). Prints counts and sheet
 * numbers; never plan text.
 */
const LABELS = process.env.LABEL_DIR ?? "";
const DIRS = (process.env.REAL_PLAN_DIR ?? "").split(":").filter((d) => d !== "");
const HELD = process.env.HELD_OUT === "1";
const norm = (s: string) => s.toLowerCase().replace(/\.pdf$/, "").replace(/[^a-z0-9]/g, "");

function pdfs(dir: string, out = new Map<string, string>()): Map<string, string> {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) pdfs(full, out);
    else if (name.toLowerCase().endsWith(".pdf") && !out.has(norm(name))) out.set(norm(name), full);
  }
  return out;
}

it.skipIf(LABELS === "" || DIRS.length === 0)("scale snap on labelled sheets", { timeout: 3_600_000 }, async () => {
  const files = new Map<string, string>();
  for (const d of DIRS) pdfs(d, files);
  const lines: string[] = [];
  const tally = { sheets: 0, missing: 0, readToday: 0, readRight: 0, declined: 0, snapped: 0, snapRight: 0 };
  for (const set of readdirSync(LABELS).sort()) {
    if (isHeldOut(set) !== HELD) continue;
    const file = files.get(norm(set));
    const sheets = readdirSync(path.join(LABELS, set)).filter((f) => f.endsWith(".json"));
    if (file === undefined) {
      tally.missing += sheets.length;
      lines.push(`MISSING ${set} (${sheets.length} sheets)`);
      continue;
    }
    const doc = await openPlanPdf(Buffer.from(readFileSync(file)));
    for (const name of sheets) {
      const label = JSON.parse(readFileSync(path.join(LABELS, set, name), "utf8")) as { sheet: string; page: number; feetPerUnit?: number };
      if (excludedSheetReason(set, label.sheet) !== null || !(Number(label.feetPerUnit) > 0)) continue;
      tally.sheets += 1;
      const page = await doc.pageText(label.page);
      const row = await readScaleFromSheet(doc, page, "eval", label.page, hasTextLayer(page));
      const feet = row.declaredDistanceFeet === null ? null : Number(row.declaredDistanceFeet) / Math.hypot(Number(row.x2) - Number(row.x1), Number(row.y2) - Number(row.y1));
      const right = feet !== null && Math.abs(feet - Number(label.feetPerUnit)) / Number(label.feetPerUnit) <= 0.02;
      const what = `${set} ${label.sheet} p${label.page}`;
      if (row.source === SNAP_SOURCE) {
        tally.declined += 1;
        tally.snapped += 1;
        if (right) tally.snapRight += 1;
        lines.push(`SNAP ${right ? "RIGHT" : "WRONG"} ${what}: ${row.scaleName} from ${(row.agreedText ?? "").split("\n").length} dimensions (key ${label.feetPerUnit} ft across, snap ${feet?.toFixed(1)})`);
      } else if (row.scaleName !== null) {
        tally.readToday += 1;
        if (right) tally.readRight += 1;
        lines.push(`READ ${right ? "right" : "wrong"} ${what}: ${row.scaleName} (${row.source})`);
      } else {
        tally.declined += 1;
        lines.push(`DECLINED ${what}: ${(row.declineReason ?? "").slice(0, 90)}`);
      }
    }
    await doc.close();
  }
  const summary = `${HELD ? "HELD-OUT" : "TRAINING"} sheets ${tally.sheets} (+${tally.missing} without a PDF) · read today ${tally.readToday} (right ${tally.readRight}, unchanged by snap) · declined ${tally.declined} · snap offered ${tally.snapped}, right ${tally.snapRight}`;
  lines.unshift(summary);
  console.error(summary);
  if (process.env.OUT) writeFileSync(process.env.OUT, lines.join("\n") + "\n");
});
