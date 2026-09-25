import { describe, expect, it } from "vitest";
import { PERSONAS } from "./personas";

/**
 * THE THREE IDENTIFIERS CLERK WILL REJECT A DUPLICATE OF.
 *
 * `seedClerkUsers.ts` hands Clerk an email, a username and a phone number for
 * every persona it has to create, and Clerk refuses a second user carrying any
 * of the three. A duplicate here would arrive as a 422 in Playwright's GLOBAL
 * SETUP — before a single spec, with no test to attribute it to — which is
 * exactly the failure this suite spent two CI runs on 2026-09-25 diagnosing.
 * A table nobody checks is a table the next person adds a colliding row to, so
 * it is checked here, in a second.
 *
 * It also pins the phone numbers to Clerk's own reserved test block, +1 555 555
 * 0100-0199. That is the same decision as `+clerk_test` on the emails and it is
 * the whole reason these values are safe to commit: no number in that range can
 * reach a person's handset, so no verification code can ever be sent anywhere
 * real. A number typed outside it would look just as plausible in a diff.
 */

const personas = Object.entries(PERSONAS);

/** Reported by NAME, not as a count: "two personas share a username" is not
 * something anybody can act on. */
function duplicates(pick: (persona: (typeof personas)[number][1]) => string): string[] {
  const seen = new Map<string, string[]>();
  for (const [key, persona] of personas) {
    const value = pick(persona);
    seen.set(value, [...(seen.get(value) ?? []), key]);
  }
  return [...seen.entries()]
    .filter(([, keys]) => keys.length > 1)
    .map(([value, keys]) => `${value} is on ${keys.join(" and ")}`);
}

describe("the e2e personas table", () => {
  it("has personas at all", () => {
    // The floor first: every assertion below passes on an empty table.
    expect(personas.length).toBeGreaterThanOrEqual(6);
  });

  it("gives every persona all four fields, non-blank", () => {
    for (const [key, persona] of personas) {
      expect(persona.email.trim(), `${key} needs an email`).not.toBe("");
      expect(persona.label.trim(), `${key} needs a label`).not.toBe("");
      expect(persona.username.trim(), `${key} needs a username — Clerk requires one`).not.toBe("");
      expect(persona.phone.trim(), `${key} needs a phone — Clerk requires one`).not.toBe("");
    }
  });

  it("never reuses an email, a username or a phone number", () => {
    expect(duplicates((p) => p.email), "Clerk refuses a duplicate email").toEqual([]);
    expect(duplicates((p) => p.username), "Clerk refuses a duplicate username").toEqual([]);
    expect(duplicates((p) => p.phone), "Clerk refuses a duplicate phone number").toEqual([]);
    expect(duplicates((p) => p.label), "two personas with one label make a failure unreadable").toEqual([]);
  });

  it("suppresses email delivery on every address", () => {
    for (const [key, persona] of personas) {
      // Clerk's documented suffix for an address it will never send to.
      expect(persona.email, `${key} must carry Clerk's +clerk_test suffix`).toContain("+clerk_test@");
    }
  });

  it("uses only Clerk's reserved test phone block, so no real handset can be reached", () => {
    for (const [key, persona] of personas) {
      // +1 555 555 0100 through 0199.
      expect(persona.phone, `${key}'s phone must be E.164 in the +1 555 555 01xx test range`).toMatch(
        /^\+1555555 ?01\d\d$/,
      );
    }
  });

  it("uses usernames Clerk's default rules accept", () => {
    for (const [key, persona] of personas) {
      // Letters, digits, underscore and hyphen; at least four characters.
      expect(persona.username, `${key}'s username must be 4+ chars of [A-Za-z0-9_-]`).toMatch(
        /^[A-Za-z0-9_-]{4,64}$/,
      );
    }
  });
});
