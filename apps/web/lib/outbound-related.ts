/**
 * `OutboundMessage.relatedType` values that ONLY a dedicated sender may write.
 *
 * The pair is free text on the `/messages` composer (`sendOutboundEmail`), and
 * that is fine for what it is used for there — a label on the log. It is NOT
 * fine for a type some other code READS AS A FACT:
 *
 *   BID_INVITATION  the Bid guide and the proposal composer read it as "this bid
 *                   was sent" (`lib/bid/guide/facts.ts`, `proposal-send-query.ts`);
 *                   written only by `submitBidPackage` and `sendBidProposal`.
 *   BID_QUOTE       a supplier RFQ (`sendQuoteRequest`).
 *   HELP_REQUEST    excluded from the outbound cap (`outbound-email-limit.ts`), so
 *                   a forged one would also be a way round the cap.
 *   ALERT_DIGEST    the notifier's own digest (`notification-dispatch.ts`).
 *
 * A MANAGE_JOBS user posting `relatedType=BID_INVITATION` to the generic
 * composer could otherwise mark any bid "sent" without sending it. So the
 * generic composer refuses these, compared trimmed and case-blind.
 */
export const RESERVED_RELATED_TYPES = ["BID_INVITATION", "BID_QUOTE", "HELP_REQUEST", "ALERT_DIGEST"] as const;

export function isReservedRelatedType(value: string | null | undefined): boolean {
  const normalised = (value ?? "").trim().toUpperCase();
  return (RESERVED_RELATED_TYPES as readonly string[]).includes(normalised);
}
