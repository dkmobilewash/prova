### A pay application suggests each line's amount from its hours (Diego)
`diego/g703-suggested-amounts`

Percent complete on a G703 line was only ever typed. The entry form now shows
"Suggested $X from hours: 120 of 200 budgeted hours through 2026-10-31, 60.0%"
under the This period box, less what is already billed or stored.

It is words only. There is no field and no button behind it, the box stays
empty, and `pay-application.ts` does not import it, so the G702 cannot change.

Hours are the only source because they are the only progress this app records.
Field reports have no quantities and takeoff tracks nothing installed. Only hours
through the period-to date count, hours over budget hold at 100%, and a line with
no budgeted hours or none logged shows nothing.
