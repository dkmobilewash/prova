### The answer-key mode is a staff tool and now looks like one to a customer: absent (Diego)

`diego/review-fixes`

A pre-production review found that `/takeoff/<id>?key=1` opened the
labelling panel for anyone who could see a job's costs, and that the label
routes answered a customer's read with "nothing labelled" rather than "not
here". Only the WRITE was gated. The gate is now one function,
`labellingRefusal` — the local-plans conditions (no Vercel, and on a
production build the opt-in plus a loopback bind) plus an absolute label
folder — and the workspace page's URL switch, the "Answer key" button (not
rendered at all when the server cannot label) and both label routes ask it
before showing or doing anything. The routes answer a plain 404 that names
no environment variable. `answer-key-gate.spec.ts` signs in a customer with
job-cost access and proves no button, no panel on `?key=1`, and 404 on read
and write; the store's own tests cover each condition of the gate.

Also from the review: the two real-plan specs no longer default their
folders to a developer's home directory (empty string, so they skip), and
the takeoff-items backfill was run against seeded measurements on a
throwaway Postgres and its reversal checked — the findings and the
migration-count reconciliation (six pending, not thirty-five) are in
`lib/takeoff/NOTES.md`. Nothing in the migration was changed.
