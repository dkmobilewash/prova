import { describe, expect, it } from "vitest";
import { parseWorkerValue, workerValue } from "./worker-select";

/**
 * Which TABLE a "who worked" dropdown value names.
 *
 * `TimeEntry` names a `User` or a `CrewMember` and exactly one of them — a
 * database XOR check enforces it. So an id on its own is not an answer:
 * `user_abc` and `crew_abc` are different people, and getting it wrong does
 * not throw, it files somebody else's hours under a name that then prints on
 * a government form.
 *
 * The case worth having a test for is the one in the middle: a BARE id must
 * be refused rather than guessed at as a user id. Guessing is what turns a
 * missing prefix into a silent misattribution instead of a visible refusal.
 */
describe("a worker's dropdown value", () => {
  it("round-trips a teammate and a crew member", () => {
    expect(workerValue({ kind: "user", userId: "u1" })).toBe("user:u1");
    expect(workerValue({ kind: "crew", crewMemberId: "c1" })).toBe("crew:c1");
    expect(parseWorkerValue("user:u1")).toEqual({ kind: "user", userId: "u1" });
    expect(parseWorkerValue("crew:c1")).toEqual({ kind: "crew", crewMemberId: "c1" });
  });

  it("keeps an id that contains the other prefix intact", () => {
    // cuid()s are opaque. A parse that split on the first colon anywhere,
    // or stripped a prefix by search-and-replace, would corrupt this.
    expect(parseWorkerValue("crew:user:odd")).toEqual({ kind: "crew", crewMemberId: "user:odd" });
  });

  it("refuses a bare id rather than assuming it is a user", () => {
    expect(parseWorkerValue("cm_abc123")).toBeNull();
  });

  it("refuses a prefix with nothing after it", () => {
    expect(parseWorkerValue("user:")).toBeNull();
    expect(parseWorkerValue("crew:")).toBeNull();
  });

  it("refuses nothing at all", () => {
    expect(parseWorkerValue("")).toBeNull();
    expect(parseWorkerValue("   ")).toBeNull();
    expect(parseWorkerValue(null)).toBeNull();
    expect(parseWorkerValue(undefined)).toBeNull();
  });
});
