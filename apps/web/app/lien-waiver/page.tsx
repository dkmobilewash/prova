import type { Metadata } from "next";
import { LienWaiverLanding } from "@/components/LienWaiverLanding";

/** Public landing page for the free lien waiver generator. Content and the
 * design rules it follows are in components/LienWaiverLanding.tsx. */
export const metadata: Metadata = {
  title: "Free lien waiver generator — C Stream",
  description:
    "Pick the right lien waiver, answer a few questions and download a clean PDF for the GC. Free for specialty-trade subcontractors.",
};

export default function LienWaiverLandingPage() {
  return <LienWaiverLanding />;
}
