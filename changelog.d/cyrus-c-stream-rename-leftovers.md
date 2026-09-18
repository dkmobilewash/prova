### The rename left "Prova" on eight user-facing surfaces, including the brand chip and a document GCs receive (Cyrus)
`cyrus/wiring-clicktest`

Found by loading pages rather than by grepping — the brand chip is the
first thing on every screen and nobody had looked at it in weeks.

`Sidebar.tsx:283` rendered the literal **`P`** in the brand square, on
every page, in production. A Slack note on 15 Sep said this was fixed on
`cyrus/integration`; it is not on `main`, so it was lost among #278's
eleven conflict resolutions or never committed. Either way the claim that
it was fixed was false, which is why this entry names it.

Seven more strings still said "Prova", and the placement matters more than
the count:

  - `jobs/[id]/photo-report/page.tsx` — **the printed photo report**, which
    is a document a sub hands to a general contractor. It told them to
    "open the job in Prova".
  - `jobs/[id]/pay-applications/[invoiceId]/page.tsx` (×2) — on a
    G702-style pay application, also GC-facing.
  - `jobs/[id]/page.tsx` (×2) — the e-signature explanations.
  - `internal/usage/page.tsx`, and the Internal nav group's description.

`isProvaOperator` is deliberately NOT renamed. It is a schema field, not
copy: changing it is a migration, it appears in no rendered string, and
renaming a column to tidy a word is how a rename becomes an outage.

The fill and label on the chip were already correct — `bg-brand` with
`text-neutral-900`, measured live at `rgb(250, 204, 21)` on
`rgb(23, 23, 23)`. Only the letter was wrong.

Verified by result: the chip reads `C`, and `document.body.innerText`
contains no "Prova" on the page that carried it.
