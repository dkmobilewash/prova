import type { Metadata } from "next";

/**
 * C Stream Bid — every route under `/bid` (served at `bid.cstream.ai/` by
 * middleware; see lib/bid/surface.ts). This layout only names the product in
 * the tab; the signed-in shell is `(signed-in)/layout.tsx`, and the landing
 * page and the free drawing-set read render without one.
 */
export const metadata: Metadata = {
  title: { template: "%s · C Stream Bid", default: "C Stream Bid" },
};

export default function BidLayout({ children }: { children: React.ReactNode }) {
  return children;
}
