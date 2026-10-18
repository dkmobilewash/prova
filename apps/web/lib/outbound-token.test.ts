import { describe, expect, it } from "vitest";
import { leadIdFromToken, unsubscribeTokenFor } from "./outbound-token";

const SECRET = "test-secret";

describe("unsubscribe token", () => {
  it("round-trips a lead id", () => {
    const token = unsubscribeTokenFor("clead123", SECRET);
    expect(token).toMatch(/^clead123\.[0-9a-f]{24}$/);
    expect(leadIdFromToken(token, SECRET)).toBe("clead123");
  });

  it("refuses a tampered tag, a swapped lead id, and a different secret", () => {
    const token = unsubscribeTokenFor("clead123", SECRET);
    const last = token.at(-1) === "0" ? "1" : "0";
    expect(leadIdFromToken(token.slice(0, -1) + last, SECRET)).toBeNull();
    expect(leadIdFromToken(token.replace("clead123", "clead124"), SECRET)).toBeNull();
    expect(leadIdFromToken(token, "another-secret")).toBeNull();
  });

  it("refuses garbage and refuses everything without a secret", () => {
    for (const bad of ["", ".", "nodot", ".abc", "clead123.", "clead123.zz"]) {
      expect(leadIdFromToken(bad, SECRET)).toBeNull();
    }
    expect(leadIdFromToken(unsubscribeTokenFor("x", SECRET), "")).toBeNull();
    expect(() => unsubscribeTokenFor("x", "")).toThrow();
  });
});
