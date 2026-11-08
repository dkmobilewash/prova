import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "@/lib/plan-ingest/planPdf";
import { sheetNumberFrom } from "@/lib/plan-ingest/sheetNumber";
import { drawingSpecNotes, searchesSheet } from "./drawingSpecs";

/**
 * Scores the drawing-notes finder against a hand key: every Division 09/07 requirement a person
 * read off a set's notes, one per line as `set \t sheet \t needle \t class`, where the needle is a
 * substring of the note. FOUND = a kept note on that sheet contains the needle; MISSED = none does;
 * FALSE = a kept note that contains no needle of its set. The key is a client's words, so it lives
 * outside the repo (DRAWING_SPECS_KEY); DRAWING_SPECS_FILES maps each key set name to its PDF under
 * REAL_PLAN_DIR, as `Baker=a.pdf,Bunkie=b.pdf`. Calls no model.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const KEY = process.env.DRAWING_SPECS_KEY ?? "";
const OUT = process.env.DRAWING_SPECS_OUT ?? "";
const FILES = new Map((process.env.DRAWING_SPECS_FILES ?? "").split(",").filter(Boolean).map((p) => p.split("=") as [string, string]));

describe.skipIf(DIR === "" || KEY === "" || OUT === "" || FILES.size === 0)("drawing specs against a hand key", () => {
  it("counts found, missed and false per set", async () => {
    const key = readFileSync(KEY, "utf8").split("\n").filter((l) => l.trim() !== "" && !l.startsWith("#")).map((l) => {
      const [set, sheet, needle, kind] = l.split("\t");
      return { set, sheet, needle, kind };
    });
    expect(key.length).toBeGreaterThan(0);
    const out: string[] = [];
    for (const [set, file] of FILES) {
      const kept: { sheet: string; text: string }[] = [];
      const pdf = await openPlanPdf(readFileSync(join(DIR, file)));
      for (let page = 1; page <= pdf.pageCount; page++) {
        const text = await pdf.pageText(page);
        const sheet = sheetNumberFrom(text).sheetNumber;
        if (!searchesSheet(sheet)) continue;
        for (const note of drawingSpecNotes(text.items)) kept.push({ sheet: sheet ?? "?", text: note.text });
      }
      await pdf.close();
      const items = key.filter((k) => k.set === set);
      const found = items.filter((k) => kept.some((n) => n.sheet === k.sheet && n.text.includes(k.needle)));
      const missed = items.filter((k) => !found.includes(k));
      const falses = kept.filter((n) => !items.some((k) => n.text.includes(k.needle)));
      out.push(`## ${set}: found ${found.length} of ${items.length}, missed ${missed.length}, false ${falses.length} (kept ${kept.length})`);
      for (const k of missed) out.push(`MISSED\t${k.sheet}\t${k.kind}\t${k.needle}`);
      for (const n of falses) out.push(`FALSE\t${n.sheet}\t\t${n.text.slice(0, 160)}`);
    }
    writeFileSync(OUT, out.join("\n") + "\n");
  }, 600_000);
});
