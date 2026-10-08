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
  "TITLE_BLOCK",
  "SCHEDULE_ROWS",
  "SHEET_INDEX",
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

function paint(initial: IngestView) {
  act(() => {
    root.render(
      createElement(PlanIngestPanel, {
        planId: "plan_1",
        fileName: "set.pdf",
        existing: initial,
        scheduleSheetCount: 0,
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
