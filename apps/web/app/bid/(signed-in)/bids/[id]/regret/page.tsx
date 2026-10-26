import RegretLetterPage from "@/app/(app)/bids/[id]/regret/page";

export const metadata = { title: "Regret letter" };

/**
 * C Stream Bid — the regret letter for a declined bid: the polite "we have to
 * pass" note that keeps a GC's list a sub is still on. THE CRM'S OWN PAGE
 * rendered with `surface="bid"` — the same letter, composed by the same
 * `lib/regret-letter.ts`, with the same print-only layout, the same
 * sender-only notes and the same refusal to name the decline reasons a GC
 * should not be told. It draws its own `PageShell`, so none is added here.
 *
 * Same capability as its CRM twin (`requireCapability("MANAGE_ESTIMATING")`,
 * which is also Bid's own), and the same company scoping: the invitation is
 * looked up by id AND the caller's company, so another company's bid is a 404.
 *
 * What differs by `surface`: its one link, back to the bids, is Bid's log.
 */
export default function BidRegretLetterPage({ params }: { params: Promise<{ id: string }> }) {
  return <RegretLetterPage params={params} surface="bid" />;
}
