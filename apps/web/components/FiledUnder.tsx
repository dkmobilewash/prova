/**
 * "Came in with <GC>'s invite" — on a supplier quote, an addendum or a spec
 * section that is on this row because it belongs to the PROJECT but was filed
 * under a DIFFERENT GC's invitation.
 *
 * Quotes, addenda and spec sections are about the building, so every GC
 * invitation on the project shows them (lib/estimating/bid-papers.ts). Which GC
 * a paper first came in with still matters in two places — an addendum is
 * acknowledged on each GC's own bid form, and a person looking for "the framing
 * quote Doron got from Alpha" remembers whose invite it arrived with — so the
 * row says so, in words, when it is not this GC's own. Renders nothing for a
 * paper filed under this very invitation, where saying it would be noise.
 */
export function FiledUnder({ gc }: { gc: string | null | undefined }) {
  if (!gc) return null;
  return (
    <span data-bid="filed-under" className="ml-2 text-xs text-ink-muted">
      came in with {gc}&apos;s invite
    </span>
  );
}
