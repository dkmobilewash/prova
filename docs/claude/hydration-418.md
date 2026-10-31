# The #418 hydration mismatch investigation

Moved word for word from `CLAUDE.md` on 2026-10-30 to keep that file under the size
every session loads. "Above", "below" and "this file" in the text mean `CLAUDE.md`,
where its short entry keeps the rules.

- **A #418 HYDRATION MISMATCH "ON SEVENTEEN PAGES" IS ONE DEFECT IN THE
  SIGNED-IN SHELL, FIRING ON ABOUT ONE PAGE LOAD IN THREE — AND IT IS NOT A
  DATE.** 2026-09-25, from four instrumented CI runs (#501) and a local
  production build that reproduces the mechanism without a browser (the fix
  branch). Read the eliminations before doing any of this again; each one is
  an afternoon.

  **The list of URLs is not a list of broken pages.** The journey's step 11
  prints every URL a mismatch fired on, and both `e2e/lib/health.ts` and the
  assertion's own message used to call that "the shape of something in the
  job-tab shell rendered from 'now'" and point at the Dates bullet above.
  That sentence is why this stayed open for weeks: it is plausible, it is
  wrong, and three separate investigations went looking at timezones. The
  URLs differ almost completely between runs — 14 in one, 17 in the next,
  with six in common — because the page is not the variable.

  Measured instead of argued, all in one signed-in session against a
  production build in CI:

  | probe | result |
  | --- | --- |
  | 12 named pages, 3s dwell, MAIN persona | 0 mismatches |
  | 38 nav destinations, no dwell | 6 pages |
  | the same 38, 3s dwell, same session | 4 pages, one shared with the walk above |
  | 4 pages × 10 reloads | **12 mismatches in 40 loads** |

  So it is roughly one authenticated page load in three, and the per-page
  rate varies (/safety 5 of 10, /settings 5 of 10, /backcharges 2 of 10,
  /wall-types 0 of 10) rather than being a property of any page. A clean run
  over a handful of pages proves nothing, which is how the first probe
  produced a confident wrong answer.

  **IT CANNOT BE A DATE, AND THE ERROR ITSELF SAYS SO.** React #418 carries
  its kind as the first argument, and every occurrence in every run reads
  `args[]=HTML`. From the installed react-dom 19.2.8,
  `cjs/react-dom-client.development.js`, `throwOnHydrationMismatch`:
  `"Hydration failed because the server rendered " + (fromText ? "text" :
  "HTML")`. `fromText` is true ONLY for a text-node mismatch, so `HTML` is an
  ELEMENT-level disagreement — a node one side has and the other does not.
  A date, a currency, a locale format or a relative time is a TEXT mismatch
  and produces the other word. On top of that, Playwright sets no
  `timezoneId`, so in CI the server and the browser are both UTC and every
  zone-derived value is identical on the two sides by construction. Check
  the `args[]` before theorising: it halves the search space for free.

  **TWO ELEMENT-LEVEL DIVERGENCES WERE FOUND IN THE SHELL, AND THE ORDER OF
  THIS ENTRY IS THE ORDER THEY WERE BELIEVED IN, NOT THEIR SIZE.** Both are
  fixed and the count is NOT yet zero — step 11 went 14-19 on `main`, to SIX
  with the first fix, to ONE with both (CI runs 36176373400 and 36176953068).
  The survivor is `/jobs/<id>/crew`, and the shape of that is the lesson: every
  symptom that was the SHELL showed up on many pages at once, so one page means
  one page. Do not read the remaining entry as more of this.

  **One — a region's children arriving as a LAZY.** `<ShellRegion>`
  (`components/ShellRegion.tsx`) is a client component and the `(app)` layout
  is a server component, so `<ShellRegion region="sidebar"><Sidebar …/>
  </ShellRegion>` made `<Sidebar>` an element that crosses the RSC boundary
  as `children` — where React's PRODUCTION Flight serializer defers any
  element it reaches once the current row passes 3,200 bytes, and the browser
  turns the deferral back into a lazy. A lazy suspends, and `ShellRegion`
  wraps its children in a `<Suspense>`. Same trap `components/Hint.tsx`
  documents, same reason it cannot reproduce in `next dev`. **Fixed** by
  pairing each region with its widget inside `components/AppChrome.tsx`, a
  "use client" module, so the element is created by whoever renders it and
  never travels through Flight. Verified from the Flight payload of a real
  production build: the layout's row went from eleven `$L` deferrals to
  seven, and every shell region is now inline plain data.

  **Two — Clerk's `<UserButton>`.** It renders `clerk.loaded &&
  <ClerkHostRenderer …/>` (`@clerk/clerk-react@5.61.9`,
  `chunk-THNCS7QR.mjs:669`) and `loaded` is a mutable flag on a singleton,
  read DURING render, false on the server always. So the server writes no
  markup for it on any signed-in page; if Clerk's script wins the race
  against hydration, the browser's FIRST render writes an element the
  server's HTML does not have. Element-level, every authenticated page, a
  race — the right shape on all three counts. **Fixed** by
  `components/AfterMount.tsx`, which renders nothing until mount. That cannot
  change what anybody sees, because the server already rendered nothing
  there; it can only remove the disagreement.

  **AND A THIRD THING THAT LOOKS EXACTLY LIKE THE BUG AND IS NOT — READ THIS
  BEFORE BELIEVING A `B:`/`S:` PAIR.** Counted on four pages straight out of
  the server's response, no instrumentation:

  | page | `<template id="B:` | `<div hidden id="S:` | `<!--$?-->` pending | `<!--$-->` settled | bytes |
  | --- | --- | --- | --- | --- | --- |
  | /wall-types | 1 | 1 | 1 | 6 | 50,432 |
  | /backcharges | 1 | 1 | 1 | 6 | 54,961 |
  | /safety | 1 | 1 | 1 | 6 | 60,014 |
  | /settings | 2 | 2 | 2 | 5 | 98,626 |

  A MutationObserver installed before the page's first script caught the
  sidebar and then the top bar being lifted out of those hidden divs into the
  shell row, in the same millisecond as one of the #418s. #501 read that as
  proof that a shell boundary had SUSPENDED. **It is not.** React streams a
  boundary out of order when it is merely BIG, having never suspended at all:
  `flushSegment` in react-dom-server checks
  `isEligibleForOutlining(request, boundary) && flushedByteSize +
  boundary.byteSize > request.progressiveChunkSize`, where eligible means
  only `500 < byteSize` and `progressiveChunkSize` defaults to 12,800 (Next
  sets it only for its own inserted-HTML sub-render, never for the page).
  The sidebar's markup measures **13,442 bytes**, so that region is outlined
  on EVERY authenticated page, deterministically — which is exactly why every
  page in the table ships at least one pair.

  Proved by building the shell at a public route on a local production build
  and counting the markers before and after fix One: **3 pending boundaries
  before, 3 after, byte-identical sidebar content both times**, while the
  Flight payload changed completely. So the markers are not evidence of
  suspension, they are not evidence about the mismatch, and a fix that
  removes them is not available from app code — the only lever is the
  boundary's own size, and the sidebar cannot be made small. Do not spend a
  day on them.

  **ELIMINATED, so nobody re-runs these.**
    - `localToday()` in server-rendered markup: all eight hits in files
      without `"use client"` are COMMENTS, including the only apparent
      candidate — `components/DeterminationFactsFields.tsx`, whose comment
      says `localToday()` "would be wrong on both counts and is not
      imported". The #185 shape, one level deeper than it looks.
    - the `prova_tz` cookie's first-visit fallback: `TimeZoneCookie` renders
      `null` and does its work in an effect, `viewerTimeZone()` runs only on
      the server, and CI is UTC on both sides regardless.
    - invalid HTML nesting (a `<div>` in a `<p>`, a nested `<button>`, a
      nested `<form>`, a `<tr>` with no `<tbody>`) — all of which the
      browser's parser rewrites, producing a guaranteed non-text mismatch.
      Scanned with the TypeScript AST across 345 files and 460 components,
      resolving one level of component composition: zero findings, and the
      scanner was mutation-tested against a fixture that has all five.
    - the page's own imports: the failing and passing sets share every
      module once the actions barrel is excluded.
    - `packages/ui`: five files, none of which reads a clock, a window or a
      storage API.
    - the navigation cadence: 6 mismatches with no dwell against 4 with a
      three-second dwell, same session. It is not an artefact of the suite
      navigating fast.
    - **the crew tab's own components**, checked 2026-09-25 after step 11
      named `/jobs/<id>/crew` as the last survivor. Five components are
      unique to that tab — `TimeEntryRow`, `TimesheetSignoffs`,
      `LogTimeEntryForm`, `DispatchSlipForm`, `SignatureImage` — and none of
      them reads a clock, a window, a storage API or a mutable singleton in
      render position, and none renders a nested `<form>` on a FIRST render:
      the correction form and the reopen form are both behind state that
      starts `false`. The two element-valued props the page hands across the
      RSC boundary (`RowActions destructive={…}`, `ConfirmDelete hint={…}`)
      can arrive as deferred lazies exactly as the shell's did, and a lazy
      alone is harmless — it only becomes a mismatch inside a `<Suspense>`,
      and `ShellRegion` is the only `<Suspense>` in this app.
    - **hook initialisers that read the browser**, app-wide: every
      `useState`/`useMemo`/`useSyncExternalStore` initialiser in every
      `"use client"` file under `app/` and `components/` was read, and
      exactly ONE touches a browser API — `useMedia` in
      `components/WalkthroughTour.tsx`, `useState(() =>
      window.matchMedia(query).matches)`. It is NOT a hydration hazard and
      must not be "fixed": nothing server-renders it. `FullTour` returns
      `null` until `stopId` leaves its literal `null`, and `HelpButton`
      mounts it from a click — the "mounted by a user action" case
      `components/localToday.ts` describes. Recorded because the scan reads
      like a finding and is not one.

  **THE PUBLIC SUITE PROVES NOTHING ABOUT THIS.** `e2e-public` is green and
  calls `expectHealthy` WITHOUT a monitor, so it never looks at `pageerror`
  at all. Public pages were separately checked with a monitor, locally and
  in real Chromium, at both cadences: clean — which is evidence, and it is
  evidence the green check was not giving.

  **How to re-run any of it.** The signed-in suite cannot run in an agent
  container (Clerk's FAPI host and `cdn.playwright.dev` are both denied by
  the egress proxy), so the browser instrument is CI's own `e2e` job on your
  PR and step 11's list. What CAN be run locally, and is worth more than it
  sounds, is the MARKER COUNT: build for production, mount the shell's shape
  at a route outside `(app)` so no sign-in is needed, `next start`, and count
  `<template id="B:` / `<div hidden id="S:` / `<!--$?-->` in the response.
  That is what settled the third item above in twenty minutes. A local
  Chromium exists at `/opt/pw-browsers` — but it cannot reach a loopback
  server, because Playwright launches it with
  `--proxy-bypass-list=<-loopback>` and the agent proxy refuses plain-HTTP
  requests, so `page.goto("http://127.0.0.1:…")` returns the proxy's own 405
  page. A run that looks green there has loaded nothing; check that the page
  HYDRATED (a `__reactFiber$` key on a real element) before believing any
  number from it.

  **"ONE PAGE" DOES NOT MEAN "SOMETHING ON THAT PAGE", AND #507's OWN BODY
  SAYS IT DOES.** Added 2026-09-25, correcting that PR from its own numbers
  rather than from an argument. It reads the final list — one entry,
  `/jobs/<id>/crew` — as a different investigation, "something on the crew
  tab, not the chrome around it", and tells the next person to start there.
  The run before it, with only the region fix in, listed SIX pages and crew
  was not among them. Both runs walk every job tab, so a defect that lives on
  the crew tab would have been in both lists. It was in one.

  So what is left is not a crew defect. It is a residual RACE at a low enough
  rate to land on one page out of roughly forty page loads, and which page it
  lands on carries no information — the same sentence this entry opens with,
  applied to a list of length one. A list that short is the hardest one to
  read correctly, because it looks like a location.

  **AND THE NEXT RUN SETTLED IT BY MEASUREMENT RATHER THAN BY THIS ARGUMENT.**
  CI run 36194376856, head `062bcd7f`, the merge of this branch with `main`
  (so #493's SearchLauncher fix is in too): step 11 printed THREE entries and
  not one of them was the crew tab —

      on http://localhost:3100/dashboard        Minified React error #418; args[]=HTML&args[]=
      on http://localhost:3100/pipeline         Minified React error #418; args[]=HTML&args[]=
      on http://localhost:3100/material-orders  Minified React error #418; args[]=HTML&args[]=

  `verdicts: collected 63, returned 63`, 62 of 63 specs passing, step 11 the
  only failure, and `console errors captured (0)`. Three runs, three disjoint
  lists (six pages, then `crew`, then these three) with only `/dashboard`
  recurring. The list is the race's dice, not a location, at every length.

  What follows for the next person: do not start by reading the crew tab (it
  has been read — see the ELIMINATED list), and do not start by reading
  `/pipeline` or `/material-orders` either. Start by asking which mechanism
  can still make the browser's FIRST render disagree about an ELEMENT, and
  note that both mechanisms found so far were global and neither was visible
  on every page it could fire on. And a step 11 that prints nothing on one
  run is not proof either: the assertion is measuring a race, so one green
  run is one sample. Two consecutive clean runs is the weakest claim worth
  making, and `main` has never produced one.

  **AND `main` HAS NOW PRODUCED ITS FIRST SINGLE CLEAN RUN, WHICH DOES NOT
  REFUTE THE SENTENCE ABOVE AND IS THE MORE USEFUL FACT BECAUSE OF THAT.**
  2026-09-26, run 36220670340, `main` at `3889b179` (#520's merge): all four
  jobs green, the `e2e` job's journey step running a full 3m13s and PASSING,
  the verdict count green, step 11 printing nothing. The commit after it went
  red again (`303d60bc`), and so did the one after that — `d6fa3a6f`, with
  SEVEN entries: `/jobs/<id>` twice, `/jobs/<id>/billing`,
  `/jobs/<id>/field-reports`, `/alerts`, `/drawings`, `/closeout`.

  So "two consecutive" is still a claim nobody can make and the sentence
  above stands as written. What changed is that there is now a GREEN `main`
  run sitting in the history between two red ones, and the next person who
  finds it while checking whether #510 is fixed will get the wrong answer
  from it. One sample of a race is not a verdict — this file's own rule,
  arriving as a temptation instead of a warning.

  The fourth page list is worth more than the green run: four lists now, and
  no page appears in all four. `/dashboard` was the only page recurring
  across the first three, and it is absent from this one. The list is the
  dice.

  **THE OUTLINED-BOUNDARY HYPOTHESIS IS REFUTED, AND THE ERROR NUMBER IS THE
  WHOLE ARGUMENT.** Added 2026-09-25. The best surviving explanation was: the
  sidebar region's `<Suspense>` is outlined deterministically (13,442 bytes
  against React's 12,800 `progressiveChunkSize`), so between the bootstrap
  script and that region's own `$RC` the boundary is `<!--$?-->`, and
  hydration arriving in that window throws #418. Measured in the live
  document, the window is real and large:

  | in the served HTML | byte |
  | --- | --- |
  | the async bundle `<script>` tags, in `<head>` | 510-2,096 |
  | `<!--$?--><template id="B:n">` x4 | 2,262-32,209 |
  | the bootstrap `webpack-…js` script | 32,322 |
  | `<div hidden id="S:1">` — the sidebar's real markup | 32,412 |
  | **`$RC("B:1","S:1")`** | **45,671** |

  So hydration CAN begin 13.3 KB of HTML before the sidebar's boundary is
  completed. That much is true. What is false is the consequence:

  | arm (40 and 12 loads, real Chromium, real production bundles) | hydrated | sidebar rendered | #418 | other |
  | --- | --- | --- | --- | --- |
  | the document exactly as served | 40/40 | 40/40 | **0** | none |
  | every `$RC(...)` call replaced by `void 0` | 12/12 | 12/12 | **0** | **#419 on every load** |

  **React answers a pending boundary with #419, not #418** — "The server
  could not finish this Suspense boundary… Switched to client rendering",
  which is its DESIGNED path: it client-rendered the rail itself, every
  load, and cleared the pending markers. And `e2e/lib/health.ts` matches
  `#(418|423|425)`, so a #419 is classified as a CRASH, not a mismatch. Had
  this ever fired in the pilot journey it would have failed the step it
  happened on, because `expectHealthy` asserts `monitor.crashes` is empty at
  every navigation — and `crashes` has been empty in every run. So the
  mechanism is not merely wrong about the error number, it is absent from
  the journey.

  **The method is the reusable part, because `next start` + `page.goto`
  CANNOT be used from an agent container.** Chromium there cannot reach
  loopback: with the proxy env set every navigation is
  `ERR_TUNNEL_CONNECTION_FAILED`, and Playwright's own
  `--proxy-bypass-list=<-loopback>` re-forces it even when `no_proxy` says
  otherwise (`coreBundle.js`, `_innerDefaultArgs`). Two ways round it were
  tried and failed; the one that works needs no network at all: capture the
  document once with `curl --noproxy '*'`, then serve it and every
  `/_next/**` asset to a real Chromium through `page.route(...).fulfill()`
  from disk. Real bundles, real inline scripts, zero sockets.

  Two harness failures are recorded because each one produced a confident
  wrong number first, and each was caught only by its own control. Writing
  the boundary HTML BY HAND mismatched in all four arms including the
  completed control — the container markup simply did not match the tree.
  TRUNCATING the document before the first `<div hidden id="S:`> left
  `hydratedLoads: 0`, because the cut removes the tail of the Flight payload
  too, so nothing hydrates and the arm is about something else. **A control
  that fails is the instruction to fix the harness, not a result to read.**

  **AND THE SECOND CANDIDATE WENT THE SAME WAY: A FLIGHT-DEFERRED ELEMENT PROP
  IS NOT A MISMATCH EITHER.** Same harness, a probe page where a SERVER
  component hands element props to a CLIENT component forty times over — the
  exact shape the crew tab uses for `RowActions destructive={…}` and
  `ConfirmDelete hint={…}`.

  The arm's own positive control is the thing worth copying: the served
  document was checked for `$L` references before any conclusion, because
  without a deferral the arm is about nothing. **92 of them**, and all forty
  slot elements present in the server HTML — so the production serializer
  really did defer, at the documented 3,200-byte threshold. Driven 20 times:
  20/20 hydrated, 20/20 slots rendered, **0 × #418**.

  So a lazy arriving in place of an element prop renders, and does not
  disagree. That matches the code — a lazy can only mismatch by SUSPENDING
  inside a `<Suspense>`, and `ShellRegion` is the only one in this app, so a
  page body has no boundary for it to suspend into.

  **The bound on that one is real and is the reason it is an elimination
  rather than a proof.** `route.fulfill()` serves the whole document at once,
  so the deferred rows are always present by the time the lazy is read — the
  one case where it does NOT suspend. The obvious fix, dropping the later
  `self.__next_f.push` chunks to starve it, was tried and its control failed
  (`hydratedLoads: 0`): removing Flight chunks removes the tree, not just the
  deferred rows, so nothing hydrates and the arm measures something else.
  **Three failed arms in this investigation, every one caught by its own
  control and none by inspection.** A suspending lazy therefore remains
  untested, and testing it needs a server that can dribble the stream — which
  is a harness nobody has built.

  **What this leaves.** The shell alone, replayed from one captured document
  with no Clerk script and no real page body, is clean over 40 loads with
  hydration and the rail both proved present. At the journey's own rate
  (3 in ~40 page loads) 0/40 is p≈0.04, so this is evidence rather than
  proof, and it is bounded in one specific way: replaying ONE document
  removes all server-side stream-timing variance, so a race that lives in
  how the server interleaves chunks would not show here. Taken with the
  page lists — `/dashboard`, `/pipeline`, `/material-orders`, `/messages`,
  `/proposals`, `/submittals`, two job tabs — the weight has moved OFF the
  chrome and onto something the probe lacks: the page bodies' own client
  components. Whoever goes next should suspect those rather than the shell,
  and should NOT re-run the marker count or the boundary arms.

  **AND THE ONE INSTRUMENT NOBODY HAS POINTED AT IT YET.** `console errors
  captured (0)` on the run above is not a bug in the reporting — production
  React puts #418 on `pageerror` and prints nothing to the console, so that
  line will read zero on every production run and can never name the element.
  `E2E_DEV_SERVER=1` (`e2e/playwright.config.ts`, from #495) runs the journey
  against `next dev`, where React prints the diff and the component stack. It
  is the only way left to learn WHICH element the two sides disagree about,
  and it cannot be run from an agent container (Clerk's FAPI host is denied by
  the egress proxy). It needs a run on a machine that can sign in — CI with
  that variable set, or a laptop. Note the one thing dev mode changes that
  matters here: the 3,200-byte Flight deferral does not exist in the
  development build, so a mismatch that survives into `next dev` is NOT that
  mechanism, and one that vanishes there probably is.

  **IT HAS NOW BEEN POINTED AT IT, ON A LAPTOP, AND THE MISMATCH VANISHED —
  96 LOADS, ZERO.** 2026-09-30, on `1ff6510d`, against `next dev` with the
  `striking-jaybird` development keys and a throwaway loopback Postgres.

  | batch | pages | loads | #418 |
  | --- | --- | --- | --- |
  | A | `/dashboard` `/safety` `/settings` `/backcharges` | 24 | **0** |
  | B | `/pipeline` `/material-orders` `/messages` `/proposals` | 24 | **0** |
  | C | `/submittals` `/alerts` `/drawings` `/closeout` | 24 | **0** |
  | D | `/wall-types` `/jobs` `/contacts` `/equipment` | 24 | **0** |

  Sixteen routes — the union of all four page lists this entry records, so
  the obvious objection ("you tested the quiet pages") is answered — plus
  three the lists never named. Against production's own measured rate of 12
  in 40 loads, P(0 in 96) is about 10^-15; at a deliberately conservative 5%
  per load it is still 0.007.

  **THE ZERO IS ONLY WORTH READING BECAUSE THE INSTRUMENT WAS PROVED ABLE
  TO RETURN NON-ZERO, and the first version of the probe could not have
  been.** Every batch ended with a POSITIVE CONTROL: the served HTML for
  `/dashboard` was rewritten through `page.route` to carry one extra `<div>`
  inside `<body>` — inside React's own tree, since the App Router renders
  `body` — which is the ColorZilla mechanism from the #61 entry above. All
  four controls fired 3/3 and named the injected node in the diff, and no
  `pageerror` was ever captured outside a control phase. Every load was
  separately proved HYDRATED by looking for a `__reactFiber$` key, because
  React cannot mismatch on a page it never hydrated and an un-hydrated load
  is a silent zero.

  Two harness lessons from it, in the family of this file's other control
  failures. **A control's own success criterion has to come from what React
  documents it will do**: the probe first asserted the injected node was
  PRESENT after hydration and went red on a working control, because the
  error says in as many words that the tree "will be regenerated on the
  client" — the regeneration deletes the node, so 0/3 present is what
  success looks like. And the control must match on the HYDRATION SENTENCE
  rather than count errors, or a broken rewrite (a 500, a parse failure)
  passes as a working control.

  **WHAT IT ESTABLISHES, AND THE CONFOUND THAT STOPS IT BEING A VERDICT.**
  Per the rule in the paragraph above, a mismatch that vanishes under `next
  dev` is probably the Flight deferral — this is the first POSITIVE signal
  in an investigation that had produced nine eliminations and no mechanism.
  But two variables moved at once: build mode AND machine. The defect is a
  RACE, and a laptop dev server is not a GitHub runner, so "vanishes in dev"
  and "vanishes locally" are not yet separated. Dev mode is also not a
  one-variable change from production — no minification, different chunking,
  an HMR client, different outlining thresholds — so the result implicates
  that whole set, not one member of it.

  The one cheap experiment that separates them: **run the probe in CI with
  `E2E_DEV_SERVER=1`**, on the same runner class that reports 3-7 mismatched
  pages in production mode. Until that runs, this is strong evidence about
  the build and weak evidence about the mechanism.

  **IT HAS RUN, 2026-10-05, AND THE CONFOUND IS SETTLED: THE DEFECT IS THE
  BUILD, NOT THE MACHINE.** Run `37347729521`, `main` at `627465b8`, the
  `Hydration probe (#510)` workflow — `workflow_dispatch` only, in
  `e2e/probes/` where the gating suite's `testDir` cannot see it, so this
  diagnostic can never turn CI red.

  | | |
  | --- | --- |
  | loads | **24** (4 routes × 6), every one proved HYDRATED |
  | hydration mismatches | **0** |
  | positive control | **fired 3/3** |

  **The control is why the zero is readable at all.** Phases one and two of
  that probe would return a clean zero from a run that signed nobody in, or
  loaded pages React never hydrated — the vacuous green this directory
  exists to end. So every load carries a `__reactFiber$` proof, and the last
  phase INJECTS a `<div>` inside `<body>` and fails the probe if it cannot
  catch it. 24/24 hydrated and 3/3 control is the instrument saying it was
  able to see what it did not find.

  **And the comparison is contemporaneous rather than historical, which is
  what makes it worth reading.** The same runner class, the same day, in
  production mode: run `37344541638` (#631) printed NINE mismatched pages
  and `37346674544` (#633) printed SIX, both with `verdicts: collected 94,
  returned 94` and zero 429s. Against this entry's own measured production
  rate of 12 in 40 loads, P(0 in 24) ≈ 0.0002; at a deliberately
  conservative 10% per load it is still ≈ 0.08.

  So the laptop's 96-load zero was NOT a laptop artefact, and the paragraph
  above can stop hedging about which variable moved. Only the build differs
  here. **Flight's 3,200-byte deferral remains the surviving mechanism**,
  and it does not exist in a development build.

  **THE EXPENSIVE CONSEQUENCE, AND THE REASON THIS IS WRITTEN UP RATHER THAN
  LEFT AS A GREEN RUN: THE DEV-MODE INSTRUMENT IS NOW EXHAUSTED.** The
  paragraph above calls it "the one instrument nobody has pointed at it yet"
  and wants it for the one thing production cannot give — the ELEMENT and
  its component stack. It has now been pointed, and it reports nothing,
  because the defect does not reproduce there. **A development build can
  only name an element it actually sees disagree.** So the element-naming
  route is CLOSED, not pending, and the next person must not spend a run on
  it: a dev-mode probe will keep returning 24/24, 3/3, zero, which looks
  like progress and is the same measurement repeated.

  That is the opposite of what this entry implied for ten days, and both
  versions were true when written. What is needed next is a PRODUCTION-mode
  instrument that can identify an element without React's help — and the
  honest state of it is that nobody has designed one.

  **Two bounds, stated because the number above is smaller than it looks.**
  24 loads is a QUARTER of the laptop sweep's 96, over 4 routes rather than
  16 — so this is the weaker sample of the two, and it is only decisive
  about the MACHINE question because of what it is being compared against.
  And it is ONE run of a RACE, which is this file's own rule: re-dispatch
  the probe before treating a future zero as confirmation of anything.

  And the counter-example that keeps it honest, from this file's own record:
  the accidental dev-mode CI run (`36097089609`) DID name an element, the
  `data-clerk-component="UserButton"` div that `AfterMount` then fixed. So
  dev mode is not blind to #418 in general. What is shown is that the
  RESIDUAL mismatch behaves differently from the one already fixed — which
  is itself a fact about the residual, and the most specific one anybody has.

  **A DEV RUN ALSO REPORTS DEFECTS A PRODUCTION RUN STRUCTURALLY CANNOT,
  and the sweep found one on the way past.** `/closeout` logs React's "Each
  child in a list should have a unique `key` prop" on every render — 6 of 6
  loads, and the only page of the sixteen that produced it. Production React
  strips that warning, so no production run, however green or however red,
  can ever surface it. It is not a hydration mismatch and not related to
  #418. Filed for Cyrus's lane (WORK-SPLIT.md:44, Closeout & Warranty)
  rather than fixed here, per the working agreement's rule 3. The
  transferable part is the reason to point a dev run at this app
  occasionally even when nothing is wrong: there is a class of real defect
  that only a development build will tell you about.

  **RUNNING IT AGAIN: `next dev` DIES AFTER ABOUT TEN COMPILED ROUTES**, and
  the two memory failures need different fixes. `⚠ Server is approaching the
  used memory threshold, restarting...` is cured by
  `NODE_OPTIONS=--max-old-space-size=8192` and takes the tests in flight
  with it when it is not. `FATAL ERROR: Zone Allocation failed - process out
  of memory` is NOT — zone allocation is a separate allocator that the heap
  flag does not govern — and the next symptom is `page.goto:
  net::ERR_CONNECTION_REFUSED`, which reads exactly like a broken app. Four
  routes per dev server, one worker, a fresh server per batch. Three of the
  four attempts at this measurement died in harness failures before the
  fourth produced a number, which is the honest cost of the table above.

  **WHAT NOW GUARDS THE SECOND FIX.** `components/afterMount.test.ts` proves
  the gate works and says nothing about anybody using it — delete the two
  lines in `Topbar.tsx` that wrap `<UserButton>` and every test still passed.
  `components/clerkMountGate.test.ts` closes that: every Clerk UI component
  rendered anywhere Tailwind's `content` globs reach must sit inside
  `<AfterMount>`, with `/sign-in` and `/sign-up` named as the two exemptions
  and each asserted to still exist and still render a Clerk card.

  **The reason for those two exemptions is worth reading, because the WRONG
  reason was written first and it was this file's own worst habit.** It said
  `e2e-public` walks both pages and is green. That job calls `expectHealthy`
  WITHOUT a monitor — the paragraph above says so — so it never reads
  `pageerror` and cannot see a hydration mismatch anywhere. Citing it would
  have put a vacuous green inside a guard written to end vacuous greens. The
  actual reasons: gating those two renders the app's front door blank for a
  frame, and Clerk hands `SignIn`/`SignUp` a `fallback` prop with
  `renderWhileLoading: true` so the waiting state is something IT draws.

  And the open half — **MEASURED 2026-10-04, and it was open because nobody
  had an instrument, not because it was hard.** `SignIn` and `SignUp` carry
  the same `clerk.loaded &&` branch as `UserButton`
  (`chunk-THNCS7QR.mjs:556` and `:577`), so the race exists on those two
  pages in principle. The only evidence against it used to be that the
  journey's monitor is attached BEFORE `signInAs` and no run has ever named
  `/sign-in` — which this file called weak, and it was.

  A real Chromium against the preview, 48 loads with a `pageerror` monitor:

  | arm | loads | hydrated | Clerk card | #418 |
  | --- | --- | --- | --- | --- |
  | control, before | 3 | 3 | 3 | **3** |
  | `/sign-in` | 24 | 24 | 23 | **0** |
  | `/sign-up` | 24 | 24 | 21 | **0** |
  | control, after | 2 | 2 | 2 | **2** |

  The controls are the whole reason the zeros are readable, and they run at
  BOTH ends so a mid-run harness death cannot hide behind them. The control
  injects one `<div>` into `<body>` from `addInitScript` before any page
  script — the ColorZilla mechanism from the #61 entry — and its success
  criterion is that the node is REGENERATED AWAY (3 of 3, 2 of 2), because
  React says the tree "will be regenerated on the client". Against the signed-in
  shell's own measured rate of 12 in 40, P(0 in 48) is about 10^-8.

  **Two bounds, because the second one is the real limit.** This is a preview
  deployment, not a GitHub runner, and the defect is a race. And the dangerous
  ordering is Clerk's script winning against hydration — on 1 of 24 and 3 of 24
  loads the Clerk card had not rendered at all by the 1.8s mark, which means
  those loads could not have mismatched even in principle, so the fast-Clerk
  case is probably UNDER-sampled. Strong evidence the exemption is safe at
  anything like the shell's rate; not proof at a low one.

  Three harness failures happened before this produced a number, and all three
  were mine rather than the app's: a control that re-served a decoded body with
  the original `content-encoding: br`, so nothing parsed and 48 loads were
  measured against a blank document; a replacement using Playwright's
  `route.fetch()`, which this container's egress proxy answers **403** (browser
  navigation is allowed, Playwright's Node-side fetch is a separate path — do
  not route around it); and a hydration gate reading only
  `document.querySelector("body *")`, which reported `hydrated: 0` on a control
  that was firing perfectly, because after a mismatch React regenerates the tree
  and the first element is no longer one it owns. Scan many elements for a
  `__reactFiber$` key, not one.

  **How the census keeps itself honest.** It counts the files it parsed
  against a second expression that shares no regex with the first, requires
  every Clerk import statement to yield a component name (so a default or
  namespace import fails instead of parsing to nothing), derives its roots
  from `content` rather than from its own directory, and reads every
  structure with comments STRIPPED — which is not decoration here:
  both `AfterMount.tsx` and `Topbar.tsx` print `<UserButton />` in their own
  headers, so a raw-text census would find a render site that does not exist
  and, with a commented `<AfterMount>` around a bare widget, would call it
  gated. Mutation-tested six ways, each red naming the offender: gate
  removed, gate present only in a comment, the import pattern drifted (fails
  on the COUNT: "the sources contain 4 files and this census parsed 0"), a
  new Clerk widget added, a `content` glob pointed at a directory that does
  not exist, and `<UserButton>` reached through a namespace import.
