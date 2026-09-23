### Creating an invoice no longer takes down every page in the app (Cyrus)
`cyrus/invoice-shell-crash`

A contractor created one invoice on a contracted job and every signed-in
screen stopped working — the billing tab, the job overview, the retainage
tab, the jobs list and the dashboard, all with the same bare
"Application error", all still broken after a reload. There was no way
back from inside the product.

**It was not the invoice.** The money bar along the bottom of every screen
sits in the app shell, and it was being built on the server and shipped to
the browser as data. React's production build has a rule nobody in this
repo knew about: once it has written about 3,200 bytes of a page's data,
it stops sending the *next* piece of markup inline and sends a pointer to
it instead, to be filled in a moment later. The hover-description wrapper
those four figures use reads the control it is describing — and a pointer
is not a control, so it blew up. Because that bar is on every page, one
error blanked all of them at once.

So the trigger was never the amount, the blank due date, or the retainage.
It was a few bytes. `$0.00` becoming `$1,000.00` pushed that page's data
across the line. A different company name, or a longer job list, would have
done it with no invoice at all — which is why this was waiting to happen to
somebody.

**Why nothing caught it.** The 3,200-byte rule *does not exist* in React's
development build. It cannot be produced by `pnpm dev` at any size —
checked by sweeping one — so the app was clean on both laptops and fatal on
production. Typecheck, lint and the full suite were green throughout.

**What this adds, on top of #420.** #420 shipped the wrapper's own guard,
which stops the crash and silently drops the description — the entire
feature of that wrapper, and invisible to everyone but somebody on a screen
reader. So that is the floor, not the fix. The fix is at the call site: the
money bar is built in the browser now, so its markup never travels as data
and can never become a pointer. `hintClientOnly.test.ts` fails the build if
any component that renders a hint is built on the server, which is what
stops the next one reintroducing the class. The guard's own comment is
rewritten to say the one operationally important thing #420's did not: the
threshold is **production-only**, so no amount of local clicking can show
you this. The executable line is unchanged from #420, deliberately.

**Reproduced first, not argued.** A production build of the real shell,
served locally with no database, 500s at exactly two of eighteen padding
sizes with the identical error and digest, and returns all eighteen pages
with all four descriptions intact afterwards. Deleting the one line that
fixes this turns `hintClientOnly.test.ts` red and names the file; removing
the guard reproduces the production TypeError in `hint.test.ts`, which now
renders a hint around the exact pointer React produces.

Worth knowing for anyone reading an old report: this reached a real browser
as Next's own stock error screen, which means that deployment predated the
error boundaries added an hour earlier (#407). On `main` the same crash is
caught, and since #417 it costs the bar rather than the page.
