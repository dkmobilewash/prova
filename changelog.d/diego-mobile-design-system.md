### A design system with a document, and the light palette changes sides (Diego)
`diego/mobile-design-system`

**Phone only. No schema, no migration, no web files, no logic.** The web
app is untouched and stays dark.

**WHAT CAME IN.** `DESIGN.md` at the repo root, extracted from
`cstream-mobile-design-ui` — colour, type, spacing, radius, depth,
density, buttons, inputs, list density — plus a CLAUDE.md rule making it
the authority ("All UI must follow DESIGN.md. Don't use default shadcn
styling"). `apps/mobile/lib/theme.ts` is its executable copy and says so
in its own header.

**THREE THINGS ABOUT THE SOURCE, recorded because none is obvious from
opening it.** It ships **no screenshots** — `public/` is favicons and v0's
stock `placeholder-*` files, so every value here came from reading CSS,
not from looking. Its design is **two themes stacked in one 82-line
file**: a blue/multicolour base, then a `/* FieldLink monochrome theme */`
block appended after it, and later rules win — so the monochrome theme is
what renders and the blue one is dead. That override is **not** inside a
media query, so it also beats the `prefers-color-scheme: dark` block above
it: the reference has no working dark mode. And its
`components/ui/button.tsx` is **untouched default shadcn** that its own
`page.tsx` never imports — scaffold, not design, which is precisely why
the CLAUDE.md rule names shadcn.

**THE LIGHT PALETTE CHANGED SIDES, and #584 was not wrong.** #584
darkened the canvas to `#e5e7ee` so white cards would lift off it, on the
correct observation that with a ~4% step the outline was doing all the
separating. The reference removes the *premise* instead of the conclusion:
its canvas and surface are the **same white**, and a card is told apart by
a `#e5e5e5` hairline. With no canvas step there is nothing for a shadow to
fall on. So `light` is now `flat`, `dark` stays `lifted` (a hairline is
nearly invisible on `#0f0f0f`), and `outdoor` stays `flat` with its
glare-proof `#6b6b6b`. The old reasoning is kept in `card-depth.test.ts`'s
header rather than deleted — it was right about the canvas it described.

**WHAT THE REFERENCE DID NOT GET TO CHANGE.** Its type runs 9-13px on
40pt targets. Body stays **17**, nothing below **13**, targets stay
**48** — the parts that earn their keep in gloves. The hierarchy was
adopted (30/-.05em title, 18/-.03em section, tracked overline); the sizes
were not. Eight deviations total, each with its reason, in DESIGN.md's own
table so nobody "fixes" one back.

**ONE VALUE WAS SUBSTITUTED RATHER THAN COPIED.** The reference's muted
grey `#858585` is **3.69:1** on white and fails the 4.5:1 floor — at 9px,
in the tab bar. `#737373` (4.74:1) is the nearest principled value with
headroom. Every one of the 17 enforced pairs was computed before the file
was edited, not after.

**AND A REGRESSION THE TESTS COULD NOT HAVE SEEN.** Making `rail` white
made it identical to `surface`, and `app/job/[jobId].tsx` used
`colors.rail` as its activity-tile **pressed** state — so a pressed tile
would have shown no feedback whatsoever. Nothing in this repo can catch
that: it is two tokens being equal, which is legal, on a state no test
renders. Found by grepping every `rail`-as-background use after the change
and asking what it sat on. It is `railHover` now, which is what
`GroupedRow` and `JobContextChip` already used.

| mutation | card-depth |
| --- | --- |
| control, nothing changed | green |
| `light` flips back to `lifted` | **RED** |
| `outdoor`'s border softened to light's hairline | **RED** |

That second row is the one worth having. The two flat palettes are flat
for *different* reasons, and a "both flat, so share the value" tidy-up
would spend the only cue a crew in direct sun has. The new assertion
compares the two border weights rather than trusting a comment.

**Still unverified, and it needs a phone.** Nothing here was looked at on
a device. The tab bar separates by a 1px top border it already drew, so
white-on-white is fine there; `handover.tsx`'s header draws **no** border
and is now white on white, which matches the reference's own borderless
topbar but has not been seen. Suites: 37 files / 319 tests and 15 / 74,
typecheck clean.

---

### The reference's components, built — and the donut that measured nothing

**A SECOND PASS, because the first one shipped a design SYSTEM and not a
design.** The tokens above were correct and almost invisible: canvas
`#e5e7ee` → `#ffffff` and card radius 12 → 15, on a phone pinned to the
DARK palette, which this change never touched. Diego saw nothing and said
so. The reference's identity was never in its stylesheet — it is in
`page.tsx`, a file the first pass read **twelve lines of** (the import
list) before deciding the tokens were the job.

So this pass builds what that file actually renders.

**`AppHeader`** — the brand lockup: mark, a tracked `C STREAM` overline,
the screen name at 32pt. The reference also puts a notification bell up
here; we do not. That mock has the same five tabs we do, so a header bell
is a second door to the Alerts tab sitting one thumb-reach below it with
its own unread badge. Two controls for one destination is chrome, and it
costs a 48pt target in the row where titles live. The avatar stays and
carries the name the greeting used to.

**It costs the greeting**, which is a product change rather than a
restyle: "Good afternoon, Diego" is warmer than "Home", but two stacked
headings is one too many and the lockup is the most recognisable thing in
the reference. The date stays — on a field app the day is a fact people
check. The three `home.greeting.*` keys went with it, which
`strings-census.test.ts` noticed before a human did: *"written, documented
and never called — 3 keys nothing references."*

**`QuickActions`** — the four-up row. The reference's four are mock labels
("Create project", "Users & groups") and it tints each tile a different
colour; ours are the four things that happen on a site TODAY — the same
set the job hub groups as `day` — and all four tiles take one yellow.
Four colours would be four meanings nobody assigned, on a row where the
icon already says what the thing is. Status colour is spent on status.

**`JobProgressBanner`** — and this is where the money was. The reference
leads the job screen with `Job value $12,092.64` and `Balance due
$5,046.32` either side of a donut. Diego's call: keep the band, drop the
money. The ring is now the share of the punch list VERIFIED, flanked by
the other two states — because punch items have **three**, and
`lib/types.ts` already says the middle one is "the one a foreman needs to
see". A band showing open-vs-done would hide exactly the state somebody
has to act on. It reads the rows the Punch list tile already counts, via
`cacheGet` — no request, no new key.

It is **inverted rather than black**: the reference hardcodes `#111111`,
which on our `#0f0f0f` canvas is a card you cannot see. Painting `ink` on
`surface`-coloured text gives a solid band in light, a bright one in dark
and true black in outdoor, with no new tokens — and the text pair is the
inverse of `ink on surface`, which theme-contrast already holds at 7:1.

**THE DONUT IN THE REFERENCE MEASURES NOTHING, AND THAT IS THE FINDING
WORTH KEEPING.** Its CSS is `border: 8px solid #facc24;
border-left-color: #111111` — three sides one colour, one side another,
with "58%" printed in the middle. It draws an identical shape at 12% and
at 94%. Ported faithfully it would have been decoration wearing a
measurement's clothes, which is this repo's most expensive recurring
shape.

So the arc is derived, and the derivation lives in `lib/progress-arc.ts`
where a plain-node test can hold it to the claim — `react-native-svg`
cannot be imported by the lib suite and is mocked away in the screens
suite, so a test routed through a render could only ever assert that
nothing threw.

| mutation | `progress-arc` |
| --- | --- |
| control | green |
| **fixed quarter-ring (the reference's own donut)** | **RED** |
| clamp removed (1.4 draws past the circle) | **RED** |
| radius not inset by the stroke (ring clips flat) | **RED** |

The first mutation is the reference implementation. A guard that goes red
on the thing you were asked to copy is the point of writing it.

**One new native dependency**, `react-native-svg@15.15.4` at the SDK-pinned
version — an arc needs a renderer. It is mocked in `screens/setup.tsx`
alongside the fifteen already there.

**Still phone-unverified.** 38 files / 325 tests and 15 / 74, typecheck
clean, `expo lint` clean. Nobody has looked at any of it on a device.

---

### Two defects a phone found, and one the phone could not have

**Build 11 on a real device, driven through iPhone Mirroring.** The band
works: on ZZQB-TEST with one open punch item it rendered `Open 1` / a real
`0%` ring / `Awaiting check 0`, and the Punch list tile moved 0 -> 1 in
step. That is the hero verified against live data rather than argued.

**THE 0% RING DREW A DOT.** `strokeLinecap="round"` paints a round cap even
on a zero-length arc, so "nothing verified" rendered as a small yellow mark
at twelve o'clock — which reads as *a little bit done* when the truth is
none. The arc is now omitted entirely at zero rather than drawn with a cap.
Nothing in this repo could have caught it: `arcDash` returns `filled: 0`
correctly, which is what the unit test asserts; the defect was what a
renderer did with that zero, and happy-dom does no layout.

**THE BRAND LOCKUP WAS ON ONE SCREEN OUT OF FIVE.** `AppHeader` went into
Home and nowhere else, so Jobs/Alerts/Outbox/Settings still drew a bare
`LargeTitle`. All five tabs now use `AppHeader`; `LargeTitle` is deleted
rather than left as a second way to title a screen.

That swap fixed a **pre-existing misalignment** nobody had reported:
`LargeTitle` carried its own `paddingHorizontal: space.md` AND sat inside a
container that already padded by the same amount, so every tab's title was
indented one gutter further than its own content. Visible in the build-11
screenshots the moment two screens were compared side by side.

`AppHeader` is now self-sufficient — it reads the name from Clerk and
routes to Settings itself, so five call sites cannot drift on what the
avatar does. Settings passes `showAvatar={false}`: the avatar's only job is
to go where you already are.

**And a census checked rather than assumed.** Moving titles from children
(`<LargeTitle>{t(...)}</LargeTitle>`) to a prop (`<AppHeader title={...}/>`)
could have put them outside what `strings-census.test.ts` can see. Probed
with a positive control — hardcode `title="Jobs"` and run it — and the
census went **RED**, so prop strings were already covered. The dead
`LargeTitle` alternative was then removed from its regex and the control
re-run, still RED. A pattern alternative matching a component that no
longer exists is the empty-question failure this file keeps naming.

Suites 38/325 and 15/74, typecheck and `expo lint` clean.

**Left on production and owed back:** a punch item `ZZ-TEST banner check -
delete me` on ZZQB-TEST, created to make the band renderable at all. The
job had none, which is itself the finding — the hero is invisible on a job
with an empty punch list, exactly as designed, and that is most jobs for
most of their life. Mirroring dropped before it could be removed.
