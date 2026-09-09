### Two claims in CLAUDE.md that the code stopped agreeing with (Diego)
`claude/prova-company-cam-feature-6170v6`

**Docs-only, an audit under working agreement 1's exception.** No behaviour
change. Both are statements that were false against `main`, corrected with
the evidence that settles them.

**The egress-proxy reasoning.** The concurrent-writes entry rules previews
out as the source of the stray `ep-little-sea` rows, and gives as its
reason that a preview URL, being a different host from `app.cstream.ai`,
"would pass the egress proxies that 403 both agents' containers". Measured
twice from an agent container: the preview host is denied exactly like
production — `curl` fails at CONNECT and the proxy's own status endpoint
names it, `connect_rejected`, "gateway answered 403 to CONNECT (policy
denial)". So the hypothesis was dead on a second ground nobody had checked.
The entry's CONCLUSION is untouched; it rests on build logs and those
stand. Only the stated reasoning was wrong, and that is the kind of aside a
later reader reasons FROM rather than checks.

**A preview cannot be clicked with a production session** — new, and
established while clicking #214, where it cost a round. Previews run the
DEVELOPMENT Clerk instance ("Development mode" in orange under the sign-in
box is the tell) and `app.cstream.ai` runs the Production one, so being
signed into the app does nothing for a preview: it redirects to `/sign-in`
and stays. The expensive half is what happens after you sign in.
`requireCompanyContext` adopts a row by verified email only if one exists
in the database it is talking to, and a preview talks to the DEMO project —
so an address with no row there falls through to the create branch and
silently gets a brand new empty company. Every list page then shows its
empty state, which reads exactly like the feature you came to click is
broken.

**This PR started as three corrections and is shipping two, which is the
part worth recording.** The third was the invoice-counter entry, still
saying `InvoiceCounter` did not exist and that the fix had not been made,
days after #224 made it. #225 corrected the same paragraph and merged
first — while this PR was open and green, and by the time the merge was
attempted, GitHub refused it as conflicted. Both corrections were written
independently, hours apart, from the same observation.

The resolution took `main`'s version wholesale rather than merging the two,
verified byte-identical to `main` afterwards, because #225's is better: it
re-derives the counter count instead of stating it, cites the `Migrate` run
that applied the migration, and adds a lesson this one missed — the entry's
vivid headline ("delete invoice 3 of 3 and the next invoice is 3 again")
described a failure the product cannot reach, since there is no
`deleteInvoice` at all, while the reachable defect was the concurrency
collision mentioned last and in passing.

So the duplicated work is not the lesson; the lesson is that a stale
sentence in a shared file attracts more than one fixer at once, and nothing
in the process noticed. The changelog convention that landed the same day
stops two PRs colliding on `CHANGELOG.md`'s first line. Nothing yet stops
two PRs rewriting the same paragraph of `CLAUDE.md`.
