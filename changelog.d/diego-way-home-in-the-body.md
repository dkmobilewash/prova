### The way out of a dead-end screen, on the fourth attempt, somewhere a test can see it (Diego)
`diego/way-home-in-the-body`

**No schema change, no migration.** Mobile only.

**Three fixes shipped for this bug and none of them rendered.** #548 put a
Home button in `/alerts`'s header. #553 copied it to `/job/<id>`. #554 moved
it to the layout as an options function. Every one shipped green. Every one
did nothing on a phone. A person tapping a notification from a cold start
was trapped on the screen all three times.

**What the three had in common is the whole lesson: the header is delivered
by machinery this codebase cannot observe.** A page-level
`<Stack.Screen options>` delegates to a `navigation.setOptions` call behind
an `isFocused`/`isPreloaded` guard that a cold deep-link launch skips
(`views/Screen.js`). A function passed as layout `options` is spread with
`{ ...props.options }` at `StackScreen.js:78`, and a function has no
enumerable own properties, so it becomes `{}`. Either explains a silent
failure; neither could be seen from here, and three guesses is two too many.

**So the control moved into the screen BODY.** It is a view, rendered by
React like every other pixel in the app. It cannot be dropped by a
navigator, cannot depend on focus or preload timing, and — the point —
**a test can see it.**

**It is also UNCONDITIONAL now, and that is a deliberate trade.** The
earlier versions rendered only when `router.canGoBack()` was false, on the
sound reasoning that a warm tap already has a back chevron. But
`canGoBack()` being false on a cold tap is an INFERENCE drawn from the
missing chevron — nothing here has observed it. Weigh the two failures:
always rendering costs a redundant button beside a chevron on a warm tap,
which is cosmetic; the condition being wrong costs somebody trapped on the
screen for a fourth release. The condition is gone. Put it back only after
somebody confirms on a phone that this renders at all, and then it is a
refinement rather than a fix.

**The census has now been wrong twice and both are worth more than today's
assertion.** It first checked that the screen files CONTAINED `canGoBack`
and `HeaderHomeButton` — they did, and it passed with its size and scope
assertions holding, on an app where nothing rendered. It was then rewritten
to check the LAYOUT wired those options — it did, and it passed again, and
nothing rendered again. **A census can tell you the code is there. It can
never tell you a framework honours it.** That is not a third failure of
rigour; it is the limit of the instrument, and the fix was to assert
something the instrument can actually reach.

It now asserts every destination renders `<WayHome />`, that `WayHome` has
no early `return null`, and that nobody reintroduces the header approach in
**either** place it already failed — in a screen, or as a layout
`headerLeft`.

**Mutation-tested six ways, control first, and M3 is the row that earns
all of it:**

| | mutation | reds on |
| --- | --- | --- |
| ctl | nothing | green, both suites |
| M1 | `<WayHome />` removed from `/job/<id>` | "renders `<WayHome />` on every destination" |
| M2 | removed from `/alerts` | same |
| **M3** | **WayHome renders nothing** — the failure that shipped three times | **census + all three screens tests** |
| M4 | header pattern put back inside a screen | census, two assertions |
| M5 | `headerLeft` put back in the layout (#554's approach) | "keeps the way out of the header" |
| M6 | `replace` → `push` | census + screens |

M3 is the difference between this attempt and the last three. "Renders
nothing" was invisible to every test written for #548, #553 and #554. It
now fails four separate assertions.

**Deleted:** `HeaderHomeButton.tsx` and its test. Nothing renders it, and
dead code that looks like a fix is how this went wrong repeatedly. Its label
was also coloured `brand` — #facc15 yellow text on a near-white rail, which
`theme.ts` explicitly forbids ("As TEXT, `link` is the readable amber —
never `brand`"). Nobody caught it because the button never appeared. The new
control uses `link`.

**What is proven and what is not.** Proven: the control renders, it renders
whatever `canGoBack()` says, it replaces rather than pushes, and every
destination has it. Not proven: that it is *positioned* well — no test in
this repo can measure layout, happy-dom returns zeros from
`getBoundingClientRect`, so the 56pt target is a token (`hitTargetPrimary`)
checked by `touch-targets.test.ts` rather than a measurement. And nobody has
tapped it on a phone yet.
