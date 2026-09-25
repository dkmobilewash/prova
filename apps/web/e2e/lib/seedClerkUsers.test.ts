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

    // ASSERTED IN THE LABELLED FORM, not as bare substrings, and that is the
    // whole difference between this test and the vacuous one it replaces.
    // `toContain("form_identifier_not_allowed_access")` passed with the
    // ENTIRE labelled line replaced by "(an error)", because the raw dump at
    // the bottom carries every one of these strings — exactly the trap the
    // meta case below already records, left standing on the assertion this
    // PR leads with. Mutations: dropping `[${code}]` from the labelled line,
    // and dropping `longMessage` from it, were both GREEN before this.
    expect(text).toContain("  - [form_identifier_not_allowed_access] Access denied");
    expect(text).toContain("\n    You are not allowed to access this application.");

    // These two are not in the raw dump at all — `status` and `clerkTraceId`
    // live on the error, not in `errors[]` — so they were never vacuous.
    expect(text).toContain("HTTP 422");
    expect(text).toContain("trace_abc123");
  });

  it("reports an error item that has no code at all, instead of dropping it", () => {
    // The formatter used to KEEP only items with a string `code`, so an item
    // without one vanished from the readable section AND from the raw dump,
    // and the message degraded to "(no structured detail)" with "Raw: []".
    // Clerk does send `code` today; nothing here should depend on that.
    const text = describeClerkSeedFailure(
      { status: 422, errors: [{ message: "a refusal with no code field" }] },
      persona,
    );
    expect(text).toContain("[no code] a refusal with no code field");
    expect(text).not.toContain("no structured detail");
  });

  it("does not print an empty meta line for the shape Clerk actually sends", () => {
    // A real `@clerk/shared` ClerkAPIError builds `meta` as a seven-key
    // object of undefineds when Clerk sent no metadata, so a key count is
    // always truthy and every error printed "meta: {}". Read out of
    // `@clerk/shared@3.47.8` dist/runtime/error-*.mjs, `ClerkAPIError`'s
    // constructor, which sets all seven unconditionally.
    const text = describeClerkSeedFailure(
      {
        status: 422,
        errors: [
          {
            code: "form_data_missing",
            message: "missing data",
            meta: {
              paramName: undefined,
              sessionId: undefined,
              emailAddresses: undefined,
              identifiers: undefined,
              zxcvbn: undefined,
              plan: undefined,
              isPlanUpgradePossible: undefined,
            },
          },
        ],
      },
      persona,
    );
    expect(text).not.toContain("meta: {}");
    expect(text).toContain("[form_data_missing] missing data");
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
    // Matched per word rather than as a phrase: the message is hard-wrapped
    // for a CI log, so asserting an exact phrase makes the test fail on a
    // line break rather than on a missing idea.
    expect(text).toMatch(/subaddresses/);
    expect(text).toMatch(/allowlist/);
  });

  it("names both families of 422, because the first version named one", () => {
    // The first run of this function in CI returned [form_data_missing],
    // a MISSING FIELD — and the message told the reader to go look at
    // Restrictions, which is the other family entirely. A pointer that is
    // confidently wrong is worse than no pointer; it spends somebody's
    // afternoon in the wrong dashboard page.
    const text = describeClerkSeedFailure(clerkRefusal, persona);
    expect(text).toMatch(/required field/i);
    expect(text).toMatch(/refusing the address/i);
  });

  it("prints meta in the readable section, not only inside the raw dump", () => {
    // The first version of this test asserted `toContain("username")` and
    // was VACUOUS: the raw dump at the bottom carries the same string, so
    // deleting the structured meta line entirely still passed. Caught by
    // mutation M4, which went green when it should have gone red.
    //
    // A reader scans the labelled section; the raw dump is a single long
    // JSON line they resort to. Both must carry it, and only the labelled
    // form proves the labelled section does.
    const withMeta = {
      ...clerkRefusal,
      errors: [{ code: "form_data_missing", message: "missing data", meta: { paramName: "username" } }],
    };
    const text = describeClerkSeedFailure(withMeta, persona);
    expect(text).toContain('meta: {"paramName":"username"}');
  });

  it("dumps everything Clerk sent, so an unanticipated field cannot be lost", () => {
    // The reason this exists: the first version chose which fields to
    // print, and the field it did not choose was the one that named the
    // cause. A formatter must not be able to hide its own input.
    const exotic = {
      ...clerkRefusal,
      errors: [{ code: "form_data_missing", message: "missing data", somethingNew: "the field nobody expected" }],
    };
    const text = describeClerkSeedFailure(exotic, persona);
    expect(text).toContain("the field nobody expected");
  });

  it("does not throw on a circular error object", () => {
    // The diagnostic replacing the failure it is reporting would be the
    // worst possible outcome here.
    const circular: Record<string, unknown> = { status: 422, errors: [{ code: "x", message: "y" }] };
    circular.self = circular;
    (circular.errors as Record<string, unknown>[])[0].back = circular;
    expect(() => describeClerkSeedFailure(circular, persona)).not.toThrow();
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
