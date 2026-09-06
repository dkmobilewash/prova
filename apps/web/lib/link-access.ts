/**
 * Whether a bearer link is still allowed to open — for the two pages in
 * this app that have no login at all.
 *
 * `/portal/<token>` and `/esign/<token>` are reached by a `findUnique` on a
 * token and nothing else. The token IS the credential (see lib/tokens.ts),
 * and both pages are handed to a GC by email, which means they leak by
 * ordinary use: forwarded to a PM who has since left, pasted into a thread
 * that outlives the job, sitting in a mailbox nobody closed.
 *
 * Until this file existed, holding one of those URLs was PERMANENT. There
 * was one writer for each token and no reader anywhere asked whether it was
 * still valid:
 *
 *   - `enablePortalAccess` set `Contact.portalToken` and nothing ever
 *     cleared it. Setting the contact INACTIVE — the app's own way of
 *     saying "we are no longer working with these people" — did nothing at
 *     all to the link, which kept returning every job, every price, every
 *     change order and every invoice balance.
 *   - `createSignatureRequest` issued a PENDING row and nothing ever
 *     withdrew it. That page renders LIVE line items, so a link issued
 *     against one set of prices renders — and legally signs — whatever the
 *     prices are on the day it is finally opened.
 *
 * WHY THE ANSWER IS DERIVED AND NOT STORED. Every gate below reads state
 * that already exists: `Contact.status`, the presence of the token,
 * `Job.status`, `SignatureRequest.status`, `SignatureRequest.createdAt`.
 * CLAUDE.md's rule is that derived state is never stored, and a
 * `linkRevoked` boolean is the textbook way to end up with a contact marked
 * INACTIVE whose flag still says the link is live. Revocation is expressed
 * by removing the credential (`portalToken = null`) or the row, which
 * cannot disagree with itself.
 *
 * Pure: no database, no session, no React. Pinned in lib/link-access.test.ts.
 */

/** Why a portal link will not open. `OK` is the only state that renders. */
export type PortalAccess =
  | { ok: true }
  /** The contact is no longer someone we work with. Their link dies with
   * that status change rather than needing a second, separate action that
   * whoever set INACTIVE would have to remember. */
  | { ok: false; reason: "CONTACT_INACTIVE" };

export function portalAccessFor(contact: { status: string }): PortalAccess {
  if (contact.status === "INACTIVE") {
    return { ok: false, reason: "CONTACT_INACTIVE" };
  }
  return { ok: true };
}

/**
 * How long an UNSIGNED signing link stays signable.
 *
 * The e-sign page renders live line items, so an old link is not a stale
 * copy of an old contract — it is a live, signable copy of the CURRENT one.
 * A sub who re-prices an estimate in week six has no idea that the link
 * they emailed in week one still binds them to whatever the numbers say
 * today.
 *
 * Thirty days is a deliberate, boring choice: longer than any normal
 * turnaround on a signature, short enough that a forgotten link stops
 * being a live instrument within a billing cycle. It is not a security
 * boundary on its own — revocation is — it is the backstop for the links
 * nobody remembers to revoke, which is most of them.
 *
 * Expiry never touches a SIGNED request. A signed contract is evidence and
 * its page must render forever; only the ability to CREATE a signature
 * expires.
 */
export const SIGNING_LINK_MAX_AGE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export type SigningLinkState =
  /** Render the contract and the signing form. */
  | { state: "SIGNABLE" }
  /** Already signed — render the frozen snapshot, forever. */
  | { state: "SIGNED" }
  /** Older than SIGNING_LINK_MAX_AGE_DAYS and never signed. */
  | { state: "EXPIRED" }
  /** The job left ESTIMATE by another route (the GC sent an executed
   * subcontract, or somebody marked it contracted). A second signature
   * against a job that is already under contract is not a thing that should
   * be possible from a link somebody forgot about. */
  | { state: "JOB_NOT_ESTIMATE" };

export function signingLinkState(
  request: { status: string; createdAt: Date },
  job: { status: string },
  now: Date,
): SigningLinkState {
  if (request.status === "SIGNED") {
    return { state: "SIGNED" };
  }
  if (job.status !== "ESTIMATE") {
    return { state: "JOB_NOT_ESTIMATE" };
  }
  if (now.getTime() - request.createdAt.getTime() > SIGNING_LINK_MAX_AGE_DAYS * DAY_MS) {
    return { state: "EXPIRED" };
  }
  return { state: "SIGNABLE" };
}

/**
 * What the GC is told when a link will not open.
 *
 * Written for the person holding the link, who has done nothing wrong and
 * has no account to check anything against. Every one of these names the
 * remedy — ask for a new link — because a dead end on the only page a GC
 * ever sees is precisely the moment the sub looks incompetent.
 *
 * Deliberately NOT a 404. A 404 on a link somebody was told to use reads as
 * "you were sent a broken link"; these say "this link is no longer live,
 * here is what to do". The 404 is reserved for a token that never existed,
 * where saying anything more would confirm to a guesser which tokens are
 * real.
 */
export const SIGNING_LINK_MESSAGES: Record<"EXPIRED" | "JOB_NOT_ESTIMATE", string> = {
  EXPIRED:
    `This signing link has expired — signing links are good for ${SIGNING_LINK_MAX_AGE_DAYS} days, ` +
    "so that a link nobody signed can't commit either side to prices that have since changed. " +
    "Ask for a fresh link and it will open right up.",
  JOB_NOT_ESTIMATE:
    "This job is already under contract, so there is nothing left to sign here. " +
    "If you were expecting a different document, ask for a fresh link.",
};

/** The calendar date a signing link stops working, for telling the sub
 * before it happens rather than letting them find out from a confused GC. */
export function signingLinkExpiresOn(createdAt: Date): Date {
  return new Date(createdAt.getTime() + SIGNING_LINK_MAX_AGE_DAYS * DAY_MS);
}
