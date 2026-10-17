### A subcontractor can see what a GC's subcontract commits them to before they sign (Diego)

`claude/awesome-bell-s4g7b9`

Phase 1 of the AI subcontract review. On any contract version of a job, **Review before signing** reads the agreement and any exhibits (scope, insurance, general conditions) and lists the clauses that put money, risk or a deadline on the sub — pay-if-paid, liquidated damages, indemnity, notice windows, retainage, insurance asks — each with a severity word, the contract's own words, and the page they are on. The person accepts, negotiates, annotates, edits or dismisses each one; nothing is saved to the job and nothing is sent.

Why it is built the way it is:

- **The model reads TEXT that code extracted, not the PDF.** That is the only way to enforce the rule that a finding without a citation is never shown: every quote is checked verbatim against the same text (`lib/specs/quoteMatch.ts`, unchanged, now running at runtime for the first time), the page is located by code rather than taken from the model, a section reference is kept only if it is printed there, and a figure is kept only if its digits are in the quote. Dropped findings are counted on screen. Scanned pages have no text, so they are listed as unread and cost nothing.
- **One chunk per request, driven by the open page**, because a 100-page contract does not fit in a 60-second function — plan ingestion's shape on this feature's own rows, with a lease so two tabs cannot pay twice.
- **Decisions are keyed on the job and the clause, never the run**, so they survive a re-run and carry to the next contract version wherever the wording is unchanged; a later version shows what is new, changed and gone.
- **Its own switch (`SUBCONTRACT_REVIEW`) and its own monthly unit** (`contractPagesUsed`, 600 pages), so one contract package cannot spend a month of quote and COI reading. Each readable page is charged once even though chunks overlap by a page.

Two migrations, both additive: `20261017180000_add_subcontract_review_ai_feature` (enum member + three integer columns with defaults) and `20261017180100_add_subcontract_review` (four tables, every foreign key CASCADE, so the cleanup scripts gain no RESTRICT child of `Job`).

The paid eval (`pnpm eval:subcontract-review` — 100% citation validity, no HIGH finding on a sub-friendly control, planted-clause recall) is written and has NOT been run: the container that wrote it had no API key. Phases 2 (scope check against the won bid, one-page summary, print export) and 3 (rider, notice alerts, insurance checklist) are next. Design: `docs/ai/SUBCONTRACT-REVIEW.md`.
