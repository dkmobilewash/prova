import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { sheetStrokes } from "../sheetStrokes";
import { shapeFromLegend, tagSymbols, type TagSymbol } from "../tagSymbols";

/**
 * ── WHAT SYMBOLS ARE ACTUALLY DRAWN ON THESE SHEETS ──
 *
 * Before anything matches a tag to a wall, the tags have to be found. This
 * prints every small closed symbol on the named pages with its shape, its
 * contents and why it was rejected if it was, so the detector can be judged
 * against a sheet somebody can open rather than against a fixture.
 *
 *     REAL_PLAN_DIR=… TS_SHEETS="<file>:8,16" npx vitest run \
 *       --config vitest.eval.config.mts lib/takeoff/realplan/zzTagSymbols.eval.ts
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const SHEETS = (process.env.TS_SHEETS ?? "").trim();

function summarise(symbols: readonly TagSymbol[]): string {
  const byShape = new Map<string, number>();
  for (const s of symbols) byShape.set(s.shape, (byShape.get(s.shape) ?? 0) + 1);
  const byReject = new Map<string, number>();
  for (const s of symbols) {
    const key = s.rejected ?? "accepted";
    byReject.set(key, (byReject.get(key) ?? 0) + 1);
  }
  return (
    `    shapes: ${[...byShape].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ")}\n` +
    `    verdicts: ${[...byReject].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ")}`
  );
}

describe.skipIf(DIR === "" || SHEETS === "")("symbols on a sheet", () => {
  it("prints what the detector finds", { timeout: 1_800_000 }, async () => {
    const pagesSeen: number[] = [];
    let symbolsAnywhere = 0;
    for (const token of SHEETS.split(";").filter((t) => t.includes(":"))) {
      const at = token.lastIndexOf(":");
      const file = token.slice(0, at);
      const doc = await openPlanPdf(Buffer.from(readFileSync(join(DIR, file))));
      for (const page of token
        .slice(at + 1)
        .split(",")
        .map(Number)) {
        const read = await sheetStrokes(Buffer.from(readFileSync(join(DIR, file))), page);
        if (read === null) continue;
        pagesSeen.push(page);
        const text = await doc.pageText(page);
        // Paper inches: the page is `widthPt / 72` inches across.
        const unitsPerPaperInch = 72;
        const symbols = tagSymbols({
          segments: read.segments,
          text: text.items.map((i) => ({
            str: i.str,
            x: i.x,
            y: i.y,
            width: i.width,
            height: i.height,
          })),
          unitsPerPaperInch,
        });
        symbolsAnywhere += symbols.length;
        const accepted = symbols.filter((s) => s.rejected === null);
        // eslint-disable-next-line no-console
        console.log(
          `\n${file.slice(0, 26)} p${page} — ${read.segments.length.toLocaleString()} segments, ` +
            `${symbols.length} symbols, ${accepted.length} could be tags\n` +
            summarise(symbols) +
            `\n    legend shape: ${shapeFromLegend(symbols) ?? "no shape dominates"}` +
            (accepted.length === 0
              ? ""
              : `\n    codes: ${[...new Set(accepted.map((s) => `${s.text}(${s.shape})`))]
                  .slice(0, 24)
                  .join("  ")}`) +
            (process.env.TS_DETAIL !== "1"
              ? ""
              : `\n    every symbol with text, by shape:\n` +
                symbols
                  .filter((s) => s.text !== "")
                  .sort((a, b) => a.shape.localeCompare(b.shape) || a.text.localeCompare(b.text))
                  .slice(0, 60)
                  .map(
                    (s) =>
                      `      ${s.shape.padEnd(9)} r=${(s.radius / 72).toFixed(3)}in` +
                      ` corners=${String(s.corners).padStart(2)}` +
                      ` ${s.split ? "SPLIT " : "      "}` +
                      `${(s.rejected ?? "ok").padEnd(16)} "${s.text.slice(0, 30)}"`,
                  )
                  .join("\n")) +
            (symbols.filter((s) => s.rejected === "sheet-reference").length === 0
              ? ""
              : `\n    sheet refs: ${[
                  ...new Set(
                    symbols.filter((s) => s.rejected === "sheet-reference").map((s) => s.text),
                  ),
                ]
                  .slice(0, 12)
                  .join(" ")}`),
        );
      }
    }
    // The input resolved: a TS_SHEETS naming no real file would otherwise
    // print nothing and pass as a quiet success.
    expect(
      pagesSeen.length,
      "no page was read at all — check REAL_PLAN_DIR and TS_SHEETS",
    ).toBeGreaterThan(0);
    // A run that found no symbol at all says nothing about the sheets; it says
    // the detector did not run.
    expect(symbolsAnywhere, "no symbol was found on any page").toBeGreaterThan(0);
  });
});
