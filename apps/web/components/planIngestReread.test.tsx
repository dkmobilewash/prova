// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PlanIngestPanel } from "./PlanIngestPanel";
import type { PlanIngestStage } from "@prova/db";
import type { IngestView } from "@/lib/plan-ingest/runner";

/**
 * "READ THE SHEETS AGAIN" MUST BE REACHABLE FROM EVERY COMPLETED STAGE, and
 * this is a RENDER test rather than a census because the defect was a GATE —
 * the code was present, correct, and on screen for nobody.
 *
 * ── THE BUG THIS EXISTS FOR, WHICH WAS THE SAME BUG TWICE ──
 *
 * The scale a sheet declares about itself is DERIVED from the file, so it goes
 * stale when the reader improves. #663 added a re-read control because there
 * was no way to re-run that stage from the app at all — the "Read the sheets"
 * button is replaced the moment the pass completes.
 *
 * It then gated the new control on `view.stage === "PAGE_INVENTORY"`. But
 * `view.stage` is the stage of the LATEST run, so reading the title blocks
 * moved it on and the re-read button vanished — invisible on every set anybody
 * had actually worked with, and present only on freshly uploaded ones that
 * nothing had improved under yet. The same disappearance, one transition later,
 * shipped inside the fix for it.
 *
 * ── WHY A CENSUS WOULD NOT HAVE CAUGHT IT ──
 *
 * Every assertion a source census can make was TRUE while the app was broken:
 * the button existed, it called `onStart`, it sat in the completed branch, it
 * named its price. A census proves the code is THERE; it cannot ask "on which
 * screens". Here the question is which props put it on the page, so the test
 * has to supply the props and look.
 *
 * The decisive mutation is the one this repo already names — make it render
 * nothing. Re-adding the stage gate reds `TITLE_BLOCK` and `SCHEDULE` below
 * while leaving `PAGE_INVENTORY` green, which is exactly the shape that shipped.
 */

/** Every stage the schema declares. Hand-listing them is how this test would
 *  quietly stop covering a new one — and the first draft invented a stage
 *  called "SCHEDULE" that does not exist, which typecheck caught. The test
 *  below reads the schema and requires this list to equal it. */
const STAGES = [
  "PAGE_INVENTORY",
  "CLASSIFY",
  "RASTER",
  "TITLE_BLOCK",
  "SCHEDULE_ROWS",
  "SHEET_INDEX",
  "WALL_LEGEND",
] as const satisfies readonly PlanIngestStage[];

const view = (over: Partial<IngestView> = {}): IngestView => ({
  jobId: "job_1",
  stage: "PAGE_INVENTORY",
  total: 29,
  finished: 29,
  exhausted: 0,
  pending: 0,
  inFlight: 0,
  percent: 100,
  complete: true,
  waiting: false,
  ...over,
});

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/**
 * A FRESH MOUNT EVERY TIME, AND THAT IS NOT TIDINESS.
 *
 * This used to render into the root created in `beforeEach`, so a second call
 * in one test re-rendered the SAME component instance. `PlanIngestPanel` holds
 * its run in `useState(existing)`, and a `useState` initialiser runs once — so
 * the second call's props were accepted and ignored, and the assertion read the
 * FIRST call's screen.
 *
 * Caught 2026-10-11 by a case that failed for this reason rather than for the
 * one it was written for. The loops above never noticed because every stage was
 * expected to produce the same answer, which is what a vacuous pass looks like
 * when it happens to be checking something true.
 */
function paint(initial: IngestView, scheduleSheetCount = 0) {
  act(() => root.unmount());
  host.remove();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root.render(
      createElement(PlanIngestPanel, {
        legend: { on: false, reviewHref: "#", typeCount: 0 },
        planId: "plan_1",
        fileName: "set.pdf",
        existing: initial,
        scheduleSheetCount,
      } as never),
    );
  });
  return host.textContent ?? "";
}

const REREAD = "Read the sheets again";

describe("re-reading a plan set", () => {
  it("is offered after the FREE pass completes", () => {
    expect(paint(view({ stage: "PAGE_INVENTORY" }))).toContain(REREAD);
  });

  it("is STILL offered once the title blocks have been read", () => {
    // The shipped bug: this was the screen the user was on, and the button was
    // not there. Augusta's panel was showing a later stage entirely.
    expect(paint(view({ stage: "TITLE_BLOCK" }))).toContain(REREAD);
  });

  it("is STILL offered at EVERY other stage, including ones added later", () => {
    // Derived from the schema rather than hand-listed: a stage added next year
    // inherits this guarantee instead of needing somebody to remember.
    for (const stage of STAGES) {
      expect(paint(view({ stage })), `stage ${stage}`).toContain(REREAD);
    }
  });

  it("is NOT offered while a pass is still running", () => {
    // Pressing it mid-run would be reusing the in-flight job, which does
    // nothing and looks like it did something.
    expect(paint(view({ complete: false, finished: 12, pending: 17, percent: 41 }))).not.toContain(REREAD);
  });

  it("covers every stage the schema declares, so none is silently skipped", () => {
    // The size assertion this family needs: if `STAGES` drifted to a subset the
    // loop above would pass while covering less, and nothing is ever missing
    // from a list you shortened. This reads the schema itself.
    // Resolved from cwd rather than `import.meta.url`, which the other censuses
    // in this repo use: this file runs under happy-dom, where `import.meta.url`
    // is an http URL and `readFileSync` rejects it ("The URL must be of scheme
    // file"). Vitest's cwd is `apps/web`.
    const schema = readFileSync(
      resolve(process.cwd(), "../../packages/db/prisma/schema/plan-ingest.prisma"),
      "utf8",
    );
    const block = schema.slice(schema.indexOf("enum PlanIngestStage {"));
    const declared = (block.slice(0, block.indexOf("\n}")).match(/^ {2}([A-Z_]+)$/gm) ?? []).map((l) => l.trim());
    expect(declared.length).toBeGreaterThan(0);
    expect([...STAGES].sort()).toEqual([...declared].sort());
  });

  it("says on the button that it costs nothing", () => {
    // It sits beside controls that spend a sheet allowance and name their
    // price. A reader who cannot tell them apart presses neither.
    expect(paint(view({ stage: "TITLE_BLOCK" }))).toContain("costs nothing");
  });

  it("rendered a panel at all, rather than passing on an empty string", () => {
    // The size assertion this family needs: every `toContain` above passes
    // vacuously against "" — nothing is ever missing from a panel that did not
    // render. `toContain` on the empty string is the trap, not `not.toContain`.
    const text = paint(view());
    expect(text.length).toBeGreaterThan(40);
    expect(text).toContain("Every sheet read");
  });
});

/**
 * "READ THE SCHEDULES" HAS THE SAME GATE BUG, ONE BUTTON HIGHER.
 *
 * The file above records #663's diagnosis — "the gate is now COMPLETION, not
 * which stage completed" — and that fix was applied to the re-read button and
 * not to the one sitting directly above it, which still read `view.stage ===
 * "TITLE_BLOCK"`. A diagnosis recorded beside the one call site somebody
 * happened to be looking at.
 *
 * Found on 2026-10-11 by pressing the re-read. A fix had just landed for three
 * sheets of a 60-sheet set that could not be read; the re-read recovered all
 * three — and because the re-read is a LATER run, it moved `view.stage` to
 * PAGE_INVENTORY and took away the schedules button the whole exercise was for.
 * The only way back through the UI was "Read the title blocks — uses 60
 * sheets", a second time, for work already paid for. A free control that
 * silently costs 60 sheets of allowance to undo.
 *
 * The real precondition was never the latest stage: it is that some sheet IS a
 * schedule, which `scheduleSheetCount` already counts and which only a
 * title-block pass can produce.
 */
const SCHEDULES = "Read the schedules";

describe("reading the schedules off a set", () => {
  it("is offered right after the title blocks are read", () => {
    expect(paint(view({ stage: "TITLE_BLOCK" }), 5)).toContain(SCHEDULES);
  });

  it("SURVIVES A FREE RE-READ — the defect, as hit on a real set", () => {
    // The re-read completes as PAGE_INVENTORY. The schedules found earlier are
    // still found; nothing about the set changed except which pass ran last.
    expect(paint(view({ stage: "PAGE_INVENTORY" }), 5)).toContain(SCHEDULES);
    expect(paint(view({ stage: "PAGE_INVENTORY" }), 5)).toContain("uses 5 sheets");
  });

  it("survives any later stage, including ones added later still", () => {
    for (const stage of STAGES) {
      expect(paint(view({ stage }), 5), `stage ${stage}`).toContain(SCHEDULES);
    }
  });

  it("says none were found ONLY after a title-block run, not before one", () => {
    // The zero case is an answer, and an answer is noise before anybody asked
    // the question. A freshly uploaded set has no page types yet.
    expect(paint(view({ stage: "TITLE_BLOCK" }), 0)).toContain("No schedule sheets found");
    expect(paint(view({ stage: "PAGE_INVENTORY" }), 0)).not.toContain("No schedule sheets found");
    expect(paint(view({ stage: "PAGE_INVENTORY" }), 0)).not.toContain(SCHEDULES);
  });

  it("is NOT offered while a pass is still running", () => {
    // ── WHAT THIS COVERS, AND THE HALF IT CANNOT ──
    //
    // The gate is `view.complete && !running && …`. This reaches the first
    // clause only. `running` is component state that `onStart`/`onResume` set,
    // so a fresh mount always has it false and no prop can change that —
    // mutation-tested: deleting `!running` from the gate leaves this file GREEN.
    //
    // Recorded rather than left for somebody to assume: the `!running` clause
    // guards the window where the view still reads complete while a new run is
    // in flight, and nothing here can see it. Covering it needs the server
    // action mocked, which this file deliberately does not do.
    expect(
      paint(view({ stage: "TITLE_BLOCK", complete: false, finished: 12, pending: 17, percent: 41 }), 5),
    ).not.toContain(SCHEDULES);
  });

  it("NAMES ITS PRICE, because the button beside it is free and this one is not", () => {
    // The reason the re-read says "costs nothing" on itself. A reader who
    // cannot tell them apart presses neither.
    expect(paint(view({ stage: "PAGE_INVENTORY" }), 1)).toContain("uses 1 sheet");
    expect(paint(view({ stage: "PAGE_INVENTORY" }), 1)).not.toContain("uses 1 sheets");
  });
});
