import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/jobs(.*)",
  "/contacts(.*)",
  "/compliance(.*)",
  "/bids(.*)",
  "/catalog(.*)",
  "/team(.*)",
  "/schedule(.*)",
  "/settings(.*)",
  "/vendors(.*)",
  "/equipment(.*)",
  "/punch-lists(.*)",
  "/safety(.*)",
  "/rfis(.*)",
  "/cash-flow(.*)",
  "/estimating(.*)",
  "/submittals(.*)",
  "/material-orders(.*)",
  "/drawings(.*)",
  "/closeout(.*)",
  "/field-reports(.*)",
  // Ask streams over a route handler rather than a Server Action.
  // requireCompanyContext already redirects an anonymous caller, but this
  // list is the allowlist a reader checks, and a data route missing from
  // it looks public whether or not it is.
  "/api/ask(.*)",
  "/messages(.*)",
]);

// /api/messages/webhook is deliberately NOT protected here either. Email
// delivery events come from the provider, which has no Clerk session and
// never will. That route authenticates the request itself by verifying the
// signature over the raw body, and fails closed when no secret is set — an
// unverified "delivered" is worse than no event, because the whole value of
// the log is that a delivered in it means something.
// /api/quickbooks/callback is deliberately NOT protected here — see
// QuickBooksOAuthCookiePayload in lib/quickbooks-constants.ts. Intuit's
// redirect back to that route is a third-party-initiated navigation;
// requiring a live Clerk session for it can force a re-login (with 2FA)
// mid-OAuth-flow, which drops the in-flight exchange. The route
// authenticates itself via its own short-lived, httpOnly cookie instead.

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)", "/(api|trpc)(.*)"],
};
