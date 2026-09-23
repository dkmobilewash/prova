import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WwccaLanding } from "@/components/associations/WwccaLanding";
import { WWCCA } from "@/components/associations/wwcca";

/**
 * /associations/wwcca — a page for WWCCA member contractors. NOT LIVE TO THE
 * PUBLIC, and it must stay that way until the association has seen it and
 * agreed, in writing, to the use of its name:
 *
 *   - `robots: noindex, nofollow` below, hard-coded, asserted by page.test.ts;
 *   - linked from NOWHERE — not the landing page, not /pilot, not a nav, not
 *     a sitemap (there is none). page.test.ts fails the build if any source
 *     file under apps/web links to /associations;
 *   - switchable off in one line: `WWCCA.enabled = false` in
 *     components/associations/wwcca.ts makes this route 404.
 *
 * There is NO partnership or endorsement with the WWCCA. Read the header of
 * components/associations/wwcca.ts before changing a word of this page.
 *
 * Public in the middleware sense (absent from its protected list, like /pilot)
 * because the committee must be able to open it without an account. Static:
 * no auth call, no database read.
 *
 * The /associations/<slug> shape leaves room for another association later,
 * the way Siteline runs /trade-association/<slug>. It is one literal route,
 * not a [slug] segment, until there is a second association to justify one.
 */

export const metadata: Metadata = {
  title: "C Stream for WWCCA member contractors",
  description:
    "For union wall-and-ceiling subcontractors: the week's hours entered once, feeding certified payroll, fringe remittance and apprentice ratios, with the pay application off the same job.",
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};

export default function WwccaAssociationPage() {
  if (!WWCCA.enabled) notFound();
  return <WwccaLanding />;
}
