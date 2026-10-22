import { Buffer } from "node:buffer";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sheetStrokes } from "../sheetStrokes";

/**
 * ── DOES OUR READER SEE WHAT THE RENDERER DREW? ──
 *
 * The why-run says 87% of missed BIM footage has "no stroke along either
 * face". The keys say otherwise: `pdf_readback` reports every segment found
 * again in the PDF, and 3,063 of one sheet's 9,354 are walls. Both cannot be
 * right, and the difference is the whole diagnosis — a finder that cannot pair
 * two faces is a different problem from a reader that never hands it the
 * faces.
 *
 * So: our stroke count against the key's own count, per sheet. Nothing is
 * inferred from the walls; this compares two totals that should match.
 */
const DIR = process.env.BIM_DIR ?? "";

describe.skipIf(DIR === "")("the reader against the key's own stroke count", () => {
  it("counts what each side says is on the page", { timeout: 3_600_000 }, async () => {
    const models = readdirSync(DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();

    console.log(
      `\n${"sheet".padEnd(34)} ${"key segs".padStart(9)} ${"we read".padStart(9)} ${"ratio".padStart(7)}` +
        ` ${"key walls".padStart(10)} ${"curves".padStart(7)}`,
    );
    const rows: { id: string; keyN: number; ours: number }[] = [];

    for (const model of models) {
      const here = join(DIR, model);
      for (const jsonName of readdirSync(here).filter((f) => f.endsWith(".json")).sort()) {
        const key = JSON.parse(readFileSync(join(here, jsonName), "utf8")) as {
          id: string;
          features: { id: number; type: string }[];
          piece_counts: { segments: number; curves: number };
          pieces: { segments: number[][] };
        };
        const read = await sheetStrokes(
          Buffer.from(readFileSync(join(here, jsonName.replace(/\.json$/, ".pdf")))),
          1,
        );
        const ours = read?.segments.length ?? 0;
        const typeOf = new Map(key.features.map((f) => [f.id, f.type]));
        const keyWallSegs = key.pieces.segments.filter((s) => typeOf.get(s[4]) === "wall").length;
        rows.push({ id: key.id, keyN: key.piece_counts.segments, ours });
        console.log(
          `${key.id.slice(0, 33).padEnd(34)} ${String(key.piece_counts.segments).padStart(9)}` +
            ` ${String(ours).padStart(9)} ${(ours / Math.max(key.piece_counts.segments, 1)).toFixed(2).padStart(7)}` +
            ` ${String(keyWallSegs).padStart(10)} ${String(key.piece_counts.curves).padStart(7)}`,
        );
      }
    }

    const keyAll = rows.reduce((n, r) => n + r.keyN, 0);
    const oursAll = rows.reduce((n, r) => n + r.ours, 0);
    console.log(
      `\nWHOLE SET  key says ${keyAll.toLocaleString()} segments, we read ${oursAll.toLocaleString()}` +
        `  (${((oursAll / keyAll) * 100).toFixed(1)}%)`,
    );
    expect(rows.length).toBeGreaterThan(0);
  });
});
