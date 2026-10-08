import type { Metadata } from "next";
import { LienWaiverOffer } from "@/components/LienWaiverOffer";

/**
 * `/lien-waiver` — the landing page for the free lien waiver generator.
 *
 * PUBLIC, like `/wall-takeoff` and `/pilot`: it is handed out as a bare link
 * in outreach and opened on a phone at a job walk, so it is outside the
 * `(app)` group and absent from `middleware.ts`'s protected list, which is an
 * allowlist of what is PROTECTED rather than of what is open.
 *
 * Thin on purpose: Next rejects stray named exports from a page module at
 * BUILD time, and `lib/pageWidthCensus.test.ts` refuses a width cap in a
 * route file. So the column, the copy and the figure all live in the
 * component.
 *
 * `startHref` is where the GENERATOR lives — Diego's, not this page's. It is
 * a prop rather than a hardcoded string because the tool's route is his to
 * name, and a landing page that guesses it is a broken button the day he
 * picks something else.
 */

export const metadata: Metadata = {
  title: "Free lien waiver generator — C Stream",
  description:
    "Fill in your state's own lien waiver form and get the PDF back, free and without an account. Arizona, California, Nevada and Texas.",
};

export default function LienWaiverPage() {
  return <LienWaiverOffer startHref="/lien-waiver/start" />;
}
