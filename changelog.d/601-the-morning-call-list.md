### `/sales` did not answer the one question it exists to answer (Cyrus)
`cyrus/sales-signals`

The screen somebody works down each morning ordered leads by **creation date**, so a
§4104 import — which can add up to 60 leads in one go — buried the handful carrying a
GC, a job and a confirmed trade under dozens of thin ones. Those few are the only ones
worth ringing; the band that says so was computed and thrown away.

**`BAND_RANK` was dead, and that is measured rather than asserted.** Grep over the
whole repo before the change returned exactly one importer: `sales-qualification.test.ts`,
asserting only that four bands have four distinct ranks. The declaration's own comment
reads *"Sort order for a list of leads: the ones worth calling first"*, and it ordered
nothing on screen. The band was derived inside the JSX map and discarded after
rendering, so it could not have reached a sort. This repo's recurring
"written, documented, and never called" shape, in the module whose whole job is to say
who to call.

**The tiebreak is load-bearing, and the reason was measured on a real Postgres 16
rather than reasoned about.** `SalesLead.createdAt` defaults to `CURRENT_TIMESTAMP`,
which in Postgres is TRANSACTION START, and `importSubListing` writes every lead in one
`$transaction`. Three inserts 120 ms apart inside one transaction produced **one
distinct timestamp**. So all 60 rows of an import tie, `ORDER BY createdAt DESC` is not
a total order for exactly the case this screen is about, and two loads could already
have shown the same 60 leads in different orders. An `id` tiebreak settles it.

Creation order was kept as the within-band tiebreak over "most recent activity" for
three reasons: `lastContactOn` is null on every freshly imported lead, so a
contact-based tiebreak leaves 60 rows in no order at all — the defect, not the fix; the
page already has a follow-up queue ranking the same leads by recency, and a second
competing ranking is the "is there a second list" shape; and keeping it means the band
is the only thing this change moves.

Bands are cut by **adjacency in the sorted list**, never by walking `FIT_BANDS`, so
there is no second statement anywhere about which band outranks which — the heading
sequence comes only from the comparator and cannot drift from it. A heading is written
only for a band something is in.

**Where the sort lives, and the honest reason it is not on the server.** All three
candidate homes refuse a pure comparator: `lib/actions/sales.ts` is `"use server"`, so
every export must be an async function and exporting a sort would mint a POST endpoint
for it; a page cannot export a non-reserved name (Next's TS plugin errors
`INVALID_ENTRY_EXPORT`); and a function exported from a `"use client"` module becomes a
client reference the server cannot call. So it sits in the module that also renders the
headings — which has the compensating virtue that the order a person reads and the
order the headings claim cannot disagree. The right home is a new
`lib/sales-lead-order.ts`; nothing else changes if it moves there.

Sort cost measured: **0.044 ms at 60 rows**, 1.63 ms at 5,000, 7.25 ms at 20,000 —
against a post-action server render this repo measures at 1.5–4.4 s. Nothing was given
up, because the page never ordered in the database in a way that mattered: it has no
`take`, already materialises every lead with all its children, and already ran
`qualify()` per lead in memory. **The cost that does exist is future:** `/sales` can
now never be paginated or ordered in SQL without storing a band, and storing derived
state is forbidden here. At a few thousand leads the thing that will hurt is the
unbounded query, which predates this.

**The 60-row cap is NOT a silent truncation, checked across all four layers rather
than assumed:** the action RETURNS a refusal naming both numbers, there is no `slice`
on rows anywhere, the paste and the selection survive the refusal on screen, and
`unread`/`rowsSkipped` are both reported. One real gap left deliberately untouched:
nothing warns BEFORE submit that more than 60 lines are ticked, so you learn on submit.
That is a refusal rather than a drop, and the fix belongs in `SubListingImport.tsx`.

Nine mutations, no survivors, every total read before the colour. Two matter. **Making
the ordering a no-op reds 9 of 15 including BOTH render tests**, so the suite is
measuring the DOM rather than a mock — verified independently here. **Dropping the `id`
tiebreak reds exactly one test**, the import-tie case, and that test is the
distinguishing one: asserting a single expected sequence proves nothing because
`Array.sort` is stable and would satisfy it, so it feeds the same rows REVERSED and
requires the same output, which stability cannot produce.

A defect the agent's own test found in its own markup: `gap-2` separated a band label
from its count in pixels only, so `textContent` read "Call this one**1 lead**" — a
screen reader and any Playwright text locator would see the words run together. Fixed
with an explicit space, which costs nothing on screen.

`e2e/specs/sales-crm.spec.ts` was checked by REPLAYING its own locators against the new
markup, not by reading it: the `li` filter still resolves to exactly one, an exact-text
match for "Call this one" still returns 0 on the fixture (which is why only non-empty
bands get a heading, pinned by its own test), the Pipeline section filter still
resolves to one, and the lead link still resolves to one. CI's `e2e` job is the proof.
