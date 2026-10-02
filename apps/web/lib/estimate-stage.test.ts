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

  /**
   * WHAT "READY TO SEND" IS WORTH, pinned 2026-10-02 after an audit of the
   * estimating workflow found the label claims more than the function checks.
   *
   * The point is not that the function is wrong — it does exactly what its
   * signature allows, and two arguments is the whole of what it is given. The
   * point is that "ready to send" is read by a person as "somebody checked
   * this", and nothing did. A reader who needs to know what the words are worth
   * should find a test rather than have to re-derive it from two parameters.
   */
  it("READY_TO_SEND is line items plus no signature request — and NOTHING else", () => {
    // A job with one line, no cost on it, no markup applied, unacknowledged
    // addenda and quantities measured off superseded paper is "Ready to send".
    // Every one of those is invisible from here, because none of them is an
    // argument to this function.
    expect(estimateStage(1, []).key).toBe("READY_TO_SEND");
    expect(estimateStage(500, []).key).toBe("READY_TO_SEND");

    // The only two things that can move it off READY_TO_SEND.
    expect(estimateStage(0, []).key).toBe("NEEDS_PRICING");
    expect(estimateStage(1, ["PENDING"]).key).toBe("OUT_FOR_SIGNATURE");

    // The signature of the function IS the claim's limit, and asserting it is
    // what makes this test fail if somebody widens it without widening the
    // label — or narrows the label without telling the jobs list.
    expect(estimateStage.length).toBe(2);
  });
});
