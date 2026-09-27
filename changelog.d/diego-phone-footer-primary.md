### The button the Time screen exists for was 40pt wide with no label (Diego)
`diego/phone-footer-primary`

Found on a real iPhone on 2026-09-26, the first night this app was ever on
one — through TestFlight, an hour after the first production build landed.
Every suite in the repo was green and had been for weeks.

**What shipped.** On `app/time/[jobId].tsx`, the footer held `Sign the day`,
`Hand phone over` and `Log time`. Measured off the device: the primary
rendered **40.0pt wide, showing no label at all** — just a yellow stub cut by
the screen edge. The floor this repo enforces on anything tappable is 48pt,
and 56 for a primary. And the empty state on that same screen reads *"Tap
'Log time' to record the day's hours"*, naming a button it had clipped out of
existence.

**Why.** React Native defaults `flexShrink` to 0, so two intrinsically-sized
secondaries keep their width while the `flex: 1` primary — `flexBasis: 0,
flexShrink: 1` — absorbs the entire deficit.

**The pattern was never wrong. It had a capacity nobody had named.** `photos`
and `reports` use the identical three styles, hand-copied into all three
files, and both are fine — confirmed on the device the same night. They pass
ONE secondary. It works at one and crushes the primary at two, with nothing in
between to say so:

| screen | secondaries | primary |
| --- | --- | --- |
| photos (`Library`) | 1 | fine |
| reports (`Log a delay`) | 1 | fine |
| **time** (`Sign the day`, `Hand phone over`) | **2** | **40pt, no label** |

**Spanish is strictly worse on both sides**, which matters because the app
ships it for the crews it is for: the squeezers grow (`Pasar el teléfono`, 17
against 15) while the squeezed primary nearly doubles (`Registrar horas`, 15
against `Log time`'s 8).

**The fix is a component, not three edits.** `components/FooterActions.tsx`
owns the layout and the capacity: one secondary or none share a row with the
primary; two or more get a row of their own and the primary takes a full width
underneath. Callers pass an array, so the count is a fact the component acts on
rather than something each screen has to remember.

**NO TEST IN THIS REPO CAN SEE THE DEFECT, and that is the point rather than an
excuse.** The screen suite renders in happy-dom, which does no layout and
returns zeros from `getBoundingClientRect` — the same blindness that shipped a
1.35-POINT line height on five screens. So the guards are a COUNT and a
STRUCTURE, standing in for a width, the way `rowActionsCensus.test.ts` caps a
delete label at 12 characters and says so:

- `screens/footer-actions.test.tsx` proves the primary leaves the row at two
  secondaries and — the control that makes it mean something — **stays** in it
  at one.
- `lib/footer-actions-census.test.ts` asks the other question, the one a
  correctness test cannot: **is there a second implementation.** A style key
  named `footerRow`/`footerMain` outside the component is the signature of a
  hand-rolled bar. It also fails if nothing imports the component — *written,
  documented, and never called* is a recurring shape here.

**Mutation-tested, and the third row is the one that earns the scope
assertion.** `app/time/[jobId].tsx` is two directories deep, so a walk that
does not recurse misses precisely the file that carried the bug:

| | bug | census scope | `one implementation` says | overall |
| --- | --- | --- | --- | --- |
| M2 | present | recursive | RED, names the file | RED |
| M3 | absent | non-recursive | green (blind) | RED on scope |
| **M4c** | **present** | **non-recursive** | **green — blind and wrong** | **RED on scope** |

M4c is the world as it shipped: the assertion that would answer the question is
green, and only the size-and-scope guard stops a vacuous pass. That is
CLAUDE.md's own theme-contrast lesson — *nothing is ever missing from a
directory you do not walk* — reproduced deliberately rather than rediscovered.
Flattening the component back to one row (M1) reds both guards independently,
while the one-secondary control stays green.

**What is NOT claimed.** The 40pt came off a phone; the fix has not yet been
seen on one, because the TestFlight build is pinned at `6cdad573` and a new
build is 20 minutes. The structure is proved, the width is not re-measured.
Worth one look on the next build before this entry is trusted about pixels.
