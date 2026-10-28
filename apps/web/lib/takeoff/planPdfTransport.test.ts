import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLAN_PDF_TRANSPORT } from "./planPdfTransport";

/**
 * Every pdf.js document opened on the plan route carries the transport —
 * one default-transport open streams the whole set again beside the viewer's,
 * which is the first-load cost `planPdfTransport.ts` measures. The count is
 * asserted against the number of opens found, so a drifted pattern fails
 * rather than passing an empty set (CLAUDE.md, "a guard that parses by regex").
 */
describe("plan documents open through PLAN_PDF_TRANSPORT", () => {
  const dir = join(__dirname, "../../components");
  const opens: { file: string; carries: boolean }[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".tsx") || file.includes(".test.")) continue;
    const text = readFileSync(join(dir, file), "utf8");
    // Lazy to the `}).promise` close: `${planId}` holds a brace of its own.
    for (const m of text.matchAll(/getDocument\(\{[\s\S]*?\}\)\.promise/g)) {
      if (!m[0].includes("/api/takeoff/plan/")) continue;
      opens.push({ file, carries: m[0].includes("...PLAN_PDF_TRANSPORT") });
    }
  }
  it("finds the opens it reasons about", () => {
    expect(opens.length).toBeGreaterThanOrEqual(3);
  });
  it("sees every one carry the transport", () => {
    expect(opens.filter((o) => !o.carries).map((o) => o.file)).toEqual([]);
  });
  it("turns off both background fetches, not one — alone, autoFetch changed nothing", () => {
    expect(PLAN_PDF_TRANSPORT.disableAutoFetch && PLAN_PDF_TRANSPORT.disableStream).toBe(true);
    expect(PLAN_PDF_TRANSPORT.rangeChunkSize).toBeGreaterThanOrEqual(1024 * 1024);
  });
});
