import { describe, expect, it } from "vitest";
import { describeClerkSeedFailure } from "./seedClerkUsers";
import { PERSONAS } from "./personas";

/**
 * WHEN THE SEED FAILS, THE LOG HAS TO SAY WHY — AND FOR ONE CI RUN IT
 * DID NOT.
 *
 * 2026-09-24, the first `e2e` run after the two Clerk secrets were added:
 * the job got through install, Prisma, a real `next build` and a booted
 * server, then died in global setup with the entire explanation being
 *
 *     ClerkAPIResponseError: Unprocessable Entity
 *        at ../lib/seedClerkUsers.ts:46
 *
 * That is the HTTP reason phrase. Clerk had ALREADY sent the reason — a
 * `code`, a `message` and a human-written `longMessage` per error, on the
 * thrown object — and `toString()` dropped every word of it. A 422 here
 * is always an instance RULE refusing an address, and which rule it is
 * decides whether the fix is a dashboard toggle or a change to
 * `personas.ts`. Without the code you cannot tell those apart, so the
 * next step is a guess.
 *
 * This is the same family as `verdicts.mjs` in this directory: a failure
 * that cannot say what it was is only marginally better than no failure
 * at all, because the next person still has to run the experiment.
 */

/** A real `ClerkAPIResponseError` is not constructible here — the class
 * lives in `@clerk/shared`, which is not a direct dependency. The fixture
 * is the JSON SHAPE the SDK builds that object from, which is what the
 * function is written to read; see the `instanceof` note in the source. */
const clerkRefusal = {
  status: 422,
  clerkTraceId: "trace_abc123",
  message: "Unprocessable Entity",
  errors: [
    {
      code: "form_identifier_not_allowed_access",
      message: "Access denied",
      longMessage: "You are not allowed to access this application.",
    },
  ],
};

describe("describeClerkSeedFailure", () => {
  const persona = PERSONAS.empty;

  it("prints the code and longMessage that toString() throws away", () => {
    const text = describeClerkSeedFailure(clerkRefusal, persona);

    // The two facts that decide what you do next, neither of which was
    // in the log that made this function necessary.
    expect(text).toContain("form_identifier_not_allowed_access");
    expect(text).toContain("You are not allowed to access this application.");
    expect(text).toContain("HTTP 422");
    expect(text).toContain("trace_abc123");
  });

  it("names which persona could not be created", () => {
    const text = describeClerkSeedFailure(clerkRefusal, persona);
    expect(text).toContain(persona.email);
    expect(text).toContain(persona.label);
  });

  it("points at the instance setting rather than at the suite", () => {
    // The wrong first move here is reading app code. Six users are being
    // MINTED against an instance; a 422 is that instance's policy.
    const text = describeClerkSeedFailure(clerkRefusal, persona);
    expect(text).toMatch(/Restrictions/);
    expect(text).toMatch(/Block email subaddresses/);
  });

  it("reads a duck-typed error, not an instanceof", () => {
    // The mutation this guards: swapping the shape check for
    // `error instanceof ClerkAPIResponseError` passes in a unit test and
    // FAILS in CI, because @clerk/backend re-exports the class from a
    // package this one does not depend on and the identity check can be
    // made against a different copy. A plain object must work.
    const text = describeClerkSeedFailure({ ...clerkRefusal }, persona);
    expect(text).toContain("form_identifier_not_allowed_access");
  });

  it("is never LESS informative than the bare error it replaces", () => {
    // A non-Clerk failure — DNS, a proxy, a thrown string — must still
    // surface its own text. The floor is "what you would have seen
    // anyway", never a formatted message that hides the real one.
    const text = describeClerkSeedFailure(new Error("getaddrinfo ENOTFOUND"), persona);
    expect(text).toContain("getaddrinfo ENOTFOUND");

    const thrownString = describeClerkSeedFailure("something odd", persona);
    expect(thrownString).toContain("something odd");
  });

  it("keeps the blank lines that make it readable in a CI log", () => {
    // It is read in a wall of scrolling text; the paragraph breaks are
    // the only thing separating Clerk's words from ours. An earlier draft
    // filtered every falsy line to drop an absent trace id and flattened
    // the whole message to one block.
    const text = describeClerkSeedFailure(clerkRefusal, persona);
    expect(text).toContain("\n\n");
  });

  it("omits the trace id line when there is no trace id", () => {
    const { clerkTraceId: _omitted, ...withoutTrace } = clerkRefusal;
    const text = describeClerkSeedFailure(withoutTrace, persona);
    expect(text).not.toContain("clerkTraceId");
    expect(text).toContain("form_identifier_not_allowed_access");
  });

  it("never prints anything that looks like a key", () => {
    const text = describeClerkSeedFailure(
      { ...clerkRefusal, secretKey: "sk_test_do_not_print_me" },
      persona,
    );
    expect(text).not.toMatch(/sk_(test|live)_/);
  });
});

describe("the personas this is reporting about", () => {
  it("all carry Clerk's test suffix, which is why a subaddress rule can refuse them", () => {
    // Vacuity guard for the hint above: if these addresses ever stop
    // being subaddresses, the message would be pointing at a setting that
    // could not possibly be the cause.
    const emails = Object.values(PERSONAS).map((p) => p.email);
    expect(emails.length).toBeGreaterThan(3);
    for (const email of emails) expect(email).toContain("+clerk_test@");
  });
});
