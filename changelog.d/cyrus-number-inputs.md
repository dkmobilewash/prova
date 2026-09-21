### Numbers a contractor types now save, or say why not (Cyrus)
`cyrus/number-inputs`

Typing `2,800` into the quantity box on step 2 of the new-job wizard — the
second screen of creating a first job — did not add the line. It rendered
"An error occurred in the Server Components render. The specific message is
omitted in production builds…" `2800` worked fine. So did `12500` on the
invoice form, while `12,500` took the billing tab down the same way.

`Number("2,800")` is `NaN`. Fourteen separate parsers in `lib/actions/` each
wrote their own `const n = Number(raw); if (Number.isNaN(n)) …`, all fourteen
refused a thousands comma, and every one threw a plain `Error` — which
production redacts. Meanwhile `lib/ask/numbers.ts`, the AI path, has always
accepted `$12,500` and `12,500.00` as one amount, and the payroll register
importer takes `$12,500.00` happily. Same contractor, same number, same
product, two answers.

There is one parser now, `lib/numeric-input.ts`, and everything routes
through it. It strips what a person writes around a figure — a leading `$`
or `USD`, a trailing `%`, spaces including the non-breaking kind a
spreadsheet paste carries — then validates strictly. Commas are accepted
only in well-formed groups of three, so `2,800` and `1,234,567.89` are
numbers and `12,50` is a question it refuses rather than silently reading as
1250, which on an invoice is a hundredfold error. Refusals name the field
and come back as `{ ok: false, error }` through `InputError`/`runAction`, so
the form renders a sentence instead of a digest.

Three things it fixes that nobody had reported:

- **`0x10`, `Infinity` and `1e999` were being ACCEPTED.** The old gate asked
  `Number.isNaN(Number(v))` and then returned the RAW STRING — `Number("0x10")`
  is 16, so the literal text `0x10` went to a Postgres `numeric` column and
  `1e999` got there as `Infinity`. Refused by name now.
- **The takeoff form turned any figure it disliked into 0, in silence.** A
  mistyped length produced a takeoff of nothing with no refusal anywhere. A
  wrong answer that looks like an answer is worse than the throw.
- **A pay application dropped lines the same way.** `Number(x) || 0` made
  `12,500` a zero, and the next line filtered zeros out — so the application
  went to the GC short by a line, with nothing saying which.

**Retainage, which is the expensive one.** `Retainage %` had no type, no min,
no max and no step, so `0.10` — the natural way to write ten percent —
saved, survived a reload as `0.1`, and withheld 0.1%. On a $105,000 contract
that is $105 where $10,500 was meant, on a document the GC receives, with
nothing on screen to suggest anything was wrong. Confirmed in a browser
before the fix. Bounds of 0–100 are now enforced, but **bounds are not the
fix**: `0.10` is inside them, and 0.1% is a strange rate rather than an
impossible one. The ambiguity was the defect, so it is resolved on screen —
a `%` inside the field that does not vanish the way a placeholder does, and
under it what the rate comes to in money on that job's own contract value,
recomputed as you type. `0.10` reads "Withholds $105.00 of $105,000.00". A
factor of a hundred is invisible in a percentage and unmissable in dollars.
**No stored value was migrated.** A job already carrying `0.1` still carries
it; rows do not reinterpret themselves, and rewriting a retainage rate is
not this branch's call.

**`type="number"` is gone from every numeric field, and that is the
counter-intuitive half.** Measured in real Chromium: setting such a field's
value to `2,800` submits an EMPTY STRING, and a person typing it has the
comma discarded before the server sees anything — so on a nullable field the
figure vanishes with no error at all. Firefox submits `""` for anything it
dislikes. They are `type="text"` with `inputMode` now, so a phone still opens
on a keypad, what was typed stays visible, and the server decides. The same
reasoning the backcharge form already had for not using `max` — "the server
owns this rule" — one layer down.

Six server-component pages posted to plain `<form action={serverAction}>`
with nowhere to render a returned sentence, which is why those actions threw
in the first place. `components/ActionForm.tsx` is the smallest thing that
gives them somewhere: `onSubmit`, never React's `action` prop, so a refusal
does not land on fields that have already reset (`formActionCensus.test.ts`).

The checks: `lib/numeric-input.test.ts` starts with the two reproductions
verbatim and is mutation-tested five ways — one of which found a test that
was passing for the wrong reason, since the canonical-form check refuses
`0x10` with or without the message that names it, so the message is what is
asserted. `lib/numericInputCensus.test.ts` asserts its own SIZE and its own
SCOPE, because CLAUDE.md records a separate scar for each: it walks from the
repo root and checks its file list against `git ls-files`, and narrowing it
back to `apps/web` turns it red over 117 files it stopped being able to see.

And one bug found only because it was measured: the `%` sign rendered at
x=1055 on a 1100px viewport, beside an input at x=24. Its wrapper stretched
to full width inside a `flex flex-col` label, so `right-2` was 8px from the
viewport. It was legible, styled, and nowhere near the box. happy-dom returns
zeros from `getBoundingClientRect`, so nothing in the unit suite could have
said so.

Not fixed, deliberately: `components/TimeEntryFields.tsx` and
`lib/actions/labor.ts` were another branch's files this session, so the Hours
box still refuses a figure with a comma in it. It is named, with the reason,
in the census's `INPUT_EXCEPTIONS`, and it fails the build if that line ever
stops matching the code.
