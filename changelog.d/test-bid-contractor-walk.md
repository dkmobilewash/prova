### A contractor's walk through C Stream Bid, printed into the CI log (Cyrus)
`feat/contractor-walk`

Cyrus asked for somebody to click through Bid "acting like a real contractor". Nobody can from an
agent container: the preview's sign-in carries Cloudflare Turnstile, and Clerk's testing token needs
the secret key only CI's `e2e` job holds. So the click-through is now a spec that job runs signed in,
`apps/web/e2e/specs/bid-contractor-walk.spec.ts`. It walks one tenant-improvement job the way a
framing and drywall sub would:

- the landing page signed out, then Bid Home;
- two GCs and the first GC's invite pasted from its email;
- a second GC logged on the same job;
- the estimate started from the project;
- a takeoff on the S02 fixture, with the scale clicked, Find the walls, and groups added;
- three hand-typed lines, cost types, rates and Apply;
- the job's ask box;
- the second GC priced 5% under, and that GC's proposal in all three presentations;
- an addendum, the job walk moved to tomorrow, and both acknowledgements;
- Home again, and the same screens at 375px.

**Its output is the deliverable.** Screenshots cannot be fetched back from CI by the person judging
the product. Instead every screen and press prints one `[walk]` line carrying what a contractor would
have read: headings, the guide's ask card, the rail's five steps, bid so far, refusals and empty
states. `grep '\[walk\]'` over the `e2e` job's log is the transcript.

What it asserts is what a sub must be able to do, plus page health on every screen: no error
boundary, no uncaught exception, and no link out of Bid. Everything that needs a person's judgement
is printed, not asserted. The walk is one test with `expect.soft` wherever later steps do not depend
on the outcome. A serial file stops at its first failure, and a transcript that ends at its first
surprise is a third of one. The ask box and the invite reader are not stubbed. With the runner's
blank model key they say they are unavailable, and the walk prints that sentence rather than an
invented answer. The known #418 race is recorded, not asserted, as `estimating-spine.spec.ts` does.

NOT EXECUTED where it was written. It was typechecked, with a control error proving the checker saw
the file; linted; and enumerated by `playwright --list`. The first real run is the `e2e` job on its PR.
