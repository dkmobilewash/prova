import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/ai/stripComments";

/**
 * ── ONE FUNCTION DECIDES WHAT A WALL LIST HOLDS BACK (prereg-live-list-parity.md) ──
 *
 * The customer's live "Run takeoff" list applied neither the run model nor R, which only server detection loaded,
 * so the list a contractor watched was less filtered than what posting and auto-post used. Both now call
 * `heldOnSheet`. This fails if either stops, or if any other product code starts deciding holds itself by calling
 * the three functions underneath — the way the two paths drifted apart in the first place. Code, not comments, is
 * read: this repo's comments quote the very names it forbids.
 */
const WEB = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const ROOTS = ["lib", "components", "app"];
const DECIDERS = /\b(?:runsHeldOffEstimate|runModelVerdicts|renoModelRemovals)\(/;
/** Where the three may be called: the function itself, and the module that defines the run model's two. */
const ALLOWED = new Set(["lib/takeoff/heldOnSheet.ts", "lib/takeoff/wallRunVerdicts.ts"]);

function productFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) productFiles(path, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|dbtest|eval)\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}
const code = (rel: string) => stripComments(readFileSync(join(WEB, rel), "utf8"));

describe("the live list and detection hold back the same runs", () => {
  const files = ROOTS.flatMap((root) => productFiles(join(WEB, root))).map((p) => relative(WEB, p));

  it("reads the whole product (a scan that sees nothing passes everything)", () => {
    expect(files.length).toBeGreaterThan(1000);
    expect(files).toContain("components/TakeoffPlanViewer.tsx");
    expect(files).toContain("lib/takeoff/detectWallsForCalibration.ts");
  });

  it("no product code but heldOnSheet calls the hold deciders directly", () => {
    const callers = files.filter((rel) => DECIDERS.test(code(rel)));
    expect(callers.filter((rel) => !ALLOWED.has(rel))).toEqual([]);
    expect(callers.sort()).toEqual([...ALLOWED].sort());
  });

  it("detection and the viewer each call heldOnSheet, and the viewer takes its held runs off the list", () => {
    expect(code("lib/takeoff/detectWallsForCalibration.ts")).toContain("heldOnSheet(");
    const viewer = code("components/TakeoffPlanViewer.tsx");
    expect(viewer).toContain("heldOnSheet(");
    expect(viewer).toContain("!liveHeld?.has(at)");
    expect(viewer).toContain("!liveHeldRef.current?.has(i)");
    // The models the viewer decides with are detection's own loader's.
    expect(code("lib/takeoff/workspaceLoad.ts")).toContain('process.env.TAKEOFF_LIVE_MODEL_PARITY === "1" ? serverHeldModels(');
  });
});
