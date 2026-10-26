import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { BidLanding } from "@/components/bid/BidLanding";

/**
 * C Stream Bid's public landing page — `bid.cstream.ai/` (rewritten here by
 * middleware) and `/bid` on a preview or localhost. Thin like `app/page.tsx`:
 * the content is components/bid/BidLanding.tsx, and the one thing that needs
 * a request is that a signed-in visitor goes straight to their Bid home.
 */

export const metadata: Metadata = {
  title: { absolute: "C Stream Bid — from the invite to the proposal, for wall subs" },
  description:
    "C Stream Bid measures the walls off your drawings, prices them the way your shop does, and puts the same number on the proposal — for framing, drywall, plaster and EIFS subcontractors.",
};

export default async function BidLandingPage() {
  const { userId } = await auth();
  // A literal, so the link census can read it; app/bid/page.test.ts pins it to BID_HOME.
  if (userId) redirect("/bid/home");
  return <BidLanding />;
}
