import type { JobGuide } from "@/lib/bid/guide/types";

/**
 * The ask card, worded for the page it sits on. The layout that builds the
 * guide cannot see the query string, so this picks: on the proposal opened for
 * one GC (`/proposal?invitation=<id>`) the card is that GC's own
 * (`guide.askByInvitation`, buildJobGuide.ts) — that GC's name and price —
 * and everywhere else it is the guide's own ask. An id the guide has no entry
 * for (the ask is not "ready", or a stale link) keeps the general card.
 */
export function pickAsk(guide: JobGuide, pathname: string, invitationId: string | null): JobGuide {
  if (!invitationId || !pathname.endsWith("/proposal")) return guide;
  const ask = guide.askByInvitation?.[invitationId];
  return ask ? { ...guide, ask } : guide;
}
