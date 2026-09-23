import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { LandingPage } from "@/components/LandingPage";

/**
 * The public landing page at app.cstream.ai — the first thing anyone sees
 * who types the domain or is handed a bare link, before /pilot's specific
 * invite and before a sign-up. It used to be a headline and two buttons;
 * the founder opened it on his phone and called it "just a blank page that
 * says sign up or log in."
 *
 * The visitor-facing content lives in components/LandingPage.tsx, not
 * here — Next's page-file type checking rejects any named export from a
 * page module besides the ones it recognises, so this file stays down to
 * exactly what a Page is allowed to export: the default and `metadata`.
 * See that component's own header for the honesty rules the copy follows.
 *
 * The redirect below is the one thing that DOES need a request: a signed-in
 * visitor has nowhere to go from here but the dashboard, unchanged from the
 * page this replaced. See page.test.ts for both directions of that guard.
 */

export const metadata: Metadata = {
  title: "C Stream — built for union specialty-trade subcontractors",
  description:
    "The estimate, the contract, the crew's hours, certified payroll and the GC's pay application in one place — for framing and drywall, plaster, EIFS, ceiling and fireproofing subcontractors.",
};

export default async function HomePage() {
  // A signed-in person has nowhere to go from here but the dashboard.
  const { userId } = await auth();
  if (userId) redirect("/dashboard");
  return <LandingPage />;
}
