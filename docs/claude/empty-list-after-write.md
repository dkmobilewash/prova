# Issue #61: a successful write shown as an empty list

Moved word for word from `CLAUDE.md` on 2026-10-30 to keep that file under the size
every session loads. "Above", "below" and "this file" in the text mean `CLAUDE.md`,
where its short entry keeps the rules.

- **A successful write can show up as an empty list — cause NOT
  established, and now with TWO dead explanations instead of one.**
  Observed: the action returned ok, the row was in the database, the page
  said "Nothing on order", and a manual reload showed it. Issue #61.

  **Dead explanation 1 — the connection pool.** The pool was throwing
  `Timed out fetching a new connection` at the time and this entry
  originally blamed it. Wrong: there is an error boundary now, but there
  was none then, so a throwing query would have 500'd rather than
  rendered an empty list. A ColorZilla extension was also injecting a
  hydration mismatch into `<body>` in the same repro, so that run had two
  confounds in it.

  **Dead explanation 2 — "the router refresh never fired".** This entry
  carried that as the leading untested hypothesis, on the grounds that it
  fits all three observations. It does fit, and it is still WRONG. Read
  out of the INSTALLED Next source on 2026-09-03 (`next 15.5.23` — note
  `package.json` says `^15.1.3`, which is not what is on disk):

    - `server/web/spec-extension/revalidate.js:156` sets
      `pathWasRevalidated = true` UNCONDITIONALLY, with a
      `// TODO: only revalidate if the path matches` still in the source.
      **The path argument you pass is irrelevant to this mechanism.**
    - so `skipFlight` is false at `server/app-render/action-handler.js:773`
      and flight data IS appended to the action's POST response;
    - and an action POST does not send the `RSC` header, so
      `flightRouterState` is undefined and the render walks from the root
      — **action flight is always a root render.**

  So a Server Action that calls `revalidatePath` and RETURNS a value
  re-renders the client with no `router.refresh()` at all. The call is
  redundant in the happy path. This app carries its own control proving
  it: `TakeoffForm` has no `router.refresh()`, its action revalidates at
  `lib/actions/jobs.ts:511`, and it demonstrably works.

  Every client-side branch that could silently leave a stale page was
  walked and each is unreachable for this app's action shape, including
  action forwarding — ruled out from `server-reference-manifest.json`,
  where all 26 action-carrying pages hold the full manifest, so
  `selectWorkerForForwarding` can never pick a different worker.

  **Two numbers this entry used to imply, both wrong.** The
  `router.refresh()` tally is 29 of 98 client components, not "18 of 60".
  And NO write action in this codebase is missing revalidation — all ten
  naive grep hits are false positives, `fieldReports.ts` routing through
  its own `revalidateBoth()` helper. "Somebody forgot to revalidate" is
  eliminated everywhere, so do not go looking for it.

  **Dead explanation 3 — and the differential that killed it. THE CAPTURE
  THIS ENTRY ASKED FOR HAS NOW BEEN RUN** (2026-09-05, production, signed
  in, both submits in one tab). `/settings` add-a-licence against
  `/jobs/[id]` add-a-takeoff-line, instrumented from the page rather than
  read off DevTools — a `fetch` wrapper for the `Next-Action` POST, a
  `console.error` wrapper, and Resource Timing for sizes.

  | | A: licence | B: takeoff |
  | --- | --- | --- |
  | `x-action-revalidated` | `[[],1,0]` | `[[],1,0]` |
  | decoded response | 34,342 B | 75,806 B |
  | action round-trip | 1,544 ms | 1,519 ms |
  | first byte -> stream end | 1,543 -> 3,749 ms | 1,516 -> 4,411 ms |
  | console | clean | clean |

  **There is no difference.** Both surviving possibilities die on this:
  the flight half was NOT dropped (34 KB of page payload arrived on the
  suspect), and revalidation WAS signalled (byte-identical header). A
  fourth hypothesis raised for that run — that `<form action={fn}>`
  behaves differently from `<form onSubmit>`, which is the one structural
  difference between these two components — is not supported either.

  What the numbers do show is the response STARTING at ~1.5s and finishing
  streaming at 3.7-4.4s, scaling with payload. That is the server
  re-rendering the whole page after the action, and the DOM cannot update
  before it lands. A human tester independently measured 5-7s on unrelated
  routes the day before. **So the shape is post-action server render cost,
  not a lost update** — which makes it #118's territory (Neon compute wake,
  `connection_limit=5`) rather than this issue's.

  Do NOT re-run the capture. It has been run and it answered. What remains
  genuinely unexplained is only the ORIGINAL observation — a committed row,
  an empty list, a reload that fixes it — IF it was seen well after the
  render had finished. Nobody recorded how long they waited, which is why
  a report of this shape now needs a timestamp before it counts as
  evidence.

  **SOMEBODY FINALLY RECORDED ONE, 2026-10-04, AND IT IS NOT A LOST UPDATE.**
  The timestamp this entry has been asking for since 5 Sep. A bid quote's
  expiry edited on production, signed in, nothing clicked afterwards and no
  reload, polled from the page every 250ms with the clock started on the Save
  click itself:

  | | |
  | --- | --- |
  | Save pressed | t0 |
  | action resolved, edit form CLOSED | **1,251 ms** |
  | row repainted with the saved value | **3,502 ms** |
  | still correct at | 15,000 ms |

  Reload afterwards agreed: the change was stored and the screen was right.
  So the write lands, the revalidation fires, and **the DOM corrects itself
  without a reload** — at three and a half seconds, which is the post-action
  server render this entry already measured at 1.5-4.4s.

  **THE DEFECT IS THE GAP BETWEEN THOSE TWO ROWS, AND IT IS A UI BUG RATHER
  THAN A DATA ONE.** `ActionForm` ran its `onSuccess` the instant
  `await action(formData)` resolved, so for **2.25 seconds** the form was gone
  — telling the estimator the save had finished — while the row behind it
  still showed the OLD value. That is why this reads as a lost update: the
  thing you were editing disappears, confirming the action worked, and the
  screen contradicts you. Two separate click-throughs reported it as a bug;
  neither timed it, and the untimed report is indistinguishable from a real
  lost update, which is exactly what this entry warned.

  Fixed by firing `onSuccess` (and the reset) from a settle effect gated on
  `useTransition`'s `isPending`, which is false only once the transition's own
  re-render has committed — so a form closes onto fresh data. The cost is that
  a successful save leaves the form open ~2s longer, with its button disabled
  and spinning for all of it.

  **AND THE WRONG DIAGNOSIS IS WORTH MORE THAN THE FIX, because this file is
  where it would have been believed.** Before timing it I concluded that
  `SubmitButton`'s spinner was dead in every `ActionForm` — `useFormStatus` is
  documented as reporting a form submitted through the `action` prop, and this
  form uses `onSubmit`, so it followed. It is FALSE.
  `components/actionForm.test.ts` had already measured exactly that inference,
  says in its header that it "looked like it must break `SubmitButton`" and
  does not because React 19 tracks a transition started in the form's own
  submit handler, and asserts `disabled` and `aria-busy` mid-flight. Its last
  line reads *"This test exists so that stays true rather than being
  rediscovered."* It was rediscovered anyway, from the React docs, by somebody
  who had not read the test sitting beside the component — and a Slack message
  claiming 16 files were broken went out before the test was run. **Read the
  test next to the code before believing a doc-derived inference about it.**

  What IS established, and was from the start: a page that fails after a
  commit invites a second click, and no create action is idempotent. #19
  disabled 57 create buttons while their form is in flight and added an
  error boundary that says not to resubmit before reloading.
