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
  // Diego sets this on the C Stream web project when the tool launches.
  // Server-side only (no NEXT_PUBLIC_): read at build, so a change needs a
  // redeploy. Blank counts as unset.
  const toolUrl = process.env.LIEN_WAIVER_TOOL_URL?.trim() || undefined;
  return <LienWaiverLanding toolUrl={toolUrl} />;
}
