import type { Metadata } from "next";
import { WallTakeoffOffer } from "@/components/WallTakeoffOffer";
import { offerIntakeAddress, offerIsOpen } from "@/lib/takeoff-offer-config";

/**
 * The free drawing-set read, on C Stream Bid — `bid.cstream.ai/wall-takeoff`.
 * The SAME offer as the CRM's public `/wall-takeoff`: the same component and
 * the same config reads, so the two cannot promise different things. Public,
 * like that page (`isBidSignedInPath` excludes it). It exists as its own route
 * because the Bid host serves only Bid paths, and the landing page's second
 * call to action is this.
 */

export const metadata: Metadata = {
  title: "Free drawing-set read",
  description:
    "Send us the bid set you are working on and we read it back to you, free — what is on the sheets, what repeats, and what nothing could read. No charge and no account.",
};

export default function BidWallTakeoffPage() {
  return <WallTakeoffOffer open={offerIsOpen()} sendTo={offerIntakeAddress()} />;
}
