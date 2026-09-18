### A contractor who runs on Jobber can bring his clients, jobs and quotes in during onboarding (Cyrus)
`cyrus/jobber`

The first real user is a residential general contractor, and Jobber is what
that trade runs on. Until now the only way in was the spreadsheet importer,
which means exporting from Jobber, fixing the columns, and pasting. There is
now a Jobber card on Settings → Integrations: Connect (OAuth, with PKCE),
then **Import from Jobber**, a preview, and Confirm.

It is a one-way, one-time import, not a sync. C Stream reads Jobber and
never changes anything there. The preview and the write are the spreadsheet
importer's own rules, reused rather than rewritten:

- names are compared by `nameKey`;
- the 500-row cap applies to what would be CREATED, after matching;
- whole Social Security numbers are refused in free text;
- the write is one Serializable transaction that re-reads what exists;
- every job and quote lands as an ESTIMATE, whatever Jobber calls it.

Nothing the browser sends decides what is written. Confirm pulls from Jobber
again on the server, so a big account never crosses the 1 MB Server Action
body limit either.

What a sheet cannot do: each imported client and job keeps its Jobber id,
in new `jobberId` columns unique per company (migration
`20260918190000_add_jobber_import`, additive: an enum value, two nullable
columns, two unique indexes). A second import therefore recognises its own
rows after a rename on either side. Two Jobber clients who share a name are
never merged: the second is refused with a reason, and so are its jobs.
Archived jobs, and quotes that already became jobs, are left out on purpose
and listed as such.

The OAuth callback reuses the QuickBooks #136 §2 lesson from the start: the
session, never the cookie, decides whose account is connected. Tokens are
stored only as `lib/crypto.ts` envelopes. Refresh is a compare-and-swap,
because Jobber rotates refresh tokens and two requests refreshing together
would otherwise store a dead one. Without `JOBBER_CLIENT_ID`,
`JOBBER_CLIENT_SECRET`, `JOBBER_REDIRECT_URI` and `INTEGRATION_TOKEN_KEY`,
the card says Jobber is not set up on this install and offers nothing to
press.

The check: `lib/actions/jobber.test.ts` runs the actions against a fake
two-company database and a fake Jobber that pages by cursor, throttles, and
rotates refresh tokens. I broke each guard on purpose in 34 mutations; all 34
returned a verdict, and 33 were killed. The survivor is equivalent: "company
from the cookie" cannot differ from "company from the session" while the
identity cross-check refuses every case where the two disagree.

Not verified: Jobber's current GraphQL field names. Its field reference sits
behind a Developer Center login. The queries use the names from Jobber's own
app-template schema, and a renamed field fails loudly, with a message naming
it.
