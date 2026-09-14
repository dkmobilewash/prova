### Four defects found by clicking the demo, not by reading it (Cyrus)
`cyrus/integration`

Signed in and walked the scenes. Every one of these was invisible to
typecheck, lint and 2,900 tests.

**1. A nav row sliced in half, floating over the money figure.** Each rail
group heading is `sticky top-0`, and a sticky offset resolves against the
scrollport's **padding** box — so the container's `padding-top: 16px` pinned
every heading 16px BELOW its visible top edge and left a 16px band where nav
items scrolled past in full view. Measured rather than reasoned about: the
heading's rect sat exactly 16px below the scroller's, matching the padding to
the pixel. The 16px moved onto the Ask block above (`pb-4`), which is outside
the scrollport, and the gap closed to 0. Same air, on the side of the scroll
edge where nothing can slide under it.

**2. The "what it learned" panel said the same thing three times.** A
filename teaches every word in it at once, so `brkt-waiver-01.pdf` produces a
"brkt" rule and a "waiver" rule that reach the same conclusion from the same
files. Listed separately that is two identical sentences; with a project-code
prefix on every file it is four or five. Seeded a tray and READ the panel:
three lines said "are a lien waiver" and three said "go on Riverside Medical
Office Building", off four documents. Now one line per LESSON — `Files with
"brkt", "waiver" or "zzscratch" in the name are a lien waiver`. Grouped on
conclusion AND evidence, never conclusion alone: two different groups of
files can name the same job for genuinely different reasons, and merging
those would claim evidence one of them does not have.

**3. The tray and its own alert split the same tray differently.** The header
read "7 ready to file, 4 need a look" while the alert beside it said 8 and 3.
The totals matched; the split did not, because a MEDIUM-confidence row is
"needs a look" to the page and was "routine" to the alert, which re-derived
its own numbers as `waiting - unreadable`. Each number defensible alone —
which is why only having both screens open catches it. `intakeTraySummary`
routes through `countIntake` now, so there is one rule and both read it, and
the alert's two counts are disjoint by construction rather than by a
subtraction that can drift.

**4. A second click on the estimate delete hit the CONFIRM.** The worst of
the four. CLAUDE.md rule 2 — "Cancel inherits the Delete pixel" — was
measured against clusters whose delete button is one short word, and it has a
failure mode no rule in this repo could see: a LONG label makes the armed
pair **narrower** than the button it replaces, so the pair stops covering the
same pixels and the confirm drifts under where the label used to be. #265
shipped `label="Remove this estimate"` (147px). Probed in real Chromium: a
click at the exact centre of that button, once armed, landed on "Remove it".

The ORDER was correct the whole time — Cancel was last in a right-pinned
cluster, exactly as the rule says — which is why every existing check passed.
Shortened to "Remove" (71px) and the same probe lands on Cancel. The sentence
above the button already says what is removed and `describe` says what it
costs, so the long label was carrying nothing the screen did not say twice.

`rowActionsCensus.test.ts` now caps a delete label at 12 characters. A
character count is a proxy for a pixel width and is admitted as one in the
test — happy-dom does no layout, which is why every geometry entry in
CLAUDE.md comes from real Chromium. The ceiling is the longest label the app
ACTUALLY uses rather than a round number (61 sites; "Delete draft" at 12 is
the longest), so it cannot quietly grow. Mutation-proved by putting the exact
19-character label back and watching it fail by name.

**Verified working, by clicking:** the rail's order (418k, 776k, 648k, then
the two small counts), independent group toggles, #261's description tooltip
on a Money Rail heading, the learning panel, all three intake suggestions
rendering as alerts with Go-and-fix-it / Snooze / Seen-it — which is the
yes / later / no Cyrus asked for — and `jobPickerLabel` naming the GC and
stage in the intake picker.

Scratch rows were seeded to `ep-icy-hat` to make the tray non-empty and
deleted in the same sitting, with the script asserting the host before
writing and refusing to report clean while any survived: 15 seeded, 15
deleted, 0 remaining.
