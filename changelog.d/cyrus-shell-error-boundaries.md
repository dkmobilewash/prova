### One broken widget can no longer take down every page (Cyrus)
`cyrus/shell-error-boundaries`

On 2026-09-21, with real contractors testing, a single invoice produced a
render error in a component the signed-in shell mounts on EVERY page. React
unmounts the whole tree on an uncaught render error, so `/dashboard`, `/jobs`
and every job tab became "Application error: a client-side exception has
occurred" — permanently, through reloads, with nothing on screen to click.
The page the person came for was fine. The chrome around it killed it.

**Why #407's boundaries did not help, and would not have.** `app/error.tsx`
and `app/global-error.tsx` merged at 18:38Z; the account was bricked on the
build before them, which is why the tester saw Next's stock text. But on the
new build the same throw reaches `app/error.tsx` — which sits ABOVE the
`(app)` layout and therefore replaces the whole viewport: PageLoadError, no
sidebar, no topbar, on every page, with "Try again" rendering the same shell
into the same throw. Friendlier words, same dead account. A full-page
boundary is the right last resort and the wrong first resort for a stats bar.

**What changed.** Each shell region — sidebar, topbar, metric bar, and the
two invisible helpers — is inside its own `<ShellRegion>`
(`components/ShellRegion.tsx`). A region that throws is replaced by a quiet
one-line fallback of the same height ("Company figures couldn't load.",
Reload) and the page keeps working: the contractor can still open the job,
log hours, raise the RFI. The error goes to the console as
`[shell] <region> failed to render…` with the component stack, so a hidden
region is never a silent one. The page itself is deliberately NOT wrapped:
`app/(app)/error.tsx` owns page failures and says "don't submit again yet",
which a quiet fallback would swallow.

The two money QUERIES in the layout are settled the same way
(`lib/shell-region-failure.ts`): a `getMoneyRailStages` that chokes on one
strange invoice now costs the rail its figures, not the page. The alert count
and `requireCompanyContext` are not settled — a wrong badge is a claim about
the person's records, and no company context is no page.

**Two things established by probing, not reading.** React's server renderer
does not call `getDerivedStateFromError` — `renderToString` of a throwing
child inside a bare class boundary throws straight through (react-dom
19.2.8). Inside a `<Suspense>` it instead emits "switched to client
rendering" and the client retry is what the boundary catches, so the
Suspense inside ShellRegion is load-bearing. And boundary plus Suspense add
no DOM, which matters because the shell is a flex row and a wrapper element
would have been a flex item.

**The check.** `components/shellRegion.test.ts` renders a throwing widget
inside a region beside a `<main>` in a real DOM and asserts the `<main>` is
still there — with a CONTROL that renders the same throw bare and asserts
the page is gone, so the property cannot pass vacuously. A second pair does
the same for `renderToString`. A census reads `app/(app)/layout.tsx`,
derives every `@/components/` import, and fails if any is rendered outside a
region or if `{children}` is inside one. Mutation-tested: passthrough
ShellRegion → red; Suspense removed → red; MetricBar unwrapped → red.

**What this does not do.** It does not fix the `aria-describedby` crash
itself — that is a separate PR. It does not report client-side region
failures to Vercel; they are in the browser console, and a server-side one
is in the runtime log as React's recoverable-error digest.
