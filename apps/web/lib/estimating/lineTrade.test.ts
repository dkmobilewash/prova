import { describe, expect, it } from "vitest";
import { newLineTrade } from "./lineTrade";

describe("newLineTrade", () => {
  it("uses the project's own trade first", () => {
    expect(newLineTrade({ tradeScope: "EIFS", invitations: [{ tradeScope: "LATH_PLASTER" }] })).toBe("EIFS");
  });

  it("falls back to the one trade every invitation shares — the walk's case", () => {
    const project = { tradeScope: null, invitations: [{ tradeScope: "METAL_FRAMING_DRYWALL" }, { tradeScope: "METAL_FRAMING_DRYWALL" }] };
    expect(newLineTrade(project)).toBe("METAL_FRAMING_DRYWALL");
  });

  it("starts untagged when the invitations disagree, have none, or there is no project", () => {
    expect(newLineTrade({ tradeScope: null, invitations: [{ tradeScope: "EIFS" }, { tradeScope: "FIREPROOFING" }] })).toBe("");
    expect(newLineTrade({ tradeScope: null, invitations: [{ tradeScope: null }] })).toBe("");
    expect(newLineTrade({ tradeScope: null, invitations: [] })).toBe("");
    expect(newLineTrade(null)).toBe("");
  });
});
