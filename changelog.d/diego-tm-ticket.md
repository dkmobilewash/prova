### T&M ticket with on-site signature (Diego)
`diego/tm-ticket`

Extra work on a time-and-materials job has to be written down and signed
off on the spot, or the GC disputes it later from an office. Until now the
phone had no way to do either.

A new `TmTicket` model captures one work date: the labor and material
entries already logged for that job and day are aggregated into a `snapshot`
Json frozen at signing (the `SignatureRequest` rationale — a later edit to
the entries cannot change what was signed), and the client signs with a
typed name + timestamp on site. `POST/GET /api/v1/jobs/[id]/tickets` does the
work; the phone's T&M-ticket screen (job hub → "T&M ticket") collects the
date, a description and the signer's name, and replays idempotently offline
like every other field create. Checked by typecheck/lint and a demo-DB
round-trip (create aggregates the day's entries, list returns it).
