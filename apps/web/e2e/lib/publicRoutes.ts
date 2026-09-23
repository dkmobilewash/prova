/**
 * EVERY PAGE A PERSON CAN REACH WITHOUT SIGNING IN — the routes absent from
 * `middleware.ts`'s protected list.
 *
 * WHY THIS LIST EXISTS SEPARATELY FROM THE REST OF THE SUITE. Playwright's
 * `globalSetup` mints four Clerk users before any spec opens a browser, so
 * the whole suite — including `pilot.mobile.spec.ts`, which signs nobody in
 * and asserts nothing but layout — cannot run without a Clerk development
 * instance's secret key. On a machine or a CI job that has no such key,
 * nothing runs at all: not one layout check, on the one suite in this repo
 * that can see layout. These routes need no session, so they are collected
 * here and run by `playwright.public.config.ts`, whose setup talks to
 * Postgres and to nothing else.
 *
 * TWO of them are addressed by a TOKEN rather than a session, which is why
 * this file also owns the tokens: `public-setup.ts` seeds the rows, the spec
 * walks the paths, and neither has to guess what the other used.
 *
 * `publicRoutes.test.ts` (the UNIT suite, which runs on every push) pins
 * this list to `middleware.ts` and to the filesystem, so a new public page
 * fails the build until it is walked here. That is deliberate and is this
 * repo's scope rule: a census that picks its own scope can be green about a
 * directory it never looked in.
 */

/** Seeded by `public-setup.ts` onto a Contact's `portalToken`. Lower-case
 * alphanumerics only: it goes in a URL path segment and in a `@unique`
 * column, and a token that needs escaping would make a failure here a
 * question about escaping rather than about layout. */
export const PORTAL_TOKEN = "zze2epublicportaltoken0000001";

/** Seeded onto a PENDING `SignatureRequest.token`. Same rules. */
export const ESIGN_TOKEN = "zze2epublicsigntoken000000001";

export interface PublicRoute {
  /** The URL as walked. */
  path: string;
  /** How a failure report names it. */
  label: string;
  /** The route pattern as it appears on disk, for the census in
   * publicRoutes.test.ts — `/portal/[token]`, not the seeded path. */
  pattern: string;
  /** A string the page must render. NEVER a string a shell, a placeholder
   * or a loading state could also produce — CLAUDE.md's "a watcher whose
   * needle is already on the page" entry is about exactly this, and a
   * layout assertion is the easiest place in this repo to commit it: a
   * blank page has no horizontal overflow either. */
  mustShow: string;
}

export const PUBLIC_ROUTES: readonly PublicRoute[] = [
  {
    path: "/",
    label: "landing page",
    pattern: "/",
    // components/LandingPage.tsx. The founder's complaint that produced
    // #404 was that this page was blank on his phone, so of every route
    // here this is the one whose "did it render" check earns its keep.
    mustShow: "union specialty",
  },
  {
    path: "/pilot",
    label: "pilot sign-up page",
    pattern: "/pilot",
    mustShow: "Your whole job, in one place.",
  },
  // A section heading from the body of each, not the title in the header —
  // the shared PublicDocument chrome links to both pages by name from every
  // page, so "Privacy" and "Terms" are on screen whether or not the document
  // itself rendered.
  { path: "/privacy", label: "privacy policy", pattern: "/privacy", mustShow: "What we keep" },
  { path: "/terms", label: "terms of service", pattern: "/terms", mustShow: "Your account" },
  {
    path: "/quickbooks/disconnected",
    label: "QuickBooks disconnected",
    pattern: "/quickbooks/disconnected",
    mustShow: "can no longer reach your QuickBooks Online company",
  },
  {
    // THE GC-FACING PAGE. A general contractor opens this from a link in an
    // email, on whatever device is in their hand, and it is the only screen
    // in this product a customer's customer ever sees.
    path: `/portal/${PORTAL_TOKEN}`,
    label: "GC portal, job list",
    pattern: "/portal/[token]",
    mustShow: "Hi, ",
  },
  {
    path: `/esign/${ESIGN_TOKEN}`,
    label: "subcontract e-signature",
    pattern: "/esign/[token]",
    // The signing panel's own heading, not the word "Sign" — which is in
    // the header of half the app and would have made this check vacuous.
    mustShow: "Sign to accept",
  },
] as const;

/** Page files under `app/` that are deliberately NOT walked, with the reason
 * each one is absent. Read by publicRoutes.test.ts, so "we meant to leave
 * this out" is a statement the build checks rather than a silence. */
export const PUBLIC_ROUTE_EXCLUSIONS: Readonly<Record<string, string>> = {
  // Walked, but by FOLLOWING THE LINK from /portal/[token] rather than as a
  // path of its own — the seed does not hand the spec a job id, and clicking
  // through is how a GC reaches it anyway.
  "/portal/[token]/jobs/[jobId]": "walked by following the link from /portal/[token]",

  // NOT WALKABLE WITHOUT A CLERK DEVELOPMENT INSTANCE, and this is a
  // measurement rather than an assumption. Both pages are a Clerk
  // <SignIn>/<SignUp> component and nothing else; with a placeholder
  // publishable key the component never mounts, and `main` renders 0
  // visible characters at every width measured (320/360/375/390/414). A
  // width assertion against a page with no content in it is the vacuous
  // check CLAUDE.md's "watcher whose needle is already on the page" entry
  // is about: it would pass forever and mean nothing. They belong to the
  // Clerk-backed suite, where the widget actually renders.
  "/sign-in/[[...sign-in]]": "renders 0 characters without a real Clerk instance; asserting width on it would be vacuous",
  "/sign-up/[[...sign-up]]": "renders 0 characters without a real Clerk instance; asserting width on it would be vacuous",
};
