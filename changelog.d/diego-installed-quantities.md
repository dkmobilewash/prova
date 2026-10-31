### A field report records what was installed, per line (Diego)
`diego/installed-quantities`

The app knew hours but not work in place. A daily field report now takes an
optional "installed today" quantity per schedule-of-values line, on the web and
the phone, in the line's own unit, with the total to date shown beside it.

A pay application then shows "Suggested $X from installed qty" beside the hours
suggestion, so a person can weigh work in place against effort. Neither fills
the box, and the billing math does not read either.

Lines with no countable unit take no quantity: a lump sum, or a labor line. The
total is summed from reports and never stored, so editing or deleting a report
moves it. An edit that sends no quantities leaves them alone, because an older
phone knows nothing about them. A signed day refuses them like the rest of the
report. Additive migration `20261031120000_daily_report_installed_quantity`.
