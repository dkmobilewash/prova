import { Buffer } from "node:buffer";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";

/** Every text item on the named pages that could be a ceiling tag, legend row or height, with its position. */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const OUT = process.env.CEILING_TAGTEXT_OUT ?? "";
const PAGES = (process.env.CEILING_PAGES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const TAGGY = /\b(?:ACT|ACP|GWB|GYP|GB|CLG|CEILING|LAY-?IN|OPEN\s+TO|EXPOSED|A\.?F\.?F|SUSP|SOFFIT|BULKHEAD|TILE|C-?\d|CT-?\d)\b|^\d{1,2}'\s*-?\s*\d{0,2}"?$|^[A-Z]{1,4}-?\d{1,2}$/i;

describe.skipIf(DIR === "" || PAGES.length === 0)("ceiling tag text", () => {
  it("lists the taggy items per page", { timeout: 1_800_000 }, async () => {
    const lines: string[] = [];
    for (const spec of PAGES) {
      const [set, p] = spec.split(":");
      const page = Number(p);
      const doc = await openPlanPdf(Buffer.from(readFileSync(join(DIR, set))));
      const text = await doc.pageText(page);
      await doc.close();
      const items = text.items.map((i) => ({ str: i.str.trim(), x: i.x / text.widthPt, y: i.y / text.widthPt, h: i.height })).filter((i) => i.str && TAGGY.test(i.str) && i.str.length < 50);
      lines.push(`\n${set} p${page}: ${items.length} taggy items of ${text.items.length}`);
      const counts = new Map<string, number>();
      for (const i of items) counts.set(i.str.toUpperCase(), (counts.get(i.str.toUpperCase()) ?? 0) + 1);
      lines.push("  by text: " + [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([s, n]) => `${s}×${n}`).join(" | "));
      for (const i of items.slice(0, 400)) lines.push(`  ${i.str.padEnd(28)} x=${i.x.toFixed(3)} y=${i.y.toFixed(3)} h=${i.h.toFixed(1)}`);
    }
    if (OUT) writeFileSync(OUT, lines.join("\n"));
    console.log(lines.slice(0, 3).join("\n"));
    expect(PAGES.length).toBeGreaterThan(0);
  });
});
