// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { clearSheetDrafts, loadDraft } from "./draftStore";

// Hutto A102 (Chrome, 2026-11-07): drafts of one sheet under several builds; Discard
// cleared only the current build's, and the one it had offered came back.
const SET = "4.13.26 - Plans - EH Hutto TX - IFP Set (1).pdf";
const put = (page: number, version: string, decided: number) =>
  localStorage.setItem(
    `takeoff-review-draft:${SET}:${page}:${version}`,
    JSON.stringify({ format: 1, set: SET, page, finderVersion: version, fingerprint: "450:x", savedAt: "2026-11-07T00:00:00Z", verdicts: {}, traced: [], counts: { decided, traced: 0 } }),
  );
const keys = () => Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i) ?? "").filter((k) => k.startsWith("takeoff-review-draft:")).sort();

describe("clearSheetDrafts", () => {
  beforeEach(() => localStorage.clear());

  it("REMOVES THE SHEET'S DRAFTS UNDER EVERY BUILD, and no other sheet's", () => {
    put(62, "ae1fb6c5", 86);
    put(62, "c1dfa7e6", 120);
    put(61, "ae1fb6c5", 40);
    expect(clearSheetDrafts(SET, 62)).toBe(2);
    expect(keys()).toEqual([`takeoff-review-draft:${SET}:61:ae1fb6c5`]);
  });

  it("with a test, only the drafts it picks: the pre-marks-only one goes, real work stays", () => {
    put(62, "ae1fb6c5", 86);
    put(62, "c1dfa7e6", 120);
    expect(clearSheetDrafts(SET, 62, (d) => d !== null && d.counts.decided <= 86)).toBe(1);
    expect(keys()).toEqual([`takeoff-review-draft:${SET}:62:c1dfa7e6`]);
    expect(loadDraft(SET, 62, "ae1fb6c5")).toBeNull();
  });
});
