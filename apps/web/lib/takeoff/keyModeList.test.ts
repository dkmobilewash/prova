import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { afterKeyModeOff } from "./keyModeList";
import { offeredCandidates } from "./offeredCandidates";
import type { WallCandidate } from "./wallVectors";

const run = (x1: number, y1: number, x2: number, y2: number): WallCandidate => ({ x1, y1, x2, y2, thicknessFeet: 0.5, lengthFeet: Math.hypot(x2 - x1, y2 - y1) * 100 }) as WallCandidate;

describe("turning answer-key mode off", () => {
  // A wall on the plan, and one in the title-block strip outside the measured plan box: the finder
  // returns both; the customer offer keeps only the first (`planBoxes`).
  const onPlan = run(0.1, 0.2, 0.4, 0.2);
  const inTitleBlock = run(0.95, 0.1, 0.95, 0.5);
  const found = [onPlan, inTitleBlock];
  const offer = offeredCandidates({ walls: found, segments: [], widthPt: 1000, feetPerUnit: 100, planBoxes: [{ from: 0, to: 0.8, fromY: 0, toY: 0.6 }] });

  it("puts the customer offer on the panel, never the finder's raw list key mode kept", () => {
    expect(offer.offeredRuns).toEqual([onPlan]);
    const next = afterKeyModeOff({ builtInKeyMode: true, pageNumber: 5, customer: { page: 5, runs: offer.offeredRuns }, paired: false });
    expect(next).toEqual({ kind: "offer", runs: [onPlan] });
    expect(next.kind === "offer" && next.runs).not.toContain(inTitleBlock);
  });

  it("clears it when the kept offer is for another sheet, missing, or the sheet is paired with its demolition plan", () => {
    expect(afterKeyModeOff({ builtInKeyMode: true, pageNumber: 6, customer: { page: 5, runs: [onPlan] }, paired: false })).toEqual({ kind: "clear" });
    expect(afterKeyModeOff({ builtInKeyMode: true, pageNumber: 5, customer: null, paired: false })).toEqual({ kind: "clear" });
    expect(afterKeyModeOff({ builtInKeyMode: true, pageNumber: 5, customer: { page: 5, runs: [onPlan] }, paired: true })).toEqual({ kind: "clear" });
  });

  it("leaves a list a customer find built alone", () => {
    expect(afterKeyModeOff({ builtInKeyMode: false, pageNumber: 5, customer: null, paired: false })).toEqual({ kind: "keep" });
  });

  it("the viewer keeps the customer offer on every find, marks a key-mode list, and applies this when the mode turns off", () => {
    const src = readFileSync(new URL("../../components/TakeoffPlanViewer.tsx", import.meta.url), "utf8");
    expect(src).toContain("customerOfferRef.current = { page: pageNumber, runs: (offered ?? offerHere()).offeredRuns };");
    expect(src).toContain("foundInKeyMode.current = answerKey !== undefined;");
    expect(src).toContain("const next = afterKeyModeOff({ builtInKeyMode: foundInKeyMode.current,");
    expect(src).toMatch(/\}, \[keyOn, pageNumber\]\);/);
  });
});

describe("key mode draws the customer offer by default (Diego, 2026-11-20); the raw list is an explicit ask", () => {
  // Textual wiring checks, the `keyModeList` precedent: they prove the seam is present and spelled
  // the way the behavior needs, not that a browser rendered it — the panel's click-through is the
  // round's job. The seam itself is one ternary, so there is no separate pure function to test.
  const viewer = readFileSync(new URL("../../components/TakeoffPlanViewer.tsx", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../../components/AnswerKeyPanel.tsx", import.meta.url), "utf8");
  const workspace = readFileSync(new URL("../../components/TakeoffWorkspace.tsx", import.meta.url), "utf8");

  it("a key-mode find draws the offer unless the reviewer asked for the raw list", () => {
    expect(viewer).toContain("const rawKeyList = answerKey !== undefined && answerKey.showSetAside === true;");
    expect(viewer).toContain("let offered = rawKeyList ? null : offerHere();");
  });

  it("grading never reads the display list: the rail's candidates come from the RAW cache either way", () => {
    // The cache stores the finder's raw walls, and the rail builds its own offer from them.
    expect(viewer).toContain("walls: [...found.walls],");
    expect(viewer).toContain("walls: last.walls,");
  });

  it("the panel has the toggle and the workspace plumbs it per page", () => {
    expect(panel).toContain('data-takeoff="key-show-set-aside"');
    expect(panel).toContain('"Back to the customer list" : "Show the set-aside lines"');
    expect(workspace).toContain("showSetAside: onThisSheet(showSetAsideByPage, page) ?? false,");
    expect(workspace).toContain("showSetAside={onThisSheet(showSetAsideByPage, page) ?? false}");
  });
});
