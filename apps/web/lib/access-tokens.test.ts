import { describe, expect, it } from "vitest";
import { isSignatureLinkDead, isPortalAccessRevoked } from "./access-tokens";

const now = new Date("2026-09-09T12:00:00Z");
const past = new Date("2026-09-01T00:00:00Z");
const future = new Date("2026-10-01T00:00:00Z");

describe("isSignatureLinkDead", () => {
  it("is alive when PENDING with no revocation or expiry", () => {
    expect(isSignatureLinkDead({ status: "PENDING", revokedAt: null, expiresAt: null }, now)).toBe(false);
  });

  it("is alive when PENDING and expiresAt is still in the future", () => {
    expect(isSignatureLinkDead({ status: "PENDING", revokedAt: null, expiresAt: future }, now)).toBe(false);
  });

  it("is dead when PENDING and revoked", () => {
    expect(isSignatureLinkDead({ status: "PENDING", revokedAt: past, expiresAt: null }, now)).toBe(true);
  });

  it("is dead when PENDING and past its expiresAt", () => {
    expect(isSignatureLinkDead({ status: "PENDING", revokedAt: null, expiresAt: past }, now)).toBe(true);
  });

  // The boundary itself: expiresAt === now is not yet expired ("<", not
  // "<="), and one millisecond past it is.
  it("treats expiresAt exactly at now as not yet expired", () => {
    expect(isSignatureLinkDead({ status: "PENDING", revokedAt: null, expiresAt: now }, now)).toBe(false);
  });
  it("treats one millisecond past expiresAt as expired", () => {
    const justPast = new Date(now.getTime() - 1);
    expect(isSignatureLinkDead({ status: "PENDING", revokedAt: null, expiresAt: justPast }, now)).toBe(true);
  });

  // The design decision this issue makes explicitly: once SIGNED, a
  // request is never "dead" by this rule, however it's flagged. A SIGNED
  // page only ever renders its own frozen snapshot, never live data, so
  // there is nothing left for revocation/expiry to protect.
  it("is never dead once SIGNED, even if revokedAt or expiresAt is set", () => {
    expect(isSignatureLinkDead({ status: "SIGNED", revokedAt: past, expiresAt: null }, now)).toBe(false);
    expect(isSignatureLinkDead({ status: "SIGNED", revokedAt: null, expiresAt: past }, now)).toBe(false);
  });
});

describe("isPortalAccessRevoked", () => {
  it("is not revoked for an active contact with no revocation", () => {
    expect(isPortalAccessRevoked({ portalRevokedAt: null, status: "ACTIVE" })).toBe(false);
  });

  it("is revoked when portalRevokedAt is set, regardless of status", () => {
    expect(isPortalAccessRevoked({ portalRevokedAt: past, status: "ACTIVE" })).toBe(true);
  });

  // Issue #106 finding 2's own complaint: an INACTIVE contact was not
  // checked at all. This is the read side of fixing that without a
  // schema change for status.
  it("is revoked when the contact is INACTIVE, even with no explicit revocation", () => {
    expect(isPortalAccessRevoked({ portalRevokedAt: null, status: "INACTIVE" })).toBe(true);
  });

  it("is revoked when both conditions hold", () => {
    expect(isPortalAccessRevoked({ portalRevokedAt: past, status: "INACTIVE" })).toBe(true);
  });
});
