### Closeout billing: bill the retainage, offer the final waiver, see what is left (Diego)
`diego/closeout-billing`

**Bill the retainage** on the Billing tab makes a pay application with no new work
and a negative retainage snapshot giving back what was held. The existing engine
then prints a correct G702: retainage to date goes down by the amount, and current
payment due is the amount. Part of the balance can be billed, never more than is
held, and never when nothing is. It is read and written in one serializable
transaction, like a logged release.

When an application brings the contract to fully billed with nothing held, the
waiver offered is a **conditional final** one, with its amount and through date
filled in and the exceptions left empty, the same rules as the progress offer.

A read-only **Closeout billing** list on the Billing tab: contract billed in full,
retainage billed, retainage paid, final waivers issued, lower-tier waivers
received. Each line is what the records show. Nothing says the job is closed out.

No schema change: whether an invoice is a release and whether billing is final
are both read off the figures. A release application is refused by the
QuickBooks push, because invoices already went there in full, retainage included.
