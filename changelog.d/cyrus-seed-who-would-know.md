### The demo GC has a superintendent, so "who showed up?" has somebody to ask (Cyrus)
`cyrus/seed-who-would-know`

Beat 3 of the launch video asks the assistant who actually showed up on
Riverside last Tuesday, and the product's answer — deliberately — is that
nothing records attendance, so it will not name anyone. The next line of
that beat is being built in `lib/ask`: "would you like me to draft a message
to whoever would know?" This entry is the data under that line, and most of
it is what was ESTABLISHED before anything was changed, because the right
change turned out to be small and the wrong one was tempting.

**Who is attached to Riverside on the demo dataset, and by what.** The
owner's own login is the only `JobAssignment` and files every field report;
those reports record a headcount ("4 framers, 2 apprentices"), never a name.
Six `CrewMember`s have hours and next week's schedule on the job, and Hector
Ramirez among them is the FOREMAN-tier craft — on a real drywall sub he is
exactly the person who would know. Two named people at the GC exist only as
strings: Dana Whitfield and Marco Silva, on the message log's "To" lines, in
two interaction summaries ("Called Dana…", "Walked levels 1-2 with the
super…") and in a toolbox-talk presenter field. Brackett's People section
read "No one added at Brackett Construction yet" on the same account.

**Who the product can reach.** One channel is wired: `MessageChannel.SMS` is
"modelled but not wired" in its own schema comment, so sending means email.
`CrewMember` has no email column — the model exists precisely so a carpenter
does not need an inbox — and the reasons a crew member must NOT be faked as a
`User` are written on `crew.prisma` (globally unique `clerkId`/`email`, and
`requireCompanyContext` adopting a row by verified address, so an invented
one is a cross-tenant hole waiting for someone to register it). So the
foreman is the person who would know and the product CANNOT message him,
and the feature has to say that rather than pretend. No seed change can make
it otherwise without a migration, which this PR deliberately does not carry.

**Is there a foreman concept at all?** Three partial ones and no job-level
pointer: `CraftClassification.tier = FOREMAN` (a rate step, which is what
Hector carries), `JobFunction.FIELD` on `User` ("foreman or field lead"),
and `TimesheetSignoff.signerName` ("a foreman's signature on one job's hours
for one day" — none seeded). "Who would know" therefore has to be derived:
the FOREMAN-tier crew member with hours on the job that day, whoever filed
the field report, or the GC's own superintendent, who keeps the gate log and
the daily manpower count by trade.

**What changed, and why it is the smallest honest thing.** Two `ContactPerson`
rows at Brackett Construction — Marco Silva, Superintendent, and Dana
Whitfield, Project Manager — with the addresses the message log was already
sending to. Nothing is new to the dataset except two titles and two phones.
The two interactions that name them now link to them, so "last contact" on
the People section derives from the log per person instead of every person
reading as never contacted; and the three Brackett messages read their
recipient off the person row, so the log and the People section cannot name
one person at two addresses. `contact_lookup` now returns a person titled
"Superintendent" with an email for "the super on Riverside".

**What the Ask lane still has to do, said here because it is not in this
diff.** `commands/messages.ts` resolves a recipient from the `Contact` row
only — `resolveContact` or the job's GC — and never reads `ContactPerson`.
Until it does, "draft a message to Marco Silva" resolves to Brackett's
account mailbox (`pm@…`), not to the super. The row is there; the resolver
is the other half.

**Cleanup, checked rather than assumed.** `ContactPerson` carries no
`jobId`, so it is not a RESTRICT child of `Job` and needs no entry in
`HANDLED_MODELS` or either script's `del()` order for that reason; it hangs
off the contact, and `undo()` already deletes people by `contactId` after
the interactions, as `clean-scratch-data.mjs` does. The reseed guard counts
contacts, and the people go with them. Not verified against a database from
this container — there is none — so the seed's own run on a scratch host is
the proof this entry does not have.

No schema change, no migration.
