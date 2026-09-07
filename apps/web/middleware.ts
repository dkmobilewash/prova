import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/jobs(.*)",
  "/contacts(.*)",
  "/compliance(.*)",
  "/bids(.*)",
  "/pipeline(.*)",
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
  "/backcharges(.*)",
  "/alerts(.*)",
  "/prevailing-wage(.*)",
  "/union-compliance(.*)",
  "/field-reports(.*)",
  "/sales(.*)",
  // Ask streams over a route handler rather than a Server Action.
  // requireCompanyContext already redirects an anonymous caller, but this
  // list is the allowlist a reader checks, and a data route missing from
  // it looks public whether or not it is.
  "/api/ask(.*)",
  "/messages(.*)",
  // The data export returns a file rather than a page, for the same reason
  // and with the same consequence: it is the single widest read in the app,
  // so it belongs in the list a reader checks even though the handler
  // itself is OWNER-gated.
  "/api/export(.*)",
  "/deployment(.*)",
]);

// /api/integrations/webhooks/[provider] is deliberately NOT protected here.
// A provider's servers have no Clerk session, so requiring one would reject
// every real delivery. That route is written on the assumption that anyone
// can reach it: it stores no payload and only writes a log row, which says
// on its face where it came from (`direction: WEBHOOK_RECEIVED`).
//
// This paragraph used to add "changes no connection's status", and that
// sentence was FALSE — the route stamped lastSyncedAt and
// lastSyncStatus: "SUCCESS" on the connection, so an anonymous caller
// authored the field an operator reads to judge whether an integration is
// healthy. It also claimed the caller "needs a real externalAccountId, not
// just the URL"; that id is the literal "sandbox-000" for every company
// that connects, a constant in this repo. Both are gone (2026-09-03): the
// write is removed and this list no longer vouches for a bound that was
// not there.
//
// The lesson worth keeping: an allowlist entry is only as good as the
// sentence justifying it, and nothing checks that sentence. Re-read the
// route before trusting this one. Signature verification arrives with the
// first provider that has one.
//
// /api/messages/webhook is deliberately NOT protected here either. Email
// delivery events come from the provider, which has no Clerk session and
// never will. That route authenticates the request itself by verifying the
// signature over the raw body, and fails closed when no secret is set — an
// unverified "delivered" is worse than no event, because the whole value of
// the log is that a delivered in it means something.
// /api/notifications/digest is deliberately NOT protected here either. It
// is the nightly alert-digest run, and a scheduler has no Clerk session any
// more than a webhook provider does. That route authenticates the request
// itself with a timing-safe check of `Authorization: Bearer $CRON_SECRET`,
// and fails closed when no secret is set — unset must mean the schedule
// does not work, never that it works for anyone who knows the URL.
// /api/quickbooks/callback is deliberately NOT protected here — see
// QuickBooksOAuthCookiePayload in lib/quickbooks-constants.ts. Intuit's
// redirect back to that route is a third-party-initiated navigation;
// auth.protect() on it can force a re-login (with 2FA) mid-OAuth-flow,
// which drops the in-flight exchange.
//
// ABSENT FROM THIS LIST MEANS "NOT FORCED TO SIGN IN", NOT "SEES NO
// SESSION", and the difference is the fix for #136 §2. clerkMiddleware
// still RUNS on the path — the matcher below covers /(api|trpc)(.*) — and
// decorates every request it handles with the auth headers, so the route
// reads the session with requireCompanyContext() and takes the companyId
// it binds from THERE. It used to take it from its own cookie, which the
// browser's owner can edit, and that let anyone bind their QuickBooks
// tokens to another company. The cookie now carries CSRF state and a
// cross-check, nothing that decides access.

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
