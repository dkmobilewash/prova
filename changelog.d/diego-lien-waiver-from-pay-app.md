### A pay application offers its lien waiver, and warns before it goes out (Diego)
`diego/lien-waiver-from-pay-app`

Two follow-ups a pay application has always owed and the app never
mentioned, in `lib/lien-waiver-followups.ts` and composed on the Billing
tab:

- **The offer.** The newest pay application with no waiver yet gets a line
  under the lien-waiver heading: "Application #N has no lien waiver yet" and
  one button that opens the ordinary issue form as a **conditional progress
  waiver**, with the **amount = that application's current payment due**
  (G702 line 8, net of retainage) and **through = its period-to** already
  in the boxes, and the pay application already picked. The **exceptions
  start empty** — the app never writes a number into a waiver, which is the
  rule `lib/lien-waiver.ts` has carried since day one. Change either figure
  and it is still the person's waiver.
- **The lower-tier warning.** Before an application goes to the GC, the
  waivers owed upward are usually conditioned on the ones collected
  downward for the previous period. The app now joins the two sides: the
  previous application's period-to (or its issue day) against the inbound
  LIEN_WAIVER compliance documents on the job, for every party the sub buys
  from there (vendors with a material order, plus anyone who has ever sent
  a waiver). Each pay-application row on Billing, and the certificate page
  itself, says **"Before this goes to the GC: no lower-tier lien waiver
  received through <date> from A, B"** with a link to Compliance. It names
  who has NOT sent one and never says anyone is covered; a waiver with no
  period covers nothing; a first application has nothing to check.

No schema change, no statutory wording, nothing blocking.

Checks: `lien-waiver-followups.test.ts` (offer figures and when there is
none; the check's naming, loose name match, null period, first application,
and that no sentence reassures), `lien-waiver-followups.dbtest.ts` (the
join against real rows: vendors with orders plus past waiver senders are
the parties, only lien waivers are inbound, September composes to the
right two names), and the Billing render test extended for the new read.
