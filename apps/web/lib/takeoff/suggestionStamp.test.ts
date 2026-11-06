import { describe, expect, it } from "vitest";
import { stampOf, suggestionsStale, SUGGESTION_RULES } from "./suggestionStamp";

const at = (iso: string) => new Date(iso);

describe("a sheet's stored suggestions are stale", () => {
  it("when the sheet was worked out before stamps existed", () => {
    expect(suggestionsStale(null, null)).toBe(true);
  });
  it("when the rules moved on since", () => {
    expect(suggestionsStale({ rules: SUGGESTION_RULES - 1, readAt: at("2026-11-06T10:00Z") }, null)).toBe(true);
    expect(suggestionsStale(stampOf({}, at("2026-11-06T10:00Z")), null)).toBe(true);
  });
  it("when the legend was saved after the run read it (Baker: takeoff first, legend after)", () => {
    expect(suggestionsStale({ rules: SUGGESTION_RULES, readAt: at("2026-11-06T10:00Z") }, at("2026-11-06T10:05Z"))).toBe(true);
  });
  it("and not when the run read the newest legend under these rules, or there is none", () => {
    expect(suggestionsStale({ rules: SUGGESTION_RULES, readAt: at("2026-11-06T10:05Z") }, at("2026-11-06T10:00Z"))).toBe(false);
    expect(suggestionsStale(stampOf({ rules: SUGGESTION_RULES }, at("2026-11-06T10:00Z")), null)).toBe(false);
  });
});
