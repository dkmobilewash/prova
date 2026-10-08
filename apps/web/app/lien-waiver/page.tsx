import type { Metadata } from "next";
import { LienWaiverLanding } from "@/components/LienWaiverLanding";

/** Public landing page for the free lien waiver generator. Content and the
 * design rules it follows are in components/LienWaiverLanding.tsx. */
export const metadata: Metadata = {
  title: "Free lien waiver generator — C Stream",
  description:
    "The state's own lien waiver form, filled in. Free for specialty-trade subcontractors in Arizona, California, Nevada and Texas.",
};

export default function LienWaiverLandingPage() {
  return <LienWaiverLanding />;
}
