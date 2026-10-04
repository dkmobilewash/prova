// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe as group, expect, it, vi } from "vitest";
import { MissingIndirects } from "./MissingIndirects";
import type { MissingIndirect } from "@/lib/estimating/indirect-costs";

/**
 * THE SENTENCE A PERSON ACTUALLY READS, AND THE FACT THAT THERE IS ONLY ONE.
 *
 * ── WHY THIS FILE EXISTS ──
 *
 * `indirect-costs.ts` shipped a `missingIndirectsSentence` that built
 * "This estimate carries nothing for Cleanup and Dumpsters." It had three
 * passing unit tests. Nothing called it. This component writes its own
 * sentence, which is the one on screen, and it names no kinds — so the PR's
 * own claim that the sentence named the absent kinds was false about the
 * product from the day it merged, while a green test suite described the
 * function nobody could reach.
 *
 * A test on a pure function proves the function works. It can never prove
 * anybody calls it — "nothing is ever missing from a list nobody imports."
 * So the properties that matter are asserted HERE, against rendered output,
 * where being unreachable is not survivable.
 *
 * The other half is the census at the bottom: not "is the sentence right" but
 * "is there a second one". That is the question the deleted function would
 * have failed, and the one `CostCategory` taught this repo to ask.
 */

// The action is a server action; this test is about what the component renders,
// and importing the barrel would drag Prisma into a DOM test.
vi.mock("@/lib/actions", () => ({ addIndirectCostLine: vi.fn(async () => ({ ok: true })) }));

const kind = (over: Partial<MissingIndirect> = {}): MissingIndirect =>
  ({
    kind: "CLEANUP",
    label: "Cleanup",
    covers: "Daily broom-clean and final clean",
    entry: null,
    ...over,
  }) as MissingIndirect;

let hosts: HTMLDivElement[] = [];

beforeEach(() => {
  // Set before any render: without it React warns rather than failing, and a
  // warning beside a green is how an unasserted test reads as a passing one.
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  hosts = [];
});

afterEach(() => {
  for (const host of hosts) host.remove();
});

function render(missing: MissingIndirect[]): string {
  // A FRESH CONTAINER PER RENDER. Re-using one makes React warn that
  // `createRoot` was called on it twice, and a warning printed beside a green
  // is the thing this repo keeps paying for.
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  const root = createRoot(host);
  act(() => {
    root.render(createElement(MissingIndirects, { jobId: "job-1", missing }));
  });
  // JSX wraps the sentence across source lines, so compare on collapsed
  // whitespace rather than on the spelling of the indentation.
  return (host.textContent ?? "").replace(/\s+/g, " ").trim();
}

group("what the panel says", () => {
  it("renders the sentence that is on screen, which names no kinds", () => {
    const text = render([kind(), kind({ kind: "DUMPSTERS", label: "Dumpsters" })]);
    expect(text).toContain("This estimate carries nothing for these.");
    // THE CORRECTION, PINNED. The deleted builder would have written
    // "nothing for Cleanup and Dumpsters" here. The buttons carry the names.
    expect(text).not.toContain("nothing for Cleanup");
  });

  it("names every missing kind on a button, which is where the list lives", () => {
    const text = render([kind(), kind({ kind: "DUMPSTERS", label: "Dumpsters" })]);
    expect(text).toContain("+ Cleanup");
    expect(text).toContain("+ Dumpsters");
  });

  it("NEVER SAYS THE BID IS WRONG, AND NEVER SAYS WHAT TO DO", () => {
    // Moved here from `indirect-costs.test.ts`, where it was asserted against
    // text no user could read. An estimate with no dumpster line is usually an
    // estimate that needs no dumpster. Adding the line, excluding the scope in
    // the proposal, and leaving it alone are all right answers —
    // `lien-waiver.ts`'s rule, that refusing to accept the world as it is
    // teaches people to route around you.
    const text = render([kind()]).toLowerCase();
    for (const forbidden of ["incomplete", "you must", "you should", "error"]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
    // "REQUIRED" IS ALLOWED IN EXACTLY ONE FORM AND IT IS THE OPPOSITE OF A
    // DEMAND: the sentence says these "are not required". The first version of
    // this test forbade the bare word and failed on that clause, which is the
    // assertion being blunter than the property — "required" is about tone,
    // not spelling. So the check is that every occurrence is negated.
    for (const [, prefix] of text.matchAll(/(.{0,8})required/g)) {
      expect(prefix, "every 'required' must be a 'not required'").toContain("not ");
    }
    expect(text).toContain("on purpose");
  });

  it("says what it would cost before the press, or that nobody has said", () => {
    expect(render([kind()])).toContain("no figure yet");
    const priced = render([kind({ entry: { defaultBudgetedUnitCost: 2400 } as MissingIndirect["entry"] })]);
    expect(priced).toContain("$2,400");
    expect(priced).not.toContain("no figure yet");
  });

  it("renders nothing at all when nothing is missing", () => {
    expect(render([])).toBe("");
  });
});

// The "is there a second one" census lives in `missingIndirectsCensus.test.ts`:
// it walks the source tree, which needs no DOM, and `import.meta.url` is not a
// file URL under happy-dom.
