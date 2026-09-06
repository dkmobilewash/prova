import { describe, expect, it } from "vitest";
import { attempt, refuse, refusalMessage } from "./shared";

/**
 * The mechanism carrying every change-order refusal back to a person.
 *
 * All twelve guards in `changeOrders.ts` used to `throw`, and Next.js
 * redacts a thrown Server Action message in production — so sentences like
 * "CO #3 has already been sent — void it and raise a new one" reached a
 * real user as a reference number. They now throw a TAGGED error that
 * `attempt` unwraps into `{ ok: false, error }`.
 *
 * This is tested rather than assumed for the reason the tag exists at all.
 * The obvious implementation is `instanceof`, and `isUniqueConstraintError`
 * in the same file documents `instanceof` evaluating FALSE at runtime in
 * this app despite the constructor name matching. A recogniser that
 * silently never matches turns every refusal back into a digest while
 * every test stays green, which is precisely the failure this suite exists
 * to make impossible.
 */

describe("refuse / attempt", () => {
  it("turns a refusal into a result carrying the sentence", async () => {
    const result = await attempt(async () => {
      refuse("CO #3 has already been sent — void it and raise a new one.");
    });

    expect(result).toEqual({
      ok: false,
      error: "CO #3 has already been sent — void it and raise a new one.",
    });
  });

  it("returns ok when the body completes", async () => {
    expect(await attempt(async () => {})).toEqual({ ok: true });
  });

  it("RE-THROWS anything that is not a refusal", async () => {
    // A genuine bug must stay a bug: redacted in production and shown by
    // the error boundary. Swallowing it into `{ ok: false }` would dress a
    // crash up as a polite refusal and hide it from everybody.
    const bug = new TypeError("cannot read properties of undefined");
    await expect(attempt(async () => { throw bug; })).rejects.toThrow(bug);
  });

  it("does not mistake an ordinary Error for a refusal", async () => {
    // The half of the contract a passing suite could otherwise hide: if the
    // recogniser matched everything, every crash would read as a refusal.
    await expect(
      attempt(async () => { throw new Error("Change order not found"); }),
    ).rejects.toThrow("Change order not found");
  });

  it("recognises a refusal by its TAG, not by its class", async () => {
    // The property is what is checked, so this survives the bundling that
    // breaks instanceof.
    let thrown: unknown;
    try {
      refuse("A change order can't be answered before it was sent.");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(refusalMessage(thrown)).toBe("A change order can't be answered before it was sent.");

    // And the negatives, including the shapes that would crash a naive
    // property read.
    expect(refusalMessage(new Error("plain"))).toBeNull();
    expect(refusalMessage(null)).toBeNull();
    expect(refusalMessage(undefined)).toBeNull();
    expect(refusalMessage("a string")).toBeNull();
  });

  it("keeps the refusal a real Error, so a transaction still rolls back", async () => {
    // The reason a refusal throws at all instead of returning: inside
    // prisma.$transaction, returning would let the writes already made
    // COMMIT. It has to be a thrown Error for the transaction to unwind.
    let thrown: unknown;
    try {
      refuse("nope");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
  });
});
