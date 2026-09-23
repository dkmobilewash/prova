import { describe, expect, it } from "vitest";
import { isAlreadySignedIn, signInMessage } from "./clerk-error";

/**
 * The sign-in screen is the one screen where an unreadable error costs
 * the whole app: a person who cannot get in cannot report the problem
 * from inside it either. So every branch is pinned, including the two
 * that decide what a person DOES next — fix the typing, or ring the
 * office.
 */

const clerk = (code: string, message = "Clerk's own words", longMessage?: string) => ({
  errors: [{ code, message, longMessage }],
});

describe("what a failed sign-in says", () => {
  it("sends an unknown email to the office rather than blaming the password", () => {
    expect(signInMessage(clerk("form_identifier_not_found"))).toContain("Ask the office");
  });

  it("names the password when the password is what is wrong", () => {
    expect(signInMessage(clerk("form_password_incorrect"))).toContain("doesn't match");
  });

  it("says a lost connection is a connection problem, not a wrong password", () => {
    // The jobsite case, and the only one where waiting is the right move.
    expect(signInMessage(new TypeError("Network request failed"))).toContain("No connection");
    expect(signInMessage(new Error("Failed to fetch"))).toContain("No connection");
  });

  it("passes Clerk's own sentence through for password rules", () => {
    // Minimum length lives in the dashboard. Restating it here is how a
    // message goes stale the day somebody changes the setting.
    const message = signInMessage(
      clerk("form_password_length_too_short", "short", "Passwords must be 8 characters or more."),
    );
    expect(message).toBe("Passwords must be 8 characters or more.");
  });

  it("prefers the long message over the short one, since the long one explains", () => {
    expect(signInMessage(clerk("form_password_pwned", "pwned", "This password has been found in a breach."))).toBe(
      "This password has been found in a breach.",
    );
  });

  it("explains a bad or stale code during a password reset", () => {
    expect(signInMessage(clerk("form_code_incorrect"))).toContain("type it again");
    expect(signInMessage(clerk("verification_expired"))).toContain("expired");
  });

  it("answers with a sentence for anything it has never seen", () => {
    // Never "[object Object]", never empty — both of which are what a raw
    // throw renders as in a <Text>.
    for (const odd of [undefined, null, {}, "", 42, { errors: [] }, new Error("")]) {
      const message = signInMessage(odd);
      expect(message.length).toBeGreaterThan(10);
      expect(message).not.toContain("object Object");
    }
  });
});

describe("the already-signed-in race", () => {
  it("recognises the session that already exists", () => {
    expect(isAlreadySignedIn(clerk("session_exists"))).toBe(true);
  });

  it("does not mistake an ordinary failure for it", () => {
    expect(isAlreadySignedIn(clerk("form_password_incorrect"))).toBe(false);
    expect(isAlreadySignedIn(new Error("boom"))).toBe(false);
  });
});
