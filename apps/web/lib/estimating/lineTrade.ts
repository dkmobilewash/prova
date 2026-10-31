/**
 * The trade a new estimate line starts on. The bid project's own trade when
 * it has one; otherwise the one trade every GC invitation on it shares —
 * which is the usual case, since a project started from a logged bid never
 * gets a trade of its own (walk of 2026-10-30: lines landed on "No trade
 * tag", so the proposal's By scope said "Other work"). Mixed or missing
 * trades start untagged rather than guessing.
 */
export function newLineTrade(
  bidProject: { tradeScope: string | null; invitations: { tradeScope: string | null }[] } | null | undefined,
): string {
  if (!bidProject) return "";
  if (bidProject.tradeScope) return bidProject.tradeScope;
  const trades = new Set(bidProject.invitations.map((invitation) => invitation.tradeScope));
  if (trades.size !== 1) return "";
  const [only] = trades;
  return only ?? "";
}
