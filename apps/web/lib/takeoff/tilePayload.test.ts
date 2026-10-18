import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ── WHY A SCANNED TILE IS SENT AS JPEG, AND WHAT IT HAS TO FIT INSIDE ──
 *
 * Read this sheet worked on a clean fixture and failed on a real scan, which
 * is the worst possible way round: it worked everywhere except on the sheets
 * the feature exists for.
 *
 * Measured on the committed fixtures, biggest tile of each sheet, base64:
 *
 *   | sheet            | PNG     | JPEG q90 |
 *   | S18 (clean)      | 0.08 MB | —        |
 *   | S20 (light)      | 0.77 MB | 0.46 MB  |
 *   | S19 (speckled)   | 1.20 MB | 0.54 MB  |
 *
 * A Server Action's body is capped at 1 MB unless `next.config.mjs` says
 * otherwise, and nothing said otherwise. So the speckled tile — the one most
 * like a real scan — was refused by the framework before any of this app's
 * code ran, and the browser got a dead socket rather than a sentence. SPECKLE
 * IS WHAT BREAKS PNG, and speckle is what a scan is made of.
 *
 * These cases pin the decisions that followed. None of them calls a model:
 * `sheetText.eval.ts` measures whether the reading is any good, and this
 * measures whether the request can arrive at all.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("the tile that goes over the wire", () => {
  it("IS JPEG, because a scan's speckle is the worst case for PNG", () => {
    // SCOPED TO THE SCAN HANDLER. The wall classifier on the same toolbar
    // also renders a crop and legitimately sends PNG: it is a close-up with
    // lines drawn on it, not a page of speckled paper, and its sizes are
    // nowhere near the limit. A viewer-wide ban on PNG failed on that one and
    // would have been a census answering about the wrong feature.
    const viewer = read("components/TakeoffPlanViewer.tsx");
    const handler = viewer.slice(viewer.indexOf("const onReadSheet"), viewer.indexOf("const onCheckRuns"));
    expect(handler.length, "the scan handler could not be located").toBeGreaterThan(500);
    expect(handler).toMatch(/toDataURL\("image\/jpeg"/);
    expect(handler).toMatch(/mediaType: "image\/jpeg"/);
    expect(handler, "a PNG tile was 1.20 MB on the speckled fixture").not.toMatch(/toDataURL\("image\/png"/);
  });

  it("STATES the Server Action body limit rather than inheriting one", () => {
    // The limit that broke this was a default nobody had chosen. A number
    // somebody chose can be read, argued with and raised; a default cannot.
    expect(read("next.config.mjs")).toMatch(/serverActions:\s*\{\s*bodySizeLimit:/);
  });

  it("guards a size BELOW that limit, not above it", () => {
    // The action's own guard said 7 MB, copied from the wall classifier, while
    // the framework refused at 1 MB — so the guard could never fire and its
    // readable sentence was unreachable. A guard above the real ceiling is
    // not a guard.
    const action = read("lib/actions/takeoffReadSheet.ts");
    const guard = action.match(/imageBase64\.length > ([0-9_]+)/);
    expect(guard, "the size guard is gone").not.toBeNull();
    const limit = Number(guard![1].replace(/_/g, ""));
    const configured = read("next.config.mjs").match(/bodySizeLimit:\s*"(\d+)mb"/);
    expect(configured, "no body limit is configured to compare against").not.toBeNull();
    expect(limit).toBeLessThan(Number(configured![1]) * 1_000_000);
  });

  it("gives the ROUTE a longer budget than the model client's own timeout", () => {
    // ── THE ORDERING THAT WAS INVERTED ──
    //
    // The SDK waits 120 seconds; the route was ending the whole invocation at
    // 60. So the timeout meant to expire FIRST, and report why, could never
    // run — and a killed invocation writes no log line at all. That is the
    // same failure #793 fixed for wall detection, in the same file.
    const page = read("app/(app)/jobs/[id]/(tabs)/takeoff/page.tsx");
    const route = page.match(/export const maxDuration = (\d+)/);
    expect(route, "the route no longer sets maxDuration").not.toBeNull();
    const models = readFileSync(
      resolve(process.cwd(), "../../packages/integrations/src/models.ts"),
      "utf8",
    );
    const timeoutMs = models.match(/timeout:\s*([0-9_]+)/);
    expect(timeoutMs, "the client no longer sets a timeout").not.toBeNull();
    const seconds = Number(timeoutMs![1].replace(/_/g, "")) / 1000;
    expect(Number(route![1]), `route budget must exceed the client's ${seconds}s timeout`).toBeGreaterThan(seconds);
  });

  it("NEVER LEAVES THE BUTTON SPINNING when a request dies outside the action", () => {
    // The action returns a readable refusal for everything it can see. A
    // request the PLATFORM ends never reaches it — which is what a tester
    // watched for three minutes. The throw has to be caught on the page.
    const viewer = read("components/TakeoffPlanViewer.tsx");
    const handler = viewer.slice(viewer.indexOf("const onReadSheet"), viewer.indexOf("const onCheckRuns"));
    expect(handler, "the tile call is not wrapped").toMatch(/try\s*\{[\s\S]*readScannedSheetTile[\s\S]*\}\s*catch/);
    expect(handler, "a caught failure must say something").toMatch(/catch\s*\{[\s\S]{0,400}setReadError\(/);
  });

  it("says how far it has got, so a slow run is not mistaken for a dead one", () => {
    const viewer = read("components/TakeoffPlanViewer.tsx");
    expect(viewer).toMatch(/setReadProgress\(/);
    expect(viewer).toMatch(/parts…/);
  });
});
