### A click now shows that something is happening (Cyrus)
`cyrus/ui-loading`

Contractors said the app was hard to use, and one reason was that clicking a
link did nothing visible for 1.5 to 7 seconds while the next page rendered.
That looks like a frozen app and gets a second click. The signed-in app had
no `loading.tsx` and no progress indicator at all.

Two pieces, which hand off to each other:

- A 2px yellow bar across the top (`components/NavigationProgress.tsx`)
  starts when an in-app link is clicked and finishes when the URL changes.
  It is mounted as a `helper` shell region in `AppChrome.tsx`, so if it
  throws, the page still renders (`shellRegion.test.ts` is still green). No
  new dependency. It only animates `transform`, and under
  prefers-reduced-motion it still shows but does not move. That is enforced
  twice: in JS, and by putting the transition property only under
  `motion-safe:`.
- `app/(app)/loading.tsx` swaps the content column (never the sidebar,
  topbar or metric bar) for a skeleton shaped like the list pages, while the
  page renders. Its pulse is also `motion-safe:` only.

Checked in headless Chromium against probe routes that take 3 seconds,
because nobody can sign in from an agent. With a loading boundary, the bar
runs until the URL commits at about 70ms and the skeleton covers the rest.
Without one, the URL only commits when the page arrives, so the bar runs
for the full 3 seconds. Either way something is moving from the click until
the content appears. A link to the page you are already on does not start
the bar, because nothing would finish it.

Not covered: a navigation started from code with `router.push`, and the
back button, do not start the bar. The skeleton still covers those.

**`app/(app)/loading.tsx` is gone again (Diego, 2026-10-13, #748), and the
bar is the whole of this entry now.** Nineteen CI runs of the signed-in
suite on #748 pinned a stall to that boundary: after a Server Action or a
stage-box click the router accepted a complete, valid response and the
React transition never committed — the page boundary inside `<main>` (the
one that file creates around every page under `(app)`) was asked to go to
fallback mid-transition and was held on a thenable that never pings. Next's
layout router suspends on a never-resolving thenable by design when a
segment has no content yet, expecting a later server patch to supersede it;
with this boundary in place that supersede did not happen, in roughly one
form submit or stage click in three on CI's runner. Taking the boundary out
(run 38325255906) moved the signed-in suite from 41–49 passing to 70 of 94
with the stall family gone. Not seen on a laptop click-through, which is
what a race looks like. The skeleton is not replaced here: the bar still
runs from the click until the URL commits, which without the boundary is
when the page arrives. A skeleton that does not create a route-level
loading boundary (driven by the bar's own state, for instance) is a
follow-up for whoever owns the shell.
