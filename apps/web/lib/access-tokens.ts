/**
 * Pure predicates behind issue #106 finding 2 — whether a public,
 * unauthenticated-access token (the client portal link, an esign link)
 * still works. Pulled out of `signRequest` and the /esign and /portal
 * pages so the same rule is checked in one place rather than three, and
 * so the rule itself is testable without a request, a browser, or a
 * database.
 *
 * BOTH treat "revoked" and "expired" the same way a caller should treat
 * them: as dead, full stop. Neither function says WHICH reason applies —
 * every call site turns this into an identical 404 (pages) or an
 * identical "not found" error (signRequest), on purpose. Distinguishing
 * "revoked" from "expired" from "never existed" would tell whoever is
 * holding a dead link something about its history that they have no
 * business learning, the same reasoning the portal's existing
 * "wrong jobId 404s" convention already rests on.
 */

/** A signature request is only ever checked for deadness while PENDING —
 * once SIGNED it renders nothing but its own frozen snapshot, so revoking
 * or expiring it after the fact would hide a legitimate evidence record
 * for no security benefit. Callers pass the row's own `status`; a SIGNED
 * (or any non-PENDING) row is never dead by this definition. */
export function isSignatureLinkDead(
  request: { status: string; revokedAt: Date | null; expiresAt: Date | null },
  now: Date,
): boolean {
  if (request.status !== "PENDING") return false;
  if (request.revokedAt != null) return true;
  if (request.expiresAt != null && request.expiresAt < now) return true;
  return false;
}

/** A portal contact is dead access when explicitly revoked, or when the
 * sub has marked the relationship INACTIVE — the latter is #106's own
 * complaint that "the job closes and the contact is set INACTIVE, which
 * neither page reads." Both conditions are checked because they are two
 * different decisions (see Contact.portalRevokedAt's schema comment) and
 * either one alone should be enough to kill the link. */
export function isPortalAccessRevoked(contact: { portalRevokedAt: Date | null; status: string }): boolean {
  return contact.portalRevokedAt != null || contact.status === "INACTIVE";
}

/**
 * Issue #106 finding 1. The one ChangeOrderStatus a GC should ever see on
 * the portal — see ChangeOrderStatus's own comment in jobs.prisma for why
 * only APPROVED has touched JobLineItem, which is the same reason it's the
 * only one safe to show outside the company. A named export rather than a
 * literal "APPROVED" typed inline at the query site so the portal page and
 * its dbtest (`gc-surface-tokens.dbtest.ts`) read the same value instead of
 * two copies that could quietly drift apart.
 */
export const CLIENT_VISIBLE_CHANGE_ORDER_STATUS = "APPROVED" as const;
