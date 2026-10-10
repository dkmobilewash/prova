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
