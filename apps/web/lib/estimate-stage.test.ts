import { describe, expect, it } from "vitest";
import { estimateStage } from "./estimate-stage";

describe("estimateStage", () => {
  it("an unpriced job needs pricing, whatever else is true of it", () => {
    expect(estimateStage(0, []).key).toBe("NEEDS_PRICING");
    // Pricing comes first even if a signature request somehow exists: there is
    // nothing to sign for, so "waiting on the client" would be a lie.
    expect(estimateStage(0, ["PENDING"]).key).toBe("NEEDS_PRICING");
    expect(estimateStage(0, ["SIGNED"]).key).toBe("NEEDS_PRICING");
  });

  it("priced with no signature request is ready to send", () => {
    expect(estimateStage(3, []).key).toBe("READY_TO_SEND");
  });

  it("a pending request is waiting on the client", () => {
    expect(estimateStage(3, ["PENDING"]).key).toBe("OUT_FOR_SIGNATURE");
  });

  it("signed is signed", () => {
    expect(estimateStage(3, ["SIGNED"]).key).toBe("SIGNED");
  });

  it("a signed request wins over an older pending one", () => {
    // A second request generated before the first was signed leaves both on
    // the job. Reporting this as still waiting would send the user to chase a
    // client who has already signed.
    expect(estimateStage(3, ["PENDING", "SIGNED"]).key).toBe("SIGNED");
    expect(estimateStage(3, ["SIGNED", "PENDING"]).key).toBe("SIGNED");
  });

  it("ignores statuses it doesn't know about rather than guessing", () => {
    expect(estimateStage(3, ["EXPIRED"]).key).toBe("READY_TO_SEND");
    expect(estimateStage(3, ["EXPIRED", "PENDING"]).key).toBe("OUT_FOR_SIGNATURE");
  });

  it("always gives the user something to do next", () => {
    for (const statuses of [[], ["PENDING"], ["SIGNED"], ["EXPIRED"]]) {
      for (const count of [0, 1, 5]) {
        const stage = estimateStage(count, statuses);
        expect(stage.label.length).toBeGreaterThan(0);
        expect(stage.detail.length).toBeGreaterThan(0);
      }
    }
  });
});
