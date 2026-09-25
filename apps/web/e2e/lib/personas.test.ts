import { describe, expect, it } from "vitest";
import { PERSONAS } from "./personas";

/**
 * The identity fields on a persona have to be unique across the Clerk
 * instance, and nothing at the point where you would add a seventh
 * persona says so — you copy the line above and change the words that
 * look like they matter.
 *
 * A duplicate does not fail where you made it. It fails inside
 * `createUser` on whichever persona happens to be seeded SECOND, as the
 * same opaque 422 that cost a CI round trip on 2026-09-24 before
 * `describeClerkSeedFailure` existed. This file makes it fail on a laptop
 * in a second instead.
 */
describe("every persona is distinct where Clerk requires it", () => {
  const all = Object.values(PERSONAS);

  it("has personas to check", () => {
    // Vacuity guard: an empty or near-empty record makes every
    // uniqueness assertion below trivially true.
    expect(all.length).toBeGreaterThan(3);
  });

  for (const field of ["email", "username", "phone", "label"] as const) {
    it(`gives every persona its own ${field}`, () => {
      const values = all.map((p) => p[field]);
      const duplicates = values.filter((v, i) => values.indexOf(v) !== i);
      expect(duplicates, `two personas share a ${field}: ${duplicates.join(", ")}`).toEqual([]);
      expect(values.length, "the field vanished from the personas").toBe(all.length);
    });
  }
});

describe("the identities are Clerk's documented test fixtures, so nothing is delivered", () => {
  const all = Object.values(PERSONAS);

  it("uses +clerk_test on every email, which suppresses delivery", () => {
    for (const p of all) expect(p.email, `${p.label}`).toContain("+clerk_test@");
  });

  it("uses a fictional phone from Clerk's 555-01XX test range", () => {
    // Clerk: "+1 (XXX) 555-0100" through "+1 (XXX) 555-0199" send no SMS
    // and verify with 424242. A REAL number here would text a stranger
    // every time CI runs, which is the failure worth a test of its own.
    // "+1 (XXX) 555-01XX" reads directly as one pattern: +1, any area
    // code, the 555 exchange, then 01 and two free digits. Written this
    // way after a first version sliced digit offsets by hand and got the
    // window wrong — the range is easier to assert than to index.
    for (const p of all) {
      expect(p.phone, `${p.label} is outside Clerk's +1 (XXX) 555-01XX test range`).toMatch(
        /^\+1\d{3}55501\d{2}$/,
      );
    }
  });

  it("uses usernames Clerk will accept", () => {
    // Clerk usernames are alphanumeric plus _ and -, and cannot be an
    // email-looking string. Keeping them derived from the persona key
    // means a new persona gets a legal one by construction.
    for (const p of all) {
      expect(p.username, `${p.label}`).toMatch(/^[a-z0-9_-]{4,64}$/);
      expect(p.username).not.toContain("@");
    }
  });
});
