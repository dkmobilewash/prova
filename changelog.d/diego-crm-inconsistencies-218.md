### Two CRM inconsistencies from a click-through: one join style, one create-form gap (Diego)
`diego/crm-inconsistencies-218`

#76 gave `deleteContact`'s refusal a comma-only join ("has 1 bid invitation,
4 logged interactions, 1 person on file" — no "and" anywhere) while
`deleteSalesLead`'s refusal joined with a bare `" and "` ("2 opportunities
and 2 logged activities" — right for exactly two items, which is all it
ever had to join, but "a and b and c" for three). Neither was actually
correct at every length. `joinWithConjunction` (`lib/actions/shared.ts`)
is the one join both now use: "a" / "a and b" / "a, b, and c". Proven by a
pure unit test at 1/2/3/4 items (`shared.test.ts`) — mutation-tested by
hand, reverting the 3+ branch to a comma-only join turns two of those
tests red — plus dbtests against a real database exercising deleteContact
at 2 and 3 non-zero counts and deleteSalesLead at 1 and 2 (the only counts
it can ever reach, since it only has two countable relations).

Separately: `defaultRetainagePercent`, `paymentTermsDays` and
`standardFormsUsed` were edit-only — the "Add a contact" form only
collected name/status/type/email/phone/address, so setting any of the
five extra Contact fields meant save, reopen, fill in, save again.
Investigated rather than assumed either way: `defaultRetainagePercent`
specifically pre-fills `Job.retainagePercent` on a contact's first job
(`lib/actions/jobs.ts`'s own comment already names a contact minted with
it null as a defect shape), and retainage/payment-terms/preferred-form are
ordinarily things a sub already knows about a GC before the first job —
from having worked with or bid to them before — not facts that only
accumulate afterward. Those three are now on the create form too, via a
new shared `ContactStandingTermsFields` (`components/ContactFields.tsx`)
used by both `ContactForm` (create) and `ContactEditForm` (edit), so
create and edit can't drift on these three the way they could have.

`msaExpirationDate` and `prequalificationExpiresAt` stay edit-only, on
purpose, with a comment on `ContactForm.tsx` and beside the fields in
`ContactEditForm.tsx` saying why: they record a specific document's
expiration date, and a freshly added contact — a PROSPECT by default —
usually has no such document yet. Putting a date picker for a document
that doesn't exist onto the create form would be friction with nothing to
fill in; unlike the three standing-terms fields, these only mean anything
once an MSA or a prequalification has actually happened, which is a fact
that editing the contact later is exactly the right time to record.
`createContact` now accepts and stores the three standing-terms fields
(dbtest: saves all three from one create-form submit, leaves them null
when omitted, and validates a non-numeric payment-terms value the same
way `updateContact` already did) and continues to leave the two
document-expiry fields null — nothing on the create form can set them.
