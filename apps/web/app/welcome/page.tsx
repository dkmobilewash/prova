import { requireCompanyContext } from "@/lib/auth";
import { redirectAwayFromOnboardingIfAsked } from "@/lib/onboarding-gate";
import { CompanySetupGate } from "@/components/CompanySetupGate";

/**
 * The three onboarding questions, as their own page — reached ONLY by a
 * server-side redirect from `app/(app)/dashboard/page.tsx`
 * (`redirectToOnboardingIfUnasked`, in `lib/onboarding-gate.ts`), which is
 * the one page a fresh signup or sign-in ever lands on by default. Nobody
 * links here, and nothing in the product should start linking here — it
 * is a step, not a destination.
 *
 * DELIBERATELY OUTSIDE `app/(app)/` — a sibling of `app/sign-in/`,
 * `app/sign-up/` and `app/pilot/`, inheriting only the root layout
 * (`app/layout.tsx`: ClerkProvider, dark theme, nothing else). No
 * `<Sidebar>`, no `<Topbar>`, no rail carrying retainage and certified
 * payroll rendered behind this — that was the whole defect in the modal
 * this replaced (`CompanySetupPrompt.tsx`, now deleted): it painted a card
 * OVER an already-visible dashboard, so the four seconds this feature
 * exists to own were already spent.
 *
 * Protected in `middleware.ts` like every other authenticated route — a
 * signed-out visitor is sent to `/sign-in` first, same as anywhere else.
 *
 * `redirectAwayFromOnboardingIfAsked` re-checks the SAME condition that
 * sent the person here and bounces to `/dashboard` if it no longer holds
 * — already answered, already skipped, or a MEMBER who could never answer
 * it (a company's very first user is always its OWNER; a MEMBER only
 * joins an existing one). That is what keeps a stale bookmark or a
 * teammate's forwarded link from ever re-arming this screen.
 */
export default async function WelcomePage() {
  const { company, ...currentUser } = await requireCompanyContext();
  redirectAwayFromOnboardingIfAsked({
    role: currentUser.role,
    businessScopeAskedAt: company.businessScopeAskedAt,
  });

  return <CompanySetupGate />;
}
