import type { Metadata } from "next";
import { WallTakeoffOffer } from "@/components/WallTakeoffOffer";
import { offerIntakeAddress, offerIsOpen } from "@/lib/takeoff-offer-config";

/**
 * `/wall-takeoff` — the free drawing-set read, offered to a specialty-trade
 * sub we are trying to sell to. Handed out as a bare link in outreach, so it
 * is PUBLIC: outside the `(app)` group and absent from `middleware.ts`'s
 * protected list, the same way `/pilot`, `/privacy` and `/terms` are. A page
 * you must sign in to read cannot be passed around at a job walk. Nothing
 * else is needed to make a route public here — the middleware matcher is an
 * allowlist of what is PROTECTED.
 *
 * Thin on purpose, like `app/page.tsx`: Next's page-file type checking
 * rejects any named export from a page module besides the ones it recognises
 * (a BUILD failure, not a typecheck one), and `lib/pageWidthCensus.test.ts`
 * refuses a width cap in a route file against an exemption list that only
 * shrinks. So the content, the column and the copy all live in
 * `components/WallTakeoffOffer.tsx`.
 *
 * The two reads below are the only thing here that needs the environment, and
 * they go through `lib/takeoff-offer-config.ts` so THE PAGE CANNOT OFFER A
 * PATH THE ACTION THEN REFUSES: with no address to receive a set, the offer
 * renders closed and `requestDrawingSetRead` refuses independently rather
 * than trusting that the page checked.
 */

export const metadata: Metadata = {
  title: "Free drawing-set read — C Stream",
  // Deliberately a summary rather than a list of the deliverables: the page
  // itself renders those from `lib/takeoff-offer.ts`, and a meta description
  // that enumerates them is a second copy waiting to drift.
  description:
    "Send us the bid set you are working on and we read it back to you, free — what is on the sheets, what repeats, and what nothing could read. No charge and no account.",
};

export default function WallTakeoffPage() {
  return <WallTakeoffOffer open={offerIsOpen()} sendTo={offerIntakeAddress()} />;
}
