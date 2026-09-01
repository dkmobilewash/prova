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
]);

// /api/integrations/webhooks/[provider] is deliberately NOT protected here.
// A provider's servers have no Clerk session, so requiring one would reject
// every real delivery. That route is written on the assumption that anyone
// can reach it: it stores no payload, changes no connection's status, and
// only writes a log row for a payload naming an account an existing
// connection already claims. Signature verification arrives with the first
// provider that has one.
//
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
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    // Clerk's auto-proxy path. On a production *.vercel.app host there is no
    // clerk.<domain> CNAME to point at — the domain is Vercel's, so no DNS
    // record can be added to it — and Clerk proxies its Frontend API through
    // the app's own origin at /__clerk instead. Middleware has to run on
    // that path for the proxy to be routed.
    //
    // Deliberately NOT in isProtectedRoute above: this is the path a person
    // who is NOT yet signed in uses to sign in. Protecting it would lock
    // everyone out of the front door.
    "/__clerk/:path*",
  ],
};
