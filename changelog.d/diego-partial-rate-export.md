### 32 hours, $800, and "Rate known: yes" (Diego)
`diego/bug-hunt`

No migration. One expression in `lib/payroll-export.ts`, and three tests.

**A ROW CAN BE PARTLY PRICED, AND THE EXPORT CALLED THAT "yes".** A fringe
rate schedule has `effectiveFrom` and `effectiveTo`. When one lapses
mid-week, the same employee under the same craft has days inside the window
that price and days outside it that do not. `wageCost` then comes out a real
number that is SHORT.

Reproduced through the real code path rather than argued — one employee, one
craft, a schedule expiring on the Tuesday:

| | |
| --- | --- |
| hours logged | **32** |
| wage at $50/hr | should be **$1,600** |
| `Wage cost` exported | **800** |
| `Rate known` exported | **`yes`** |
| `hasUncomputedHours` internally | **`true`** |

A clerk opens that file, reads "yes", and pays half.

**THE SCREEN HAD BEEN RIGHT ABOUT THIS THE WHOLE TIME.** The certified-payroll
page draws an amber asterisk straight off `hasUncomputedHours`
(`certified-payroll/page.tsx:271`) and footnotes it. The export never read the
flag — it asked only `wageCost == null`, which is two states for a domain
that has three. `rateKnown` is now `"yes" | "no" | "partial"`.

**AND THE WH-347 ALREADY SOLVED IT, which is the strongest evidence that the
export was wrong rather than the model.** The government form keys a line as
`${baseKey}::rate${n}` when the schedule changes (`lib/wh347.ts:473`), so a
mid-week rate split prints as SEPARATE LINES, each with its own rate. Two
surfaces off one summary: one split the row, one silently summed it.

| mutation | result |
| --- | --- |
| control | green |
| the bug as shipped (`partial` → `yes`) | **RED** — "expected 'yes' to be 'partial'" |
| hours trimmed to match the priced ones | **RED** |

The first was re-run on its own to confirm the suite STARTED and failed on the
assertion by name, not on a build error — a false red earlier in the same
session is the reason that is now checked rather than assumed.

The hours stay at 32 on purpose. **32 hours against $800 is a discrepancy a
clerk can see once the flag says to look**; trimming the hours to match the
priced ones would have hidden it and made the row internally consistent and
wrong.

Found by sweeping for this file's own documented shapes. Three of the four
sweeps were noise — `assertOwner`, `<form action={…}>` and `window.confirm`
all have censuses that pass, and every `window.confirm` hit was a comment
saying never to use it. The fourth, `?? 0` on money, had two more candidates
that turned out CORRECT and are worth not re-investigating: `bid-levelling`'s
`spread` is guarded by an early `sorted.length < 2` return, and
`certified-payroll`'s accumulator seeds with `?? 0` only inside
`if (cost != null)`.

563 files / 8762 tests, typecheck and lint clean.
